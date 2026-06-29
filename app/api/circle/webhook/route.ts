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

// Fail fast at module load if the webhook's required env vars aren't
// configured. This is a service-role + public-URL pair: missing either
// silently turned dedupe insertions into runtime errors, which is much
// harder to debug than refusing to boot.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

type CircleNotification = {
  id: string;
  state: string;
  txHash?: string;
  errorReason?: string;
  [k: string]: unknown;
};

interface CircleWebhookPayload {
  notificationType: string;
  notification: CircleNotification;
  [k: string]: unknown;
}

// Circle Gateway wallet contract. Deposits "to Gateway" land here; we tag the
// transaction row's recipient with it so the dashboard can tell a Gateway
// deposit apart from a normal transfer. Inlined (rather than imported from
// gateway-sdk) to keep this route free of the heavy DCW/viem dependency tree.
const GATEWAY_WALLET_ADDRESS = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

// Circle domain id → our DB blockchain string, for the four supported testnets.
const BLOCKCHAIN_BY_DOMAIN: Record<number, string> = {
  0: "ETH-SEPOLIA",
  1: "AVAX-FUJI",
  6: "BASE-SEPOLIA",
  26: "ARC-TESTNET",
};

// DB blockchain strings we support. Circle's DCW `blockchain` field already
// arrives in this exact form, so we only need it to reject events for chains
// we don't model. Inlined (like the constants above) to keep this route off
// the heavy DCW/viem dependency graph.
const SUPPORTED_BLOCKCHAINS = new Set([
  "ETH-SEPOLIA",
  "AVAX-FUJI",
  "BASE-SEPOLIA",
  "ARC-TESTNET",
]);

// Shape of the `notification` object on a `transactions.inbound` /
// `transactions.outbound` event. Mirrors Circle's DCW transaction object.
// https://developers.circle.com/wallets/dev-controlled/receive-an-inbound-transfer
type TransactionNotification = {
  id: string;
  state: string;
  txHash?: string;
  blockchain?: string;
  sourceAddress?: string;
  destinationAddress?: string;
  // Decimal token amounts as strings, e.g. ["0.01"] for 0.01 USDC.
  amounts?: string[];
  transactionType?: string;
};

// Shape of the `notification` object on a `gateway.deposit.finalized` event.
// https://developers.circle.com/gateway/references/webhook-events
type GatewayDepositNotification = {
  id: string;
  walletAddress?: string;
  domain?: string | number;
  amount?: string;
  from?: string;
  to?: string;
  txHash?: string;
  tokenAddress?: string;
};

async function verifyCircleSignature(
  bodyString: string,
  signature: string,
  keyId: string
): Promise<boolean> {
  try {
    const publicKey = await getCirclePublicKey(keyId);
    const verifier = crypto.createVerify("SHA256");
    verifier.update(bodyString);
    verifier.end();
    const signatureUint8Array = Uint8Array.from(Buffer.from(signature, "base64"));
    return verifier.verify(publicKey, signatureUint8Array);
  } catch (e) {
    console.error("Signature verification failure:", e);
    return false;
  }
}

async function getCirclePublicKey(keyId: string) {
  if (!process.env.CIRCLE_API_KEY) throw new Error("Circle API key is not set");
  const response = await fetch(
    `https://api.circle.com/v2/notifications/publicKey/${keyId}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${process.env.CIRCLE_API_KEY}`,
      },
    }
  );
  if (!response.ok) throw new Error(`Failed to fetch public key`);
  const data = await response.json();
  const rawPublicKey = data?.data?.publicKey;
  return [
    "-----BEGIN PUBLIC KEY-----",
    ...(rawPublicKey.match(/.{1,64}/g) ?? []),
    "-----END PUBLIC KEY-----",
  ].join("\n");
}

/**
 * Apply a `transactions.inbound` / `transactions.outbound` state change to the
 * matching transaction row, matching by `circle_transaction_id` first and then
 * by `tx_hash` (for REBALANCE/OUTBOUND rows that only carry an on-chain hash).
 *
 * If nothing matches and the event is `transactions.inbound`, the transfer was
 * initiated from an external wallet and the app never recorded it — so we
 * insert a row for it (see `insertInboundTransfer`), which is what drives the
 * dashboard's balance refresh.
 */
