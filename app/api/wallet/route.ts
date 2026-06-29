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
import { Blockchain } from "@circle-fin/developer-controlled-wallets";
import { circleDeveloperSdk } from "@/lib/circle/developer-controlled-wallets-client";
import { initiateDepositFromCustodialWallet } from "@/lib/circle/gateway-sdk";
import { createClient } from "@/lib/supabase/server";
import { SDK_CHAIN_BY_BLOCKCHAIN as DB_CHAIN_TO_SDK } from "@/lib/constants/chains";
import { withAuth } from "@/lib/api/with-auth";

/**
 * Resolve which Circle wallet set the new wallet should be created in.
 * Strategy:
 *   1. If the user already has at least one Circle-managed wallet, reuse
 *      that wallet's wallet set. This avoids accumulating one wallet set
 *      per wallet for the same user.
 *   2. Otherwise, create a fresh wallet set server-side. This means the
 *      caller never gets to nominate a wallet set, which closes the hole
 *      where an attacker could pass someone else's walletSetId.
 */
async function resolveWalletSetId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  fallbackEntityName: string
): Promise<string> {
  const { data: existingWallets, error } = await supabase
    .from("wallets")
    .select("circle_wallet_id")
    .eq("user_id", userId)
    .neq("type", "gateway_signer")
    .not("circle_wallet_id", "is", null)
    .limit(1);

  if (error) {
    throw new Error(`Failed to look up existing wallets: ${error.message}`);
  }

  if (existingWallets && existingWallets.length > 0) {
    const refId = existingWallets[0].circle_wallet_id as string;
    const refWallet = await circleDeveloperSdk.getWallet({ id: refId });
    const setId = refWallet.data?.wallet?.walletSetId;
    if (setId) {
      return setId;
    }
  }

  // No existing wallets (or we couldn't resolve a set id) — create a new set.
  const setResp = await circleDeveloperSdk.createWalletSet({
    name: fallbackEntityName,
  });
  const newSetId = setResp.data?.walletSet?.id;
  if (!newSetId) {
    throw new Error("Circle did not return a wallet set id");
  }
  return newSetId;
}

// Authenticate FIRST. Creating a Circle wallet bills our entity, so we must
// never call the SDK on behalf of an unauthenticated request — `withAuth`
// enforces that.
export const POST = withAuth(async (req, { user, supabase }) => {
  try {
    const body = await req.json();
    const blockchain: string | undefined = body?.blockchain;
    const name: string | undefined = body?.name;

    if (!blockchain) {
      return NextResponse.json(
        { error: "blockchain is required" },
        { status: 400 }
      );
    }

    if (!DB_CHAIN_TO_SDK[blockchain]) {
      return NextResponse.json(
        { error: `Unsupported blockchain: ${blockchain}` },
        { status: 400 }
      );
    }

    // Always derive the wallet set server-side. The client used to pass
    // walletSetId, which let an attacker target someone else's wallet set;
    // now the server picks a set the calling user actually owns (or creates
    // a fresh one).
    const fallbackName = (name && name.trim()) || `User ${user.id.slice(0, 8)} wallets`;
    const walletSetId = await resolveWalletSetId(supabase, user.id, fallbackName);

    const response = await circleDeveloperSdk.createWallets({
      walletSetId,
      // Safe cast: we just validated `blockchain` against DB_CHAIN_TO_SDK above,
      // and that map's keys are exactly the four Blockchain enum values we use.
      blockchains: [blockchain as Blockchain],
      count: 1,
      accountType: "SCA",
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

    const newWallet = response.data.wallets[0];

    // After creating the wallet, register the gateway signer if one exists.
    try {
      const { data: eoaWallet } = await supabase
        .from("wallets")
        .select("address")
        .eq("user_id", user.id)
        .eq("blockchain", blockchain)
        .eq("type", "gateway_signer")
        .single();

      if (eoaWallet) {
        console.log(
          `Will add EOA delegate ${eoaWallet.address} for depositor ${newWallet.address}`
        );
        await initiateDepositFromCustodialWallet(
          newWallet.id as string,
          DB_CHAIN_TO_SDK[blockchain],
          BigInt(0),
          eoaWallet.address as `0x${string}`
        );
      }
    } catch (error) {
      console.error("Failed to register delegate for gateway:", error);
      // Do not block wallet creation if delegation fails; just log.
    }

    return NextResponse.json({ ...newWallet }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Wallet creation failed: ${error.message}`);
    }

    return NextResponse.json(
      { error: "Failed to create wallet" },
      { status: 500 }
    );
  }
});
