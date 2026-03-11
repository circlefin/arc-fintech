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
import { BridgeKit } from "@circle-fin/bridge-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { circleDeveloperSdk } from "@/lib/circle/developer-controlled-wallets-client";
import { createClient } from "@/lib/supabase/server";
import { fetchGatewayBalance, type SupportedChain } from "@/lib/circle/gateway-sdk";

// Map the blockchain identifiers used in the app to Bridge Kit supported chains
const CHAIN_MAPPING: Record<string, string> = {
  "ETH-SEPOLIA": "Ethereum_Sepolia",
  "AVAX-FUJI": "Avalanche_Fuji",
  "BASE-SEPOLIA": "Base_Sepolia",
  "ARC-TESTNET": "Arc_Testnet"
};

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      sourceWalletId,
      sourceChain,
      destinationWalletId,
      destinationChain,
      amount,
      transferSpeed = "SLOW",
    } = body;

    // Validate required fields
    if (
      !sourceWalletId ||
      !sourceChain ||
      !destinationWalletId ||
      !destinationChain ||
      !amount
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { error: "Invalid amount" },
        { status: 400 }
      );
    }

    // Bridge Kit expects amount in human-readable decimal format
    const amountString = amountNum.toFixed(2);

    // Map chains to Bridge Kit format
    const bridgeSourceChain = CHAIN_MAPPING[sourceChain];
    const bridgeDestChain = CHAIN_MAPPING[destinationChain];

    if (!bridgeSourceChain || !bridgeDestChain) {
      return NextResponse.json(
        { error: "Unsupported chain" },
        { status: 400 }
      );
    }

    // Get source wallet address
    const sourceWalletResponse = await circleDeveloperSdk.getWallet({
      id: sourceWalletId,
    });

    if (!sourceWalletResponse.data?.wallet?.address) {
      return NextResponse.json(
        { error: "Source wallet not found" },
        { status: 404 }
      );
    }

    const sourceAddress = sourceWalletResponse.data.wallet.address;

    // Get destination wallet address
    const destWalletResponse = await circleDeveloperSdk.getWallet({
      id: destinationWalletId,
    });

    if (!destWalletResponse.data?.wallet?.address) {
      return NextResponse.json(
        { error: "Destination wallet not found" },
        { status: 404 }
      );
    }

    const destAddress = destWalletResponse.data.wallet.address;

    // Validate environment variables
    if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
      return NextResponse.json(
        { error: "Circle API credentials not configured" },
        { status: 500 }
      );
    }

    // Check Gateway balance for instant transfer option
    let gatewayAvailable = false;
    let gatewayBalance = 0;

    try {
      // Map app chain names to Gateway SDK chain names
      const gatewayChainMapping: Record<string, SupportedChain> = {
        "ETH-SEPOLIA": "ethSepolia",
        "AVAX-FUJI": "avalancheFuji",
        "BASE-SEPOLIA": "baseSepolia",
        "ARC-TESTNET": "arcTestnet"
      };

      const gatewaySourceChain = gatewayChainMapping[sourceChain];
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

    // Initialize Bridge Kit
    const kit = new BridgeKit();

    // Create Circle Wallets adapter
    const adapter = createCircleWalletsAdapter({
      apiKey: process.env.CIRCLE_API_KEY,
      entitySecret: process.env.CIRCLE_ENTITY_SECRET,
    });

    // Estimate costs for both FAST and SLOW transfers
    const estimates = await Promise.all([
      // SLOW estimate
      kit.estimate({
        from: {
          adapter,
          chain: bridgeSourceChain as any,
          address: sourceAddress,
        },
        to: {
          adapter,
          chain: bridgeDestChain as any,
          address: destAddress,
        },
        amount: amountString,
        config: {
          transferSpeed: "SLOW",
        },
      }),
      // FAST estimate
      kit.estimate({
        from: {
          adapter,
          chain: bridgeSourceChain as any,
          address: sourceAddress,
        },
        to: {
          adapter,
          chain: bridgeDestChain as any,
          address: destAddress,
        },
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
      warning: "Important: Ensure both source and destination wallets have sufficient native currency for gas fees. The destination wallet will need gas to receive the minted USDC with automatic forwarding.",
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
}
