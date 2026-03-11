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
 * @deprecated This endpoint is deprecated as of the Bridge Kit automatic forwarding integration.
 * 
 * Bridge Kit now handles automatic forwarding, which means:
 * - Attestations are fetched automatically
 * - Minting is done automatically on the destination chain
 * - No manual finalization is needed
 * 
 * This endpoint is kept for backward compatibility but should not be used for new transfers.
 * Use the /api/bridge/monitor endpoint to check transfer status instead.
 */
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
    const { txHash } = body;

    if (!txHash) {
      return NextResponse.json({ error: "Missing txHash" }, { status: 400 });
    }

    // Fetch transaction from DB
    const { data: tx, error: txError } = await supabase
      .from("transactions")
      .select("*")
      .eq("tx_hash", txHash)
      .eq("user_id", user.id)
      .single();

    if (txError || !tx) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    // Return deprecation warning with current status
    return NextResponse.json({
      deprecated: true,
      warning: "This endpoint is deprecated. Bridge Kit now handles automatic forwarding.",
      message: "Transfers initiated with Bridge Kit are automatically forwarded - attestation fetching and minting happen automatically.",
      recommendation: "Use /api/bridge/monitor?txHash=" + txHash + " to check transfer status instead.",
      currentStatus: tx.status,
      statusMessage:
        tx.status === "COMPLETE"
          ? "Transfer already completed via automatic forwarding"
          : tx.status === "PENDING"
          ? "Transfer in progress - Bridge Kit is handling automatic forwarding"
          : "Transfer failed",
    });

  } catch (error: any) {
    console.error("Finalize error:", error);
    return NextResponse.json({ error: error.message || "Internal Error" }, { status: 500 });
  }
}