async function applyTransactionStateChange(
  notification: CircleNotification,
  notificationType: string
): Promise<void> {
  // The transaction_status enum only contains PENDING, CONFIRMED, COMPLETE,
  // FAILED. Anything outside that maps to a no-op.
  const allowedStates = ["PENDING", "CONFIRMED", "COMPLETE", "FAILED"] as const;
  type AllowedState = (typeof allowedStates)[number];
  const newStatus: AllowedState | null = (allowedStates as readonly string[]).includes(
    notification.state
  )
    ? (notification.state as AllowedState)
    : null;

  if (notification.state === "FAILED") {
    console.error(
      `Transaction ${notification.id} FAILED on chain. Reason: ${notification.errorReason ?? "unknown"}`
    );
  }

  if (!newStatus) return;

  const txHash = notification.txHash;
  const updatePayload: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };
  if (txHash) {
    updatePayload.tx_hash = txHash;
  }

  // Single-pass update. We try matching by circle_transaction_id first
  // (the common case), and if no rows match and we have a tx_hash, also
  // try matching REBALANCE/OUTBOUND rows by tx_hash.
  const { data: stdRows, error: stdErr } = await supabaseAdmin
    .from("transactions")
    .update(updatePayload)
    .eq("circle_transaction_id", notification.id)
    .select("id");

  if (stdErr) {
    console.error("Supabase update error (standard):", stdErr);
  }
  if ((stdRows?.length ?? 0) > 0) return;

  if (txHash) {
    // Fallback: match by tx_hash. We use this for rows that were inserted
    // without a Circle DCW transaction id — REBALANCE rows (Bridge Kit) and
    // Gateway deposits routed through App Kit, both of which return only the
    // on-chain hash, not the underlying DCW transaction id.
    const { data: rebalRows, error: rebalErr } = await supabaseAdmin
      .from("transactions")
      .update(updatePayload)
      .eq("tx_hash", txHash)
      .in("type", ["REBALANCE", "OUTBOUND"])
      .select("id");

    if (rebalErr) {
      console.error("Supabase update error (tx_hash fallback):", rebalErr);
    }
    if ((rebalRows?.length ?? 0) > 0) return;
  }

  // Nothing matched. For an *inbound* transfer this is expected the first
  // time we hear about it: the deposit was initiated from an external wallet,
  // so the app never wrote a row for it. Record one now so the dashboard's
  // Realtime subscription fires and balances refresh. (Outbound/rebalance
  // misses are left alone — their originating API call simply hasn't written
  // its row yet, and a later webhook will reconcile by id/tx_hash.)
  if (notificationType === "transactions.inbound") {
    await insertInboundTransfer(
      notification as unknown as TransactionNotification,
      newStatus
    );
  }
}

/**
 * Record an externally-initiated inbound USDC transfer the app never wrote a
 * row for. Upserts on `circle_transaction_id` (a UNIQUE column) so concurrent
 * webhook deliveries for the same transfer converge on one row rather than
 * duplicating it. The insert/update is what triggers the dashboard refresh —
 * see `onTransactionChange` in `lib/contexts/balance-context.tsx`.
 */
async function insertInboundTransfer(
  notification: TransactionNotification,
  status: string
): Promise<void> {
  const recipient = (notification.destinationAddress || "").toLowerCase();
  if (!recipient) {
    console.warn(
      "transactions.inbound missing destinationAddress; cannot attribute",
      notification.id
    );
    return;
  }

  const blockchain = notification.blockchain;
  if (!blockchain || !SUPPORTED_BLOCKCHAINS.has(blockchain)) {
    console.warn(
      `transactions.inbound for unsupported blockchain ${blockchain}; skipping insert`
    );
    return;
  }

  // Attribute the transfer to the owning user via the receiving address.
  const { data: walletRow, error: walletErr } = await supabaseAdmin
    .from("wallets")
    .select("user_id")
    .ilike("address", recipient)
    .limit(1)
    .maybeSingle();

  if (walletErr) {
    console.error("Inbound transfer wallet lookup error:", walletErr);
    return;
  }
  if (!walletRow?.user_id) {
    // An inbound transfer to an address we don't own (or haven't recorded).
    // Nothing to show on the dashboard — ack and move on.
    return;
  }

  // `amounts` is an array of decimal token strings; for a USDC transfer there
  // is a single entry.
  const amount = Number(notification.amounts?.[0] ?? 0);

  const { error: upsertErr } = await supabaseAdmin
    .from("transactions")
    .upsert(
      {
        user_id: walletRow.user_id,
        amount: Number.isFinite(amount) ? amount : 0,
        sender_address: notification.sourceAddress ?? "",
        recipient_address: notification.destinationAddress ?? recipient,
        tx_hash: notification.txHash ?? null,
        circle_transaction_id: notification.id,
        blockchain,
        type: "INBOUND",
        status,
      },
      { onConflict: "circle_transaction_id" }
    );

  if (upsertErr) {
    console.error("Inbound transfer upsert error:", upsertErr);
  }
}

/**
 * Apply a `gateway.deposit.finalized` event: a USDC deposit into a Gateway
 * Wallet has finalized on-chain and been processed by Gateway, so the
 * depositor's Gateway balance has changed.
 *
 * Two paths, in order:
 *   1. Reconcile a dashboard-initiated deposit by tx hash → mark it COMPLETE.
 *      The dashboard's Realtime subscription sees the UPDATE and refreshes
 *      balances. (This is the common case.)
 *   2. If no row matches (e.g. a deposit made directly on-chain, outside the
 *      app), look up the owning user by depositor address and insert a
 *      completed deposit row so it shows in activity and triggers a refresh.
 */
