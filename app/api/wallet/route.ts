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
import { circleDeveloperSdk } from "@/lib/circle/developer-controlled-wallets-client";
import {
  initiateDepositFromCustodialWallet,
  type SupportedChain,
} from "@/lib/circle/gateway-sdk";
import { createClient } from "@/lib/supabase/server";

const DB_CHAIN_TO_SDK: Record<string, SupportedChain> = {
  "ETH-SEPOLIA": "ethSepolia",
  "BASE-SEPOLIA": "baseSepolia",
  "AVAX-FUJI": "avalancheFuji",
  "ARC-TESTNET": "arcTestnet",
};

export async function POST(req: NextRequest) {
  try {
    const { walletSetId, blockchain } = await req.json();

    if (!walletSetId || !blockchain) {
      return NextResponse.json(
        { error: "walletSetId and blockchain are required" },
        { status: 400 }
      );
    }

    // Create 1 wallet in the specified set on the specified chain
    const response = await circleDeveloperSdk.createWallets({
      walletSetId: walletSetId,
      blockchains: [blockchain],
      count: 1,
      accountType: "SCA", // Smart Contract Account (Gasless compatible) or "EOA"
    });

    if (
      !response.data ||
      !response.data.wallets ||
      response.data.wallets.length === 0
    ) {
      return NextResponse.json(
        { error: "The response did not include a valid wallet" },
        { status: 500 }
      );
    }

    // After creating the wallet, register the gateway signer
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: eoaWallet } = await supabase
          .from("wallets")
          .select("address")
          .eq("user_id", user.id)
          .eq("blockchain", blockchain)
          .eq("type", "gateway_signer")
          .single();

        if (eoaWallet) {
          console.log(
            `Will add EOA delegate ${eoaWallet.address} for depositor ${response.data.wallets[0].address}`
          );
          await initiateDepositFromCustodialWallet(
            response.data.wallets[0].id as string,
            DB_CHAIN_TO_SDK[blockchain],
            BigInt(0),
            eoaWallet.address as any
          );
        }
      }
    } catch (error) {
      console.error("Failed to register delegate for gateway:", error);
      // Do not block wallet creation if delegation fails, just log the error
    }

    // Return the first (and only) wallet created
    return NextResponse.json({ ...response.data.wallets[0] }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Wallet creation failed: ${error.message}`);
    }

    return NextResponse.json(
      { error: "Failed to create wallet" },
      { status: 500 }
    );
  }
}
