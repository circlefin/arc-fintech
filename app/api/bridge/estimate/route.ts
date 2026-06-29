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
import { fetchGatewayBalance } from "@/lib/circle/gateway-sdk";
import { assertWalletsOwnedByUser } from "@/lib/api/ownership";
import { validateJsonBody, blockchainSchema } from "@/lib/api/validate";
import { withAuth } from "@/lib/api/with-auth";
import {
  APP_KIT_CHAIN_BY_BLOCKCHAIN,
  SDK_CHAIN_BY_BLOCKCHAIN,
} from "@/lib/constants/chains";

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
    } = parsed.data;

    // App Kit expects amount in human-readable decimal format
    const amountString = amountNum.toFixed(2);

    // Map chains to App Kit format. The blockchain enum guarantees these
    // lookups succeed, but keep the guard to satisfy strict type checking.
    const bridgeSourceChain = APP_KIT_CHAIN_BY_BLOCKCHAIN[sourceChain];
    const bridgeDestChain = APP_KIT_CHAIN_BY_BLOCKCHAIN[destinationChain];

    if (!bridgeSourceChain || !bridgeDestChain) {
      return NextResponse.json(
        { error: "Unsupported chain" },
        { status: 400 }
      );
    }

    // Confirm both wallet IDs belong to the authenticated user before we
    // proxy any Circle SDK calls against them.
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

    // Check Gateway balance for instant transfer option
    let gatewayAvailable = false;
    let gatewayBalance = 0;

    try {
      const gatewaySourceChain = SDK_CHAIN_BY_BLOCKCHAIN[sourceChain];
      if (gatewaySourceChain) {
        const balanceData = await fetchGatewayBalance(sourceAddress as `0x${string}`);
        if (balanceData.balances && Array.isArray(balanceData.balances)) {
          // Find balance for the source chain
          const sourceChainBalance = balanceData.balances.find((b: any) => {
            const domainMapping: Record<number, string> = {
              0: "ethSepolia",
              1: "avalancheFuji",
              6: "baseSepolia",
              26: "arcTestnet"
            };
            return domainMapping[b.domain] === gatewaySourceChain;
          });

          if (sourceChainBalance && parseFloat(sourceChainBalance.balance) >= amountNum) {
            gatewayAvailable = true;
            gatewayBalance = parseFloat(sourceChainBalance.balance);
          }
        }
      }
    } catch (error) {
      console.log("Gateway balance check failed:", error);
      // Continue without Gateway option
    }

    const kit = getAppKit();
    const adapter = getCircleWalletsAdapter();
    const forwarderDestination = {
      chain: bridgeDestChain,
      recipientAddress: destAddress,
      useForwarder: true as const,
    };

    // Estimate costs for both FAST and SLOW transfers
    const estimates = await Promise.all([
      kit.estimateBridge({
        from: {
          adapter,
          chain: bridgeSourceChain,
          address: sourceAddress,
        },
        to: forwarderDestination,
        amount: amountString,
        config: {
          transferSpeed: "SLOW",
        },
      }),
      kit.estimateBridge({
        from: {
          adapter,
          chain: bridgeSourceChain,
          address: sourceAddress,
        },
        to: forwarderDestination,
        amount: amountString,
        config: {
          transferSpeed: "FAST",
        },
      }),
    ]);

    const [slowEstimate, fastEstimate] = estimates;

    // Helper to calculate total fees
    const calculateTotalFees = (estimate: any, speedType: string) => {
      let totalProtocolFees = 0;
      let gasFeesInfo: Array<{ chain: string; token: string; amount: string }> = [];
      let hasError = false;
      let errorMessage = "";

      // Sum protocol/service fees (USDC fees charged by Circle)
      if (estimate.fees && Array.isArray(estimate.fees)) {
        for (const fee of estimate.fees) {
          // Check for errors in fee estimation
          if (fee.error) {
            hasError = true;
            errorMessage = fee.error.message || "Fee estimation error";
          }
          
          // Fee amount might be null, empty string, or "0.0" for testnet
          if (fee.amount !== null && fee.amount !== undefined && fee.amount !== "" && fee.token === "USDC") {
            const feeAmount = parseFloat(fee.amount);
            if (!isNaN(feeAmount)) {
              totalProtocolFees += feeAmount;
            }
          }
        }
      }

      // Extract gas fees information
      if (estimate.gasFees && Array.isArray(estimate.gasFees)) {
        for (const gasFee of estimate.gasFees) {
          if (gasFee.fees && typeof gasFee.fees === "object") {
            const feeAmount = gasFee.fees.fee || gasFee.fees;
            gasFeesInfo.push({
              chain: gasFee.blockchain || gasFee.name || "Unknown",
              token: gasFee.token || "ETH",
              amount: typeof feeAmount === "string" ? feeAmount : feeAmount.toString(),
            });
          }
        }
      }

      return {
        protocolFees: totalProtocolFees.toFixed(6),
        hasGasFees: gasFeesInfo.length > 0,
        gasFeesInfo,
        hasError,
        errorMessage,
      };
    };

    const slowFees = calculateTotalFees(slowEstimate, "SLOW");
    const fastFees = calculateTotalFees(fastEstimate, "FAST");

    // Log the estimates for debugging
    console.log("SLOW estimate fees:", JSON.stringify(slowEstimate.fees, null, 2));
    console.log("FAST estimate fees:", JSON.stringify(fastEstimate.fees, null, 2));
    console.log("SLOW calculated:", slowFees);
    console.log("FAST calculated:", fastFees);

    // Helper function to recursively convert BigInt to strings
    const serializeBigInt = (obj: any): any => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === 'bigint') return obj.toString();
      if (Array.isArray(obj)) return obj.map(serializeBigInt);
      if (typeof obj === 'object') {
        const serialized: any = {};
        for (const key in obj) {
          serialized[key] = serializeBigInt(obj[key]);
        }
        return serialized;
      }
      return obj;
    };

    // Determine recommendation based on fees and errors
    let recommendation: "FAST" | "SLOW" = "SLOW";
    if (!fastFees.hasError && !slowFees.hasError) {
      // Both available - recommend based on fee
      recommendation = parseFloat(fastFees.protocolFees) < 1.0 ? "FAST" : "SLOW";
    } else if (fastFees.hasError && !slowFees.hasError) {
      // FAST has error, recommend SLOW
      recommendation = "SLOW";
    } else if (!fastFees.hasError && slowFees.hasError) {
      // SLOW has error, recommend FAST
      recommendation = "FAST";
    }

    return NextResponse.json({
      success: true,
      estimates: {
        slow: {
          transferSpeed: "SLOW",
          protocolFees: slowFees.protocolFees,
          hasGasFees: slowFees.hasGasFees,
          gasFeesInfo: slowFees.gasFeesInfo,
          estimatedTime: "10-20 minutes",
          available: !slowFees.hasError,
          errorMessage: slowFees.errorMessage || undefined,
          details: serializeBigInt(slowEstimate),
        },
        fast: {
          transferSpeed: "FAST",
          protocolFees: fastFees.protocolFees,
          hasGasFees: fastFees.hasGasFees,
          gasFeesInfo: fastFees.gasFeesInfo,
          estimatedTime: "1-3 minutes",
          available: !fastFees.hasError,
          errorMessage: fastFees.errorMessage || undefined,
          details: serializeBigInt(fastEstimate),
        },
        gateway: gatewayAvailable ? {
          transferSpeed: "INSTANT",
          protocolFees: "0.000000", // Gateway fees are paid upfront when depositing
          hasGasFees: false,
          gasFeesInfo: [],
          estimatedTime: "< 30 seconds",
          available: true,
          errorMessage: undefined,
          details: { gatewayBalance: gatewayBalance.toString() },
        } : null,
      },
      recommendation: gatewayAvailable ? "INSTANT" : recommendation,
      isTestnet: bridgeSourceChain.includes("Sepolia") || bridgeSourceChain.includes("Fuji") || bridgeSourceChain.includes("Testnet"),
      gatewayAvailable,
      warning:
        "Important: Ensure the source wallet has enough native currency for source-chain gas fees. Forwarding Service handles destination-chain mint submission.",
    });
  } catch (error) {
    console.error("Bridge estimate error:", error);
    return NextResponse.json(
      {
        error: "Failed to estimate fees",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
});
