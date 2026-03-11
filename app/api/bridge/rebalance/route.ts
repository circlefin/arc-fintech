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

    // Validate transfer speed - Bridge Kit only accepts "FAST" or "SLOW"
    // "INSTANT" is for Gateway transfers, not CCTP bridge transfers
    if (transferSpeed !== "FAST" && transferSpeed !== "SLOW") {
      return NextResponse.json(
        { 
          error: "Invalid transfer speed",
          message: `Transfer speed must be "FAST" or "SLOW". Received: "${transferSpeed}". Note: "INSTANT" transfers should use Gateway API instead.`,
        },
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

    console.log(`Using Bridge Kit for ${transferSpeed} transfer: ${amountNum} USDC from ${sourceChain} to ${destinationChain}`);

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

    // Initialize Bridge Kit
    const kit = new BridgeKit();

    // Create Circle Wallets adapter
    const adapter = createCircleWalletsAdapter({
      apiKey: process.env.CIRCLE_API_KEY,
      entitySecret: process.env.CIRCLE_ENTITY_SECRET,
    });

    // Validate the transfer parameters early by running an estimate
    // This catches errors like insufficient balance before we commit to the transfer
    // However, note that estimate may not always catch destination chain gas issues
    try {
      console.log("Validating transfer parameters...");
      const estimateResult = await kit.estimate({
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
      }
      
      console.log("Transfer parameters validated successfully");
    } catch (validationError: any) {
      console.error("Transfer validation failed:", validationError);
      
      // Parse error type and provide user-friendly message
      let errorMessage = "Transfer validation failed";
      let errorDetails = validationError.message || "Unknown error";
      
      if (validationError.code === 9002 || validationError.type === 'BALANCE') {
        errorMessage = "Insufficient gas";
        errorDetails = `Not enough native currency to pay for gas fees. Please add funds to your wallets on both ${sourceChain} and ${destinationChain}.`;
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

    // Execute the bridge transfer in the background
    // We don't await this because it can take several minutes (waiting for finality)
    // which would timeout the API request.
    // Bridge Kit handles automatic forwarding - it will automatically:
    // 1. Burn USDC on source chain
    // 2. Wait for and fetch attestation from Circle's Iris service
    // 3. Mint USDC on destination chain
    // No manual finalization needed!
    (async () => {
      try {
        console.log("Starting background bridge execution with automatic forwarding...");

        // Helper to serialize BigInt
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

        // Setup event listeners to capture txHash and track progress
        let burnTxHash: string | null = null;
        let mintTxHash: string | null = null;

        // Listen for burn event (first step)
        kit.on('burn' as any, async (payload: any) => {
          console.log("Burn event received:", JSON.stringify(serializeBigInt(payload), null, 2));
          const hash = payload?.values?.txHash || payload?.txHash || payload?.data?.txHash;
          if (hash && !burnTxHash) {
            burnTxHash = hash;
            console.log(`Captured burn txHash: ${burnTxHash}`);
            await supabase
              .from("transactions")
              .update({
                tx_hash: burnTxHash,
                status: "PENDING",
              })
              .eq("id", txData.id);
          }
        });

        // Listen for attestation fetch event (shows automatic forwarding is working)
        kit.on('attestation' as any, async (payload: any) => {
          console.log("Attestation event received (automatic forwarding):", JSON.stringify(serializeBigInt(payload), null, 2));
        });

        // Listen for mint event (final step - automatic forwarding completed it!)
        kit.on('mint' as any, async (payload: any) => {
          console.log("Mint event received (automatic forwarding completed):", JSON.stringify(serializeBigInt(payload), null, 2));
          const hash = payload?.values?.txHash || payload?.txHash || payload?.data?.txHash;
          if (hash) {
            mintTxHash = hash;
            console.log(`Captured mint txHash: ${mintTxHash}`);
          }
        });

        // Execute the bridge transfer - Bridge Kit handles everything automatically
        const result = await kit.bridge({
          from: {
            adapter,
            chain: bridgeSourceChain as any,
            address: sourceAddress,
          },
          to: {
            adapter,
            chain: bridgeDestChain as any,
            address: destAddress,
            useForwarder: true, // Enable Circle Forwarding Service for automatic attestation and minting
          } as any, // Type assertion needed for useForwarder in Bridge Kit 1.1.2
          amount: amountString,
          config: {
            transferSpeed: transferSpeed as "FAST" | "SLOW",
          },
        });

        console.log("Bridge Kit transfer completed with automatic forwarding!");
        console.log("Result:", JSON.stringify(serializeBigInt(result), null, 2));

        // Extract transaction hashes from result
        if (!burnTxHash && result.steps && Array.isArray(result.steps)) {
          const burnStep = result.steps.find((step: any) => step.name === 'burn');
          if (burnStep?.txHash) {
            burnTxHash = burnStep.txHash;
          }
        }

        // Determine final status based on Bridge Kit result
        let finalStatus: string;
        if (result.state === 'success') {
          // Bridge Kit completed the entire flow including automatic minting
          finalStatus = 'COMPLETE';
          console.log("Transfer completed successfully with automatic forwarding!");
        } else if (result.state === 'error') {
          finalStatus = 'FAILED';
          console.error("Transfer failed:", result);
        } else {
          // Shouldn't happen, but keep as pending if state is unclear
          finalStatus = 'PENDING';
        }

        // Update DB with final result
        const { error: updateError } = await supabase
          .from("transactions")
          .update({
            tx_hash: burnTxHash,
            status: finalStatus,
          })
          .eq("id", txData.id);

        if (updateError) {
          console.error("Failed to update transaction in background:", updateError);
        }

      } catch (error: any) {
        console.error("Background rebalance error:", error);
        
        // Parse error and provide better logging
        let errorReason = "Unknown error";
        let detailedMessage = "";
        
        if (error.code === 9002 || error.type === 'BALANCE') {
          errorReason = "Insufficient gas";
          // Try to extract which chain has insufficient gas
          const errorMsg = error.message || "";
          if (errorMsg.includes('Avalanche Fuji')) {
            detailedMessage = "Insufficient gas on Avalanche Fuji (destination chain). Please add AVAX to the destination wallet.";
          } else if (errorMsg.includes('Arc')) {
            detailedMessage = "Insufficient gas on Arc Testnet (source chain). Please add native currency to the source wallet.";
          } else if (errorMsg.includes('Ethereum')) {
            detailedMessage = "Insufficient gas on Ethereum. Please add ETH to the wallet.";
          } else if (errorMsg.includes('Base')) {
            detailedMessage = "Insufficient gas on Base. Please add ETH to the wallet.";
          } else {
            detailedMessage = "Insufficient gas on source or destination chain. Please ensure both wallets have sufficient native currency for gas fees.";
          }
        } else if (error.code === 9001) {
          errorReason = "Insufficient USDC balance";
          detailedMessage = "Not enough USDC in the source wallet.";
        } else if (error.message) {
          errorReason = error.message;
          detailedMessage = error.message;
        }
        
        console.error(`Transfer failed: ${errorReason}`, detailedMessage || error);
        
        // Update DB to failed with error info
        await supabase
          .from("transactions")
          .update({ 
            status: "FAILED"
            // Note: We could add an error_message column to store detailedMessage
          })
          .eq("id", txData.id);
      }
    })();

    // Return success immediately to client
    return NextResponse.json({
      success: true,
      result: {
        amount: amountNum.toString(),
        txHash: null,
        status: "PENDING",
        state: "initiated",
        message: "Transfer initiated in background. Please check dashboard for updates.",
      },
    });
  } catch (error: any) {
    console.error("Rebalance error:", error);
    return NextResponse.json({ error: error.message || "Internal Error" }, { status: 500 });
  }
}
