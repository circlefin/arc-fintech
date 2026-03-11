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

/**
 * Monitor endpoint to check the status of bridge transfers
 * With Bridge Kit's automatic forwarding, transfers are handled automatically:
 * - Burn happens on source chain
 * - Attestation is fetched automatically
 * - Mint happens automatically on destination chain
 * 
 * This endpoint just checks the current status from our database
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const txHash = searchParams.get("txHash");

    if (!txHash) {
      return NextResponse.json(
        { error: "Missing txHash parameter" },
        { status: 400 }
      );
    }

    // Fetch transaction from database
    const { data: tx, error: txError } = await supabase
      .from("transactions")
      .select("*")
      .eq("tx_hash", txHash)
      .eq("user_id", user.id)
      .single();

    if (txError || !tx) {
      return NextResponse.json(
        { error: "Transaction not found" },
        { status: 404 }
      );
    }

    // Return current status
    // Bridge Kit's automatic forwarding means:
    // - PENDING: Transfer in progress (burn done, waiting for attestation + mint)
    // - COMPLETE: Transfer fully completed (mint successful)
    // - FAILED: Something went wrong
    return NextResponse.json({
      success: true,
      transaction: {
        id: tx.id,
        txHash: tx.tx_hash,
        status: tx.status,
        amount: tx.amount,
        senderAddress: tx.sender_address,
        recipientAddress: tx.recipient_address,
        blockchain: tx.blockchain,
        type: tx.type,
        createdAt: tx.created_at,
        updatedAt: tx.updated_at,
      },
      message:
        tx.status === "COMPLETE"
          ? "Transfer completed successfully via automatic forwarding"
          : tx.status === "PENDING"
          ? "Transfer in progress - Bridge Kit is automatically handling attestation and minting"
          : "Transfer failed",
    });
  } catch (error: any) {
    console.error("Monitor error:", error);
    return NextResponse.json(
      {
        error: "Failed to check transfer status",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}