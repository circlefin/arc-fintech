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

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

type CircleNotification = {
  id: string;
  state: string;
  [k: string]: unknown;
};

interface CircleWebhookPayload {
  notificationType: string;
  notification: CircleNotification;
  [k: string]: unknown;
}

async function verifyCircleSignature(bodyString: string, signature: string, keyId: string): Promise<boolean> {
  try {
    const publicKey = await getCirclePublicKey(keyId);
    const verifier = crypto.createVerify("SHA256");
    verifier.update(bodyString);
    verifier.end();
    const signatureUint8Array = Uint8Array.from(Buffer.from(signature, "base64"));
    return verifier.verify(publicKey, signatureUint8Array);
  } catch (e) {
    console.error("Signature `verification` failure:", e);
    return false;
  }
}

async function getCirclePublicKey(keyId: string) {
  if (!process.env.CIRCLE_API_KEY) throw new Error("Circle API key is not set");
  const response = await fetch(`https://api.circle.com/v2/notifications/publicKey/${keyId}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${process.env.CIRCLE_API_KEY}` },
  });
  if (!response.ok) throw new Error(`Failed to fetch public key`);
  const data = await response.json();
  const rawPublicKey = data?.data?.publicKey;
  return ["-----BEGIN PUBLIC KEY-----", ...(rawPublicKey.match(/.{1,64}/g) ?? []), "-----END PUBLIC KEY-----"].join("\n");
}

// Helper to wait (for retries)
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get("x-circle-signature");
    const keyId = req.headers.get("x-circle-key-id");

    if (!signature || !keyId) return NextResponse.json({ error: "Missing headers" }, { status: 400 });

    const rawBody = await req.text();
    const isVerified = await verifyCircleSignature(rawBody, signature, keyId);
    if (!isVerified) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });

    const body: CircleWebhookPayload = JSON.parse(rawBody);
    const { notificationType, notification } = body;

    if (notificationType === "transactions.outbound" || notificationType === "transactions.inbound") {
      // DB Enum only supports 'PENDING', 'CONFIRMED', 'COMPLETE'
      const statusMap: Record<string, "CONFIRMED" | "COMPLETE" | null> = {
        CONFIRMED: "CONFIRMED",
        COMPLETE: "COMPLETE",
        FAILED: null, // Cannot map FAILED to DB Enum
      };

      const newStatus = statusMap[notification.state];

      if (notification.state === "FAILED") {
        console.error(`Transaction ${notification.id} FAILED on chain. Reason: ${(notification as any).errorReason}`);
        // Optional: Delete transaction or mark differently if possible. 
        // For now, we skip update to avoid DB error.
      } else if (newStatus) {
        const txHash = (notification as any).txHash;

        // Retry Logic Configuration
        let attempts = 0;
        let updated = false;
        const MAX_ATTEMPTS = 10;
        const RETRY_DELAY_MS = 3000;

        while (attempts < MAX_ATTEMPTS && !updated) {
          // Try circle_transaction_id first (works for OUTBOUND, deposits, etc.)
          // Then fallback to tx_hash for REBALANCE transactions (which don't have circle_transaction_id)

          // 1. First attempt: Match by circle_transaction_id (standard transactions like OUTBOUND)
          const updateData: any = {
            status: newStatus,
            circle_transaction_id: notification.id,
            updated_at: new Date().toISOString(),
          };
          
          // Add tx_hash to update if available
          if (txHash) {
            updateData.tx_hash = txHash;
          }
          
          const standardQuery = supabaseAdmin
            .from("transactions")
            .update(updateData)
            .eq("circle_transaction_id", notification.id);

          const { error: standardError, count: standardCount } = await standardQuery.select("id");

          if (standardError) {
            console.error("Supabase update error (standard):", standardError);
            break;
          }

          if (standardCount && standardCount > 0) {
            updated = true;
            break;
          }

          // 2. Second attempt: If we have a txHash and first attempt failed, try matching REBALANCE by tx_hash
          if (txHash) {
            const rebalanceUpdateData: any = {
              status: newStatus,
              circle_transaction_id: notification.id,
              tx_hash: txHash,
              updated_at: new Date().toISOString(),
            };
            
            const rebalanceQuery = supabaseAdmin
              .from("transactions")
              .update(rebalanceUpdateData)
              .eq("tx_hash", txHash)
              .eq("type", "REBALANCE");

            const { error: rebalanceError, count: rebalanceCount } = await rebalanceQuery.select("id");

            if (rebalanceError) {
              console.error("Supabase update error (rebalance):", rebalanceError);
              break;
            }

          if (rebalanceCount && rebalanceCount > 0) {
            updated = true;
            break;
          }
          }

          // Neither match found yet, retry after delay
          attempts++;
          if (attempts < MAX_ATTEMPTS) {
            await wait(RETRY_DELAY_MS);
          }
        }

      }
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function HEAD() {
  return NextResponse.json({}, { status: 200 });
}
