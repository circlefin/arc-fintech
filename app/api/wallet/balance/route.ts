/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { circleDeveloperSdk } from "@/lib/circle/developer-controlled-wallets-client";
import { getUsdcBalance, type SupportedChain, USDC_ADDRESSES } from "@/lib/circle/gateway-sdk";
import type { Address } from "viem";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Extract walletIds from the request body
    const body = await req.json();
    const { walletIds } = body;

    if (!walletIds || !Array.isArray(walletIds) || walletIds.length === 0) {
      return NextResponse.json({ error: "Invalid walletIds provided" }, { status: 400 });
    }

    // 1. Batch fetch wallet info from Supabase for all requested wallets
    // Need address for Gateway wallets to fetch on-chain balance
    const { data: walletMetadata, error: dbError } = await supabase
      .from("wallets")
      .select("circle_wallet_id, blockchain, type, address")
      .in("circle_wallet_id", walletIds);

    if (dbError) {
      console.error("Database error fetching wallet metadata:", dbError);
      throw new Error("Failed to retrieve wallet metadata");
    }

    // Create lookup maps for O(1) access
    const chainMap = new Map<string, string>();
    const typeMap = new Map<string, string>();
    const addressMap = new Map<string, string>();
    
    walletMetadata?.forEach((w) => {
      if (w.circle_wallet_id) {
        chainMap.set(w.circle_wallet_id, w.blockchain || "Unknown Chain");
        typeMap.set(w.circle_wallet_id, w.type || "");
        addressMap.set(w.circle_wallet_id, w.address || "");
      }
    });

    const balancesMap: Record<string, string> = {};

    // 2. Filter out Gateway signer wallets and fetch balances for Circle-managed wallets
    const circleWalletIds = walletIds.filter((id: string) => {
      const walletType = typeMap.get(id);
      return walletType !== "gateway_signer";
    });

    // 3. Use Promise.all to fetch balances concurrently from Circle SDK
    await Promise.all(
      circleWalletIds.map(async (id: string) => {
        // Retrieve chain name from our lookup map
        const chainName = chainMap.get(id) || "";
        const chainSuffix = chainName ? ` (${chainName})` : "";

        try {
          const response = await circleDeveloperSdk.getWalletTokenBalance({
            id,
            includeAll: true
          });

          // The SDK returns an array of token balances for this specific wallet
          const tokenBalances = response.data?.tokenBalances || [];

          // Strictly look for USDC (USDC-TESTNET included)
          const usdcBalance = tokenBalances.find((b) => b.token.symbol?.startsWith("USDC"));

          if (usdcBalance) {
            const amount = parseFloat(usdcBalance.amount).toFixed(2);
            balancesMap[id] = `$${amount}${chainSuffix}`;
          } else {
            balancesMap[id] = `$0.00${chainSuffix}`;
          }
        } catch (innerError) {
          console.error(`Failed to fetch balance for wallet ${id}:`, innerError);
          // We default to $0.00 if fetching fails for a specific wallet
          balancesMap[id] = `$0.00${chainSuffix}`;
        }
      })
    );

    // 4. For Gateway signer wallets, fetch on-chain USDC balance
    const gatewayWalletIds = walletIds.filter((id: string) => {
      const walletType = typeMap.get(id);
      return walletType === "gateway_signer";
    });

    // Helper to map blockchain names to SupportedChain types
    const blockchainToChain: Record<string, SupportedChain> = {
      "ETH-SEPOLIA": "ethSepolia",
      "BASE-SEPOLIA": "baseSepolia",
      "AVAX-FUJI": "avalancheFuji",
      "ARC-TESTNET": "arcTestnet",
    };

    await Promise.all(
      gatewayWalletIds.map(async (id: string) => {
        const blockchain = chainMap.get(id) || "";
        const address = addressMap.get(id);
        const chain = blockchainToChain[blockchain];

        if (!address || !chain) {
          balancesMap[id] = `$0.00 (${blockchain})`;
          return;
        }

        try {
          const balance = await getUsdcBalance(address as Address, chain);
          const balanceInUsdc = Number(balance) / 1_000_000;
          balancesMap[id] = `$${balanceInUsdc.toFixed(2)} (${blockchain})`;
        } catch (error) {
          console.error(`Failed to fetch on-chain balance for Gateway wallet ${id}:`, error);
          balancesMap[id] = `$0.00 (${blockchain})`;
        }
      })
    );

    return NextResponse.json(balancesMap);

  } catch (error: unknown) {
    console.error("Failed to fetch wallet balances:", error);
    return NextResponse.json(
      { error: "Failed to fetch balances" },
      { status: 500 }
    );
  }
}
