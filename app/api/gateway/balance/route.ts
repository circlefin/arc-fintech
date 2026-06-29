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

import { NextResponse } from "next/server";
import type { Address } from "viem";
import { getUsdcBalance, DOMAIN_IDS, type SupportedChain } from "@/lib/circle/gateway-sdk";
import { getAppKit, getCircleWalletsAdapter } from "@/lib/circle/app-kit";
import {
  BLOCKCHAIN_BY_APP_KIT_CHAIN,
  SDK_CHAIN_BY_BLOCKCHAIN,
  type AppKitChain,
} from "@/lib/constants/chains";
import { withAuth } from "@/lib/api/with-auth";

// The four App Kit chain identifiers we query Gateway balances for. Driving
// this from a constant rather than the values of `APP_KIT_CHAIN_BY_BLOCKCHAIN`
// keeps the order deterministic (matters for the per-chain breakdown the UI
// renders).
const QUERY_CHAINS: AppKitChain[] = [
  "Ethereum_Sepolia",
  "Base_Sepolia",
  "Avalanche_Fuji",
  "Arc_Testnet",
];

const SUPPORTED_CHAINS: SupportedChain[] = [
  "ethSepolia",
  "baseSepolia",
  "avalancheFuji",
  "arcTestnet",
];

export const POST = withAuth(async (req, { user, supabase }) => {
  try {
    const { addresses } = await req.json();

    if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
      return NextResponse.json(
        { error: "Missing or invalid addresses array" },
        { status: 400 }
      );
    }

    // Filter out null/undefined addresses and deduplicate (Gateway signer
    // wallets share the same EVM address across chains).
    const validAddresses = addresses.filter(
      (addr: string | null | undefined) => addr != null && addr !== ""
    );
    const requestedAddresses = Array.from(
      new Set(validAddresses.map((addr: string) => addr.toLowerCase()))
    );

    if (requestedAddresses.length === 0) {
      return NextResponse.json(
        { error: "No valid addresses provided" },
        { status: 400 }
      );
    }

    // CRITICAL: only return Gateway/on-chain balances for addresses the caller
    // actually owns. Without this check any logged-in user can probe arbitrary
    // addresses through our proxied SDK calls.
    const { data: ownedRows, error: ownedErr } = await supabase
      .from("wallets")
      .select("address")
      .eq("user_id", user.id)
      .in("address", requestedAddresses);

    if (ownedErr) {
      console.error("Wallet ownership lookup failed:", ownedErr);
      return NextResponse.json(
        { error: "Failed to verify wallet ownership" },
        { status: 500 }
      );
    }

    const ownedSet = new Set(
      (ownedRows ?? [])
        .map((r) => (r.address ?? "").toLowerCase())
        .filter((a) => a.length > 0)
    );
    const uniqueAddresses = requestedAddresses.filter((addr) =>
      ownedSet.has(addr)
    );

    if (uniqueAddresses.length === 0) {
      return NextResponse.json(
        { error: "No matching wallets found for current user" },
        { status: 404 }
      );
    }

    // One App Kit call covers every owned address on every chain. The Circle
    // Wallets adapter is developer-controlled, so each source must include the
    // explicit address; `chains` is a per-source filter — we constrain it to
    // the four chains we actually support so App Kit doesn't probe the rest.
    // Failure here is non-fatal: zero out Gateway balances and let the UI
    // continue rendering on-wallet USDC from the viem path below.
    let breakdown: Awaited<
      ReturnType<ReturnType<typeof getAppKit>["unifiedBalance"]["getBalances"]>
    >["breakdown"] = [];

    try {
      const result = await getAppKit().unifiedBalance.getBalances({
        token: "USDC",
        sources: uniqueAddresses.map((address) => ({
          adapter: getCircleWalletsAdapter(),
          address,
          chains: QUERY_CHAINS,
        })),
        networkType: "testnet",
        includePending: true,
      });
      breakdown = result.breakdown;
    } catch (error) {
      console.error("App Kit getBalances failed:", error);
    }

    // Index App Kit's breakdown by depositor (lowercased) so we can attach
    // the per-address Gateway numbers below without repeated `.find()` work.
    const breakdownByDepositor = new Map(
      breakdown.map((entry) => [entry.depositor.toLowerCase(), entry])
    );

    // Fetch on-wallet (un-deposited) USDC for every owned address. Sequential
    // to avoid hammering the public RPCs — the four-chain loop is bounded.
    const balances = [];

    for (const address of uniqueAddresses) {
      const entry = breakdownByDepositor.get(address);

      const gatewayBalances: Array<{
        domain: number;
        balance: number;
        pendingBalance: number;
        chain: string;
        address: string;
      }> = [];
      let gatewayTotal = 0;
      let gatewayPending = 0;

      if (entry) {
        for (const chainBreakdown of entry.breakdown) {
          const appKitChain = chainBreakdown.chain as AppKitChain;
          const blockchain = BLOCKCHAIN_BY_APP_KIT_CHAIN[appKitChain];
          if (!blockchain) continue;
          const sdkChain = SDK_CHAIN_BY_BLOCKCHAIN[blockchain];
          const domain = sdkChain ? DOMAIN_IDS[sdkChain] : -1;

          const confirmed = parseFloat(chainBreakdown.confirmedBalance) || 0;
          const pending = parseFloat(chainBreakdown.pendingBalance ?? "0") || 0;

          gatewayBalances.push({
            domain,
            balance: confirmed,
            pendingBalance: pending,
            chain: sdkChain ?? "unknown",
            address,
          });

          gatewayTotal += confirmed;
          gatewayPending += pending;
        }
      }

      const chainBalances = [];
      for (const chain of SUPPORTED_CHAINS) {
        try {
          const balance = await getUsdcBalance(address as Address, chain);
          chainBalances.push({
            chain,
            balance: Number(balance) / 1_000_000,
            address,
          });
        } catch (error) {
          console.error(`Error fetching on-chain balance for ${chain}:`, error);
          chainBalances.push({ chain, balance: 0, address });
        }
      }

      const walletTotal = chainBalances.reduce((sum, cb) => sum + cb.balance, 0);

      balances.push({
        address,
        gatewayBalances,
        gatewayTotal,
        gatewayPending,
        chainBalances,
        walletTotal,
        totalBalance: gatewayTotal + walletTotal,
      });
    }

    const totalUnified = balances.reduce(
      (sum, b) => sum + (b.totalBalance || 0),
      0
    );
    const totalUnifiedPending = balances.reduce(
      (sum, b) => sum + (b.gatewayPending || 0),
      0
    );

    return NextResponse.json({
      success: true,
      totalUnified,
      totalUnifiedPending,
      balances,
    });
  } catch (error) {
    console.error("Error fetching balances:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
