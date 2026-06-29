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
import { getAppKit, getCircleWalletsAdapter } from "@/lib/circle/app-kit";
import { assertWalletsOwnedByUser } from "@/lib/api/ownership";
import { validateJsonBody, blockchainSchema } from "@/lib/api/validate";
import { APP_KIT_CHAIN_BY_BLOCKCHAIN } from "@/lib/constants/chains";
import { withAuth } from "@/lib/api/with-auth";

// Allow this handler to run for up to 60s — App Kit FAST transfers
// finish in 1-3 minutes but most testnet flows complete inside the budget,
// and any longer outcome is reported back via webhook + the tx row update.
export const maxDuration = 60;

const bodySchema = z.object({
  sourceWalletId: z.string().min(1),
  sourceChain: blockchainSchema,
  destinationWalletId: z.string().min(1),
  destinationChain: blockchainSchema,
  amount: z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "string" ? Number(v) : v))
    .refine((n) => Number.isFinite(n) && n > 0, "Amount must be positive"),
  transferSpeed: z.enum(["FAST", "SLOW"]).default("SLOW"),
});

export const POST = withAuth(async (request, { user, supabase }) => {
  try {
    const parsed = await validateJsonBody(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    const {
      sourceWalletId,
      sourceChain,
      destinationWalletId,
      destinationChain,
      amount: amountNum,
      transferSpeed,
    } = parsed.data;

    // App Kit expects amount in human-readable decimal format
    const amountString = amountNum.toFixed(2);
    let estimatedBridgeFee = 0;

    // Map chains to App Kit format
    const bridgeSourceChain = APP_KIT_CHAIN_BY_BLOCKCHAIN[sourceChain];
    const bridgeDestChain = APP_KIT_CHAIN_BY_BLOCKCHAIN[destinationChain];

    if (!bridgeSourceChain || !bridgeDestChain) {
      return NextResponse.json(
        { error: "Unsupported chain" },
        { status: 400 }
      );
    }

    // Confirm both wallet IDs belong to the authenticated user before we
    // execute any bridge operation against them.
    const owned = await assertWalletsOwnedByUser(supabase, user.id, [
      sourceWalletId,
      destinationWalletId,
    ]);
    if (!owned) {
      return NextResponse.json(
        { error: "Wallet not found" },
        { status: 404 }
      );
    }

    const sourceAddress =
      owned.find((w) => w.circle_wallet_id === sourceWalletId)?.address;
    const destAddress =
      owned.find((w) => w.circle_wallet_id === destinationWalletId)?.address;

    if (!sourceAddress || !destAddress) {
      return NextResponse.json(
        { error: "Wallet not found" },
        { status: 404 }
      );
    }

    console.log(`Using App Kit for ${transferSpeed} transfer: ${amountNum} USDC from ${sourceChain} to ${destinationChain}`);

    // Minimum transfer amount validation
    // FAST transfers have higher fees that can exceed very small amounts
    // Enforce a reasonable minimum to avoid "max fee must be less than amount" errors
    const MIN_TRANSFER_AMOUNT = transferSpeed === "FAST" ? 5.0 : 2.0;
    if (amountNum < MIN_TRANSFER_AMOUNT) {
      return NextResponse.json(
        { 
          error: "Amount too small",
          message: `Minimum transfer amount for ${transferSpeed} transfers is ${MIN_TRANSFER_AMOUNT} USDC. Your amount: ${amountNum} USDC. Try a larger amount or use ${transferSpeed === "FAST" ? "SLOW" : "a different"} transfer speed.`,
          minAmount: MIN_TRANSFER_AMOUNT,
          currentAmount: amountNum,
        },
        { status: 400 }
      );
    }

    const kit = getAppKit();
    const adapter = getCircleWalletsAdapter();
    const forwarderDestination = {
      chain: bridgeDestChain,
      recipientAddress: destAddress,
      useForwarder: true as const,
    };

    // Validate the transfer parameters early by running an estimate
    // This catches errors like insufficient balance before we commit to the transfer
    // However, note that estimate may not always catch relay/runtime execution issues
    try {
      console.log("Validating transfer parameters...");
      const estimateResult = await kit.estimateBridge({
        from: {
          adapter,
          chain: bridgeSourceChain,
          address: sourceAddress,
        },
        to: forwarderDestination,
        amount: amountString,
        config: {
          transferSpeed: transferSpeed as "FAST" | "SLOW",
        },
      });
      
      // Check if estimate has any fee errors
      if (estimateResult.fees && Array.isArray(estimateResult.fees)) {
        const feeErrors = estimateResult.fees.filter((fee: any) => fee.error);
        if (feeErrors.length > 0) {
          const errorMsg = feeErrors.map((f: any) => f.error.message).join('; ');
          throw new Error(`Fee estimation failed: ${errorMsg}`);
        }

        estimatedBridgeFee = estimateResult.fees.reduce(
          (total: number, fee: any) => {
            if (fee.token !== "USDC") return total;
            const parsedFee = Number(fee.amount);
            return Number.isFinite(parsedFee) ? total + parsedFee : total;
          },
          0
        );
      }
      
      console.log("Transfer parameters validated successfully");
    } catch (validationError: any) {
      console.error("Transfer validation failed:", validationError);
      
      // Parse error type and provide user-friendly message
      let errorMessage = "Transfer validation failed";
      let errorDetails = validationError.message || "Unknown error";
      
      if (validationError.code === 9002 || validationError.type === 'BALANCE') {
        errorMessage = "Insufficient gas";
        errorDetails = `Not enough native currency to pay source-chain gas fees. Please fund the source wallet on ${sourceChain}.`;
      } else if (validationError.code === 9001 || validationError.message?.includes('Insufficient balance')) {
        errorMessage = "Insufficient USDC balance";
        errorDetails = `Not enough USDC in the source wallet to complete the transfer.`;
      } else if (validationError.type === 'INPUT') {
        errorMessage = "Invalid transfer parameters";
        errorDetails = validationError.message;
      }
      
      return NextResponse.json(
        { 
          error: errorMessage,
          message: errorDetails,
          code: validationError.code,
          type: validationError.type,
        },
        { status: 400 }
      );
    }

    const bridgeAmountString = (amountNum + estimatedBridgeFee).toFixed(6);

    // Log initial PENDING state to DB immediately
    const { data: txData, error: txError } = await supabase
      .from("transactions")
      .insert([
        {
          user_id: user.id,
          amount: amountNum,
          sender_address: sourceAddress,
          recipient_address: destAddress,
          tx_hash: null, // Will be updated when available
          circle_transaction_id: null,
          blockchain: sourceChain,
          type: "REBALANCE",
          status: "PENDING",
        },
      ])
      .select()
      .single();

    if (txError) {
      throw new Error(`Failed to create transaction record: ${txError.message}`);
    }

    // Execute the bridge transfer synchronously and respond when it
    // resolves (or fails). App Kit's forwarder handles burn ->
    // attestation -> mint, so on success the row is COMPLETE before we
    // return; on a transient timeout we surface 202 PENDING and the row
    // stays PENDING for the webhook / monitor poll to advance.
    const serializeBigInt = (obj: any): any => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === "bigint") return obj.toString();
      if (Array.isArray(obj)) return obj.map(serializeBigInt);
      if (typeof obj === "object") {
        const serialized: any = {};
        for (const key in obj) {
          serialized[key] = serializeBigInt(obj[key]);
        }
        return serialized;
      }
      return obj;
    };

    let burnTxHash: string | null = null;
    let mintTxHash: string | null = null;
    const extractTxHash = (payload: any): string | null =>
      payload?.values?.txHash ??
      payload?.txHash ??
      payload?.data?.txHash ??
      payload?.values?.forwardTxHash ??
      payload?.data?.forwardTxHash ??
      payload?.values?.attestation?.forwardTxHash ??
      payload?.data?.attestation?.forwardTxHash ??
      null;

    kit.on("bridge.burn", async (payload: any) => {
      const hash = extractTxHash(payload);
      if (hash && !burnTxHash) {
        burnTxHash = hash;
        await supabase
          .from("transactions")
          .update({ tx_hash: burnTxHash, status: "PENDING" })
          .eq("id", txData.id);
      }
    });

    kit.on("bridge.mint", async (payload: any) => {
      const hash = extractTxHash(payload);
      if (hash) mintTxHash = hash;
    });

    try {
      const result = await kit.bridge({
        from: {
          adapter,
          chain: bridgeSourceChain,
          address: sourceAddress,
        },
        to: forwarderDestination,
        amount: bridgeAmountString,
        config: {
          transferSpeed: transferSpeed as "FAST" | "SLOW",
        },
      });

      if (!burnTxHash && result.steps && Array.isArray(result.steps)) {
        const burnStep = result.steps.find((step: any) => step.name === "burn");
        burnTxHash = extractTxHash(burnStep);
      }

      // Forwarder-only destinations may surface completion hash on mint or
      // attestation-oriented steps instead of a traditional destination mint tx.
      if (!mintTxHash && result.steps && Array.isArray(result.steps)) {
        const forwarderStep = result.steps.find((step: any) =>
          ["mint", "fetchAttestation", "reAttest"].includes(step?.name)
        );
        mintTxHash = extractTxHash(forwarderStep);
      }

      const finalStatus =
        result.state === "success"
          ? "COMPLETE"
          : result.state === "error"
            ? "FAILED"
            : "PENDING";

      const { error: updateError } = await supabase
        .from("transactions")
        .update({ tx_hash: burnTxHash, status: finalStatus })
        .eq("id", txData.id);

      if (updateError) {
        console.error("Failed to update transaction:", updateError);
      }

      return NextResponse.json({
        success: result.state === "success",
        result: {
          amount: amountNum.toString(),
          txHash: burnTxHash,
          mintTxHash: mintTxHash || undefined,
          status: finalStatus,
          state: result.state,
          details: serializeBigInt(result),
        },
      });
    } catch (bridgeError: any) {
      console.error("Bridge execution error:", bridgeError);

      // Map common App Kit errors to friendlier messages.
      let userMessage = bridgeError.message || "Bridge transfer failed";
      if (bridgeError.code === 9002 || bridgeError.type === "BALANCE") {
        userMessage =
          "Insufficient source-chain gas. Ensure the source wallet has native currency for gas fees.";
      } else if (bridgeError.code === 9001) {
        userMessage = "Not enough USDC in the source wallet.";
      }

      await supabase
        .from("transactions")
        .update({ status: "FAILED", tx_hash: burnTxHash })
        .eq("id", txData.id);

      return NextResponse.json(
        {
          success: false,
          error: "Bridge transfer failed",
          message: userMessage,
          code: bridgeError.code,
          type: bridgeError.type,
          txId: txData.id,
        },
        { status: 502 }
      );
    }
  } catch (error: any) {
    console.error("Rebalance error:", error);
    return NextResponse.json(
      { error: error.message || "Internal Error" },
      { status: 500 }
    );
  }
});
