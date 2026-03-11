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
import { CHAIN_TO_USDC_ADDRESS } from "@/lib/constants/usdc-addresses";

// Helper to convert USDC amount to atomic units (6 decimals)
function convertToSmallestUnit(amount: string): string {
  const val = parseFloat(amount);
  if (isNaN(val)) return "0";
  return BigInt(Math.floor(val * 1_000_000)).toString();
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sourceWalletId, destinationAddress, amount } = await req.json();

    if (!sourceWalletId || !destinationAddress || !amount) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // 1. Fetch Source Wallet to get its blockchain
    const { data: sourceWallet, error: sourceError } = await supabase
      .from("wallets")
      .select("blockchain, address")
      .eq("user_id", user.id)
      .eq("circle_wallet_id", sourceWalletId)
      .single();

    if (sourceError || !sourceWallet || !sourceWallet.blockchain) {
      return NextResponse.json(
        { error: "Source wallet not found or missing blockchain data" },
        { status: 404 }
      );
    }

    const amountNum = parseFloat(amount);

    // 2. Get the USDC contract address for the source wallet's chain
    const usdcContractAddress = CHAIN_TO_USDC_ADDRESS[sourceWallet.blockchain];

    if (!usdcContractAddress) {
      return NextResponse.json(
        { error: `USDC contract not found for chain: ${sourceWallet.blockchain}` },
        { status: 400 }
      );
    }

    const response = await circleDeveloperSdk.createContractExecutionTransaction({
      walletId: sourceWalletId,
      contractAddress: usdcContractAddress,
      abiFunctionSignature: "transfer(address,uint256)",
      abiParameters: [
        destinationAddress,
        convertToSmallestUnit(amount),
      ],
      fee: {
        type: "level",
        config: {
          feeLevel: "HIGH",
        },
      },
    });

    const transactionData = response.data;

    if (!transactionData?.id) {
      throw new Error("Failed to initiate transfer with Circle API.");
    }

    // 4. Log to Transactions Table
    const { error: insertError } = await supabase.from("transactions").insert([
      {
        user_id: user.id,
        amount: amountNum,
        sender_address: sourceWallet.address,
        recipient_address: destinationAddress,
        circle_transaction_id: transactionData.id,
        blockchain: sourceWallet.blockchain,
        type: "OUTBOUND",
        status: "PENDING",
      },
    ]);

    if (insertError) {
      console.error("Failed to log transaction to Supabase:", insertError);
    }

    return NextResponse.json({
      success: true,
      txId: transactionData.id,
    });

  } catch (error: any) {
    console.error("Transfer error:", error);
    
    // Log detailed error information
    if (error?.response?.data) {
      console.error("Circle API error details:", JSON.stringify(error.response.data, null, 2));
    }

    let errorMessage = "Internal server error";
    if (error?.response?.data?.message) {
      errorMessage = error.response.data.message;
    } else if (error?.response?.data?.error) {
      errorMessage = error.response.data.error;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