async function applyGatewayDeposit(
  notification: GatewayDepositNotification
): Promise<void> {
  const txHash = notification.txHash;
  const depositor = (notification.walletAddress || notification.from || "")
    .toLowerCase();

  if (!txHash) {
    console.warn("gateway.deposit.finalized missing txHash; skipping", notification.id);
    return;
  }

  // Path 1: reconcile an existing (dashboard) deposit row by tx hash.
  const { data: reconciled, error: reconcileErr } = await supabaseAdmin
    .from("transactions")
    .update({ status: "COMPLETE", updated_at: new Date().toISOString() })
    .eq("tx_hash", txHash)
    .eq("type", "OUTBOUND")
    .neq("status", "COMPLETE")
    .select("id");

  if (reconcileErr) {
    console.error("Gateway deposit reconcile error:", reconcileErr);
  }
  if ((reconciled?.length ?? 0) > 0) return;

  // Path 2: no matching row. Create one for the owning user (if we know them).
  if (!depositor) {
    console.warn(
      "gateway.deposit.finalized has no depositor address; cannot attribute",
      notification.id
    );
    return;
  }

  const domainNum =
    typeof notification.domain === "string"
      ? Number(notification.domain)
      : notification.domain;
  const blockchain =
    domainNum != null ? BLOCKCHAIN_BY_DOMAIN[domainNum] : undefined;
  if (!blockchain) {
    console.warn(
      `gateway.deposit.finalized for unsupported domain ${notification.domain}; skipping insert`
    );
    return;
  }

  const { data: walletRow, error: walletErr } = await supabaseAdmin
    .from("wallets")
    .select("user_id")
    .ilike("address", depositor)
    .limit(1)
    .maybeSingle();

  if (walletErr) {
    console.error("Gateway deposit wallet lookup error:", walletErr);
    return;
  }
  if (!walletRow?.user_id) {
    // A finalized deposit for an address we don't own (or haven't recorded).
    // Nothing to update on the dashboard — ack and move on.
    return;
  }

  const amount = Number(notification.amount ?? 0);
  const { error: insertErr } = await supabaseAdmin.from("transactions").insert([
    {
      user_id: walletRow.user_id,
      amount: Number.isFinite(amount) ? amount : 0,
      sender_address: notification.walletAddress ?? depositor,
      recipient_address: GATEWAY_WALLET_ADDRESS,
      tx_hash: txHash,
      circle_transaction_id: null,
      blockchain,
      type: "OUTBOUND",
      status: "COMPLETE",
    },
  ]);

  if (insertErr) {
    console.error("Gateway deposit insert error:", insertErr);
  }
}

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get("x-circle-signature");
    const keyId = req.headers.get("x-circle-key-id");

    if (!signature || !keyId) {
      return NextResponse.json({ error: "Missing headers" }, { status: 400 });
    }

    const rawBody = await req.text();
    const isVerified = await verifyCircleSignature(rawBody, signature, keyId);
    if (!isVerified) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    const body: CircleWebhookPayload = JSON.parse(rawBody);
    const { notificationType, notification } = body;

    // Circle sends a `webhooks.test` ping to verify the endpoint whenever a
    // subscription is created or updated. That payload carries no
    // `notification.id`, so it can't (and shouldn't) be recorded for dedupe —
    // just ack it with 200 so endpoint verification passes. Without this the
    // insert below hits a NOT NULL violation and returns 500, which makes
    // Circle reject the endpoint and refuse to create the subscription.
    if (notificationType === "webhooks.test" || !notification?.id) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    // Idempotency: try to insert the event. If the notification id has been
    // seen before, the unique constraint on webhook_events.notification_id
    // rejects the insert and we ack with 200 without doing the side effects
    // again. This replaces the previous in-handler 30s retry loop, which
    // both blocked the response and could double-apply state on retries.
    //
    // The previous schema also wrote `circle_transaction_id: notification.id`
    // alongside `notification_id`. That was a holdover from when the two
    // fields meant different things; today they're identical, so we only
    // store `notification_id`.
    const { error: insertErr } = await supabaseAdmin
      .from("webhook_events")
      .insert({
        notification_id: notification.id,
        notification_type: notificationType,
        state: notification.state,
        payload: body as unknown as Record<string, unknown>,
      });

    if (insertErr) {
      // Postgres unique-violation code is 23505. Anything else is a real error.
      const code = (insertErr as { code?: string }).code;
      if (code === "23505") {
        return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
      }
      // Refuse to apply the side-effects when dedupe is broken — the
      // previous behaviour was to fall through, which made it possible to
      // double-apply transaction updates whenever the dedupe insert failed
      // for non-duplicate reasons (e.g. RLS misconfig). Circle will retry,
      // and once dedupe works the next attempt will succeed exactly once.
      console.error("Failed to record webhook event:", insertErr);
      return NextResponse.json(
        { error: "Failed to record webhook event" },
        { status: 500 }
      );
    }

    if (
      notificationType === "transactions.outbound" ||
      notificationType === "transactions.inbound"
    ) {
      await applyTransactionStateChange(notification, notificationType);
    } else if (notificationType === "gateway.deposit.finalized") {
      // Gateway events carry a different payload shape than transactions.*
      // (depositor address, domain, on-chain txHash) — see the typed handler.
      await applyGatewayDeposit(
        notification as unknown as GatewayDepositNotification
      );
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
