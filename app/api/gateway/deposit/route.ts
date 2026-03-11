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
import {
  initiateDepositFromCustodialWallet,
  type SupportedChain,
} from "@/lib/circle/gateway-sdk";
import { createClient } from "@/lib/supabase/server";

// Helper to map DB blockchain strings to SDK SupportedChain types
const DB_CHAIN_TO_SDK: Record<string, SupportedChain> = {
  "ETH-SEPOLIA": "ethSepolia",
  "BASE-SEPOLIA": "baseSepolia",
  "AVAX-FUJI": "avalancheFuji",
  "ARC-TESTNET": "arcTestnet",
};

export async function POST(req: NextRequest) {
  let body: any = {};

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    body = await req.json();
    const { walletAddress, blockchain, amount } = body;

    if (!walletAddress || !blockchain || !amount) {
      return NextResponse.json(
        { error: "Missing required fields: walletAddress, blockchain, amount" },
        { status: 400 }
      );
    }

    // Convert amount to number
    const parsedAmount = parseFloat(amount);

    if (parsedAmount <= 0) {
      return NextResponse.json(
        { error: "Amount must be greater than 0" },
        { status: 400 }
      );
    }

    if (parsedAmount > 1_000_000_000) {
      return NextResponse.json(
        { error: "Amount exceeds maximum allowed value" },
        { status: 400 }
      )
    }

    // Fetch the specific wallet from Supabase to get ID, Chain, and Type
    // Filter by BOTH address AND blockchain to avoid multiple results
    const { data: wallet, error: walletError } = await supabase
      .from("wallets")
      .select("circle_wallet_id, blockchain, type, address")
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

    // Map the DB blockchain string to the SDK supported chain
    const sdkChain = DB_CHAIN_TO_SDK[wallet.blockchain];

    if (!sdkChain) {
      return NextResponse.json(
        { error: `Unsupported blockchain type: ${wallet.blockchain}` },
        { status: 400 }
      );
    }

    // Use proper rounding to avoid losing precision for small amounts
    const amountInAtomicUnits = BigInt(Math.round(parsedAmount * 1_000_000));
    
    if (amountInAtomicUnits === BigInt(0)) {
      return NextResponse.json(
        { error: "Amount too small. Minimum is 0.000001 USDC (1 atomic unit)." },
        { status: 400 }
      );
    }

    // All deposits (SCA and EOA) use the same Circle SDK method
    const tx = await initiateDepositFromCustodialWallet(
      wallet.circle_wallet_id,
      sdkChain,
      amountInAtomicUnits
    );

    // Store transaction in database
    await supabase.from("transactions").insert([
      {
        user_id: user.id,
        amount: parsedAmount,
        sender_address: walletAddress,
        recipient_address: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
        circle_transaction_id: tx.id,
        blockchain: wallet.blockchain,
        type: "OUTBOUND",
      },
    ]);

    return NextResponse.json({
      success: true,
      txHash: tx.txHash,
      chain: sdkChain,
      amount: parseFloat(amount),
    });
  } catch (error: any) {
    console.error("Error in deposit:", error);


    let errorMessage = "Internal server error";
    let statusCode = 500;

    if (error.message) {
      const msg = error.message.toLowerCase();
      if (msg.includes("gas") || msg.includes("intrinsic") || msg.includes("fee")) {
        errorMessage = "Insufficient gas. Please ensure the wallet has enough native tokens.";
        statusCode = 400;
      } else if (msg.includes("insufficient funds") || msg.includes("balance")) {
        errorMessage = "Insufficient USDC balance in the selected wallet.";
        statusCode = 400;
      } else if (msg.includes("network") || msg.includes("timeout")) {
        errorMessage = "Network error. Please try again.";
        statusCode = 503;
      } else if (error.message.length < 200) {
        errorMessage = error.message;
      }
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: statusCode }
    );
  }
}
