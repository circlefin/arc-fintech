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
import { z } from "zod";
import {
  getErrorCode,
  isBalanceError,
  isInputError,
  isKitError,
  isNetworkError,
} from "@circle-fin/app-kit";

// App Kit balance error codes — see `BalanceError` in
// node_modules/@circle-fin/app-kit/index.d.ts (lines 7715-7728).
const BALANCE_INSUFFICIENT_TOKEN = 9001;
const BALANCE_INSUFFICIENT_GAS = 9002;
const BALANCE_INSUFFICIENT_ALLOWANCE = 9003;
import { getAppKit, getCircleWalletsAdapter } from "@/lib/circle/app-kit";
import { GATEWAY_WALLET_ADDRESS } from "@/lib/circle/gateway-sdk";
import {
  validateJsonBody,
  blockchainSchema,
  evmAddressSchema,
} from "@/lib/api/validate";
import { APP_KIT_CHAIN_BY_BLOCKCHAIN } from "@/lib/constants/chains";
import { withAuth } from "@/lib/api/with-auth";

// App Kit's `unifiedBalance.deposit` runs the approve + deposit pair through
// Developer Controlled Wallets and waits for both to confirm. On busy testnets
// that can take longer than the default Vercel function window, so we extend
// the route's max execution time to match the bridge route.
export const maxDuration = 60;

const bodySchema = z.object({
  walletAddress: evmAddressSchema,
  blockchain: blockchainSchema,
  amount: z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "string" ? Number(v) : v))
    .refine((n) => Number.isFinite(n) && n > 0, "Amount must be positive")
    .refine((n) => n <= 1_000_000_000, "Amount exceeds maximum allowed value"),
});

export const POST = withAuth(async (req, { user, supabase }) => {
  try {
    const parsed = await validateJsonBody(req, bodySchema);
    if (!parsed.ok) return parsed.response;
    const { walletAddress, blockchain, amount } = parsed.data;

    // Filter by BOTH address AND blockchain to avoid multiple results — the
    // same EVM address can appear on multiple chains for the same user. RLS
    // already restricts to this user, but we re-filter on user_id for defense
    // in depth.
    const { data: wallet, error: walletError } = await supabase
      .from("wallets")
      .select("circle_wallet_id, blockchain, address")
      .eq("user_id", user.id)
      .eq("address", walletAddress)
      .eq("blockchain", blockchain)
      .single();

    if (walletError || !wallet) {
      return NextResponse.json(
        { error: "Wallet not found or does not belong to user." },
        { status: 404 }
      );
    }

    const appKitChain = APP_KIT_CHAIN_BY_BLOCKCHAIN[wallet.blockchain];
    if (!appKitChain) {
      return NextResponse.json(
        { error: `Unsupported blockchain type: ${wallet.blockchain}` },
        { status: 400 }
      );
    }

    // App Kit's Circle Wallets adapter is "developer-controlled" — every call
    // must pass `address` so the adapter knows which Circle wallet to use.
    // The adapter resolves the underlying `circle_wallet_id` from the address,
    // so we don't pass it explicitly.
    const result = await getAppKit().unifiedBalance.deposit({
      from: {
        adapter: getCircleWalletsAdapter(),
        chain: appKitChain,
        address: wallet.address,
      },
      amount: amount.toString(),
      token: "USDC",
    });

    // Persist the deposit as an OUTBOUND transaction with `recipient_address`
    // pointing at the Gateway wallet contract. `isGatewayDepositRecipient`
    // (used in dashboard activity) keys off this address, and the webhook
    // route uses tx_hash as the fallback match for OUTBOUND/REBALANCE rows
    // that don't have a Circle DCW transaction id (see app/api/circle/webhook).
    await supabase.from("transactions").insert([
      {
        user_id: user.id,
        amount,
        sender_address: walletAddress,
        recipient_address: GATEWAY_WALLET_ADDRESS,
        tx_hash: result.txHash,
        circle_transaction_id: null,
        blockchain: wallet.blockchain,
        type: "OUTBOUND",
        status: "PENDING",
      },
    ]);

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      chain: result.chain,
      amount: result.amount,
    });
  } catch (error: unknown) {
    console.error("Error in deposit:", error);

    // App Kit error taxonomy: BalanceError covers three distinct
    // failure modes (insufficient USDC, insufficient native gas,
    // insufficient ERC-20 allowance) — they share the same class but
    // map to very different user-facing messages, so we discriminate by
    // numeric code first. InputError → bad parameters. NetworkError →
    // transient RPC failure. KitError → fall-through.
    if (isBalanceError(error)) {
      const code = getErrorCode(error);
      if (code === BALANCE_INSUFFICIENT_GAS) {
        // App Kit's own message is already user-friendly and chain-aware
        // (e.g. "Insufficient ETH on Base Sepolia to cover gas fees"),
        // so we surface it verbatim instead of a generic stand-in.
        return NextResponse.json(
          {
            error:
              error.message ||
              "Insufficient native gas token on the source chain.",
          },
          { status: 400 }
        );
      }
      if (code === BALANCE_INSUFFICIENT_ALLOWANCE) {
        return NextResponse.json(
          {
            error:
              "USDC allowance too low for the Gateway contract. Try again — App Kit will re-issue the approval.",
          },
          { status: 400 }
        );
      }
      // Default + BALANCE_INSUFFICIENT_TOKEN — actual USDC shortfall.
      void BALANCE_INSUFFICIENT_TOKEN;
      return NextResponse.json(
        { error: "Insufficient USDC balance in the selected wallet." },
        { status: 400 }
      );
    }

    if (isInputError(error)) {
      return NextResponse.json(
        { error: error.message || "Invalid deposit request." },
        { status: 400 }
      );
    }

    if (isNetworkError(error)) {
      return NextResponse.json(
        { error: "Network error contacting the chain. Please try again." },
        { status: 503 }
      );
    }

    let errorMessage = "Internal server error";
    let statusCode = 500;
    if (error instanceof Error && error.message) {
      const msg = error.message.toLowerCase();
      if (msg.includes("timeout")) {
        errorMessage = "The deposit timed out. Refresh balances shortly.";
        statusCode = 503;
      } else if (isKitError(error) && error.message.length < 200) {
        errorMessage = error.message;
      }
    }

    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
});
