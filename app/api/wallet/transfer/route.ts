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
import { validateJsonBody, evmAddressSchema } from "@/lib/api/validate";
import { withAuth } from "@/lib/api/with-auth";
import { CURRENCIES } from "@/lib/constants/currency";
import {
  getAppKitSendError,
  sendUsdcOnSameChainWithAppKit,
} from "@/lib/circle/app-kit-send";
import {
  abandonIdempotent,
  beginIdempotent,
  completeIdempotent,
  hashIdempotencyBody,
  readIdempotencyKey,
} from "@/lib/api/idempotency";

const bodySchema = z.object({
  sourceWalletId: z.string().min(1),
  destinationAddress: evmAddressSchema,
  amount: z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "string" ? Number(v) : v))
    .refine((n) => Number.isFinite(n) && n > 0, "Amount must be positive"),
  currency: z.enum(CURRENCIES).default("USDC"),
});

export const POST = withAuth(async (req, { user, supabase }) => {
  const idempotencyKey = readIdempotencyKey(req);
  let bodyHash = "";
  let admitted = false;

  try {
    const parsed = await validateJsonBody(req, bodySchema);
    if (!parsed.ok) return parsed.response;
    const { sourceWalletId, destinationAddress, amount, currency } = parsed.data;

    bodyHash = hashIdempotencyBody({
      sourceWalletId,
      destinationAddress,
      amount,
      currency,
    });
    const admission = beginIdempotent({
      surface: "wallet.transfer",
      userId: user.id,
      idempotencyKey,
      bodyHash,
    });
    if (admission.kind === "replay") return admission.response;
    if (admission.kind === "conflict" || admission.kind === "in_flight") {
      return admission.response;
    }
    admitted = true;

    // 1. Fetch Source Wallet to get its blockchain
    const { data: sourceWallet, error: sourceError } = await supabase
      .from("wallets")
      .select("blockchain, address")
      .eq("user_id", user.id)
      .eq("circle_wallet_id", sourceWalletId)
      .single();

    if (sourceError || !sourceWallet || !sourceWallet.blockchain) {
      abandonIdempotent({
        surface: "wallet.transfer",
        userId: user.id,
        idempotencyKey,
      });
      return NextResponse.json(
        { error: "Source wallet not found or missing blockchain data" },
        { status: 404 }
      );
    }

    const amountNum = amount;

    // From here a broadcast may occur; do not abandon the slot on later errors.
    const sendResult = await sendUsdcOnSameChainWithAppKit({
      sourceBlockchain: sourceWallet.blockchain,
      sourceWalletAddress: sourceWallet.address,
      recipientAddress: destinationAddress,
      amount: amount.toString(),
      token: currency,
    });

    // 4. Log to Transactions Table
    const { error: insertError } = await supabase.from("transactions").insert([
      {
        user_id: user.id,
        amount: amountNum,
        sender_address: sourceWallet.address,
        recipient_address: destinationAddress,
        tx_hash: sendResult.txHash ?? null,
        circle_transaction_id: sendResult.txId,
        blockchain: sourceWallet.blockchain,
        type: "OUTBOUND",
        currency,
        status: "PENDING",
      },
    ]);

    if (insertError) {
      console.error("Failed to log transaction to Supabase:", insertError);
    }

    const successBody = {
      success: true,
      txId: sendResult.txId,
      txHash: sendResult.txHash ?? null,
    };
    completeIdempotent({
      surface: "wallet.transfer",
      userId: user.id,
      idempotencyKey,
      bodyHash,
      responseBody: successBody,
    });
    return NextResponse.json(successBody);

  } catch (error: unknown) {
    console.error("Transfer error:", error);
    const mappedError = getAppKitSendError(error);
    const errorBody = {
      error: mappedError.error,
      userMessage: mappedError.userMessage,
    };
    // Cache the failure so a retry with the same key does not broadcast again.
    if (admitted && bodyHash) {
      completeIdempotent({
        surface: "wallet.transfer",
        userId: user.id,
        idempotencyKey,
        bodyHash,
        responseBody: errorBody,
        responseStatus: mappedError.status,
      });
    }
    return NextResponse.json(errorBody, { status: mappedError.status });
  }
});
