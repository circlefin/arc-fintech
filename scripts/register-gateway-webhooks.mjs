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

/**
 * One-off backfill: register every existing wallet address on the app's single
 * Gateway *permissionless* webhook subscription, so Circle delivers
 * `gateway.deposit.finalized` for deposits made from wallets that were created
 * before webhook registration was wired up (or while it was broken).
 *
 * Run with: `npm run webhooks:register`
 *
 * This is a standalone Node ESM script: it cannot import the app's
 * `lib/circle/gateway-webhooks.ts` (that module is marked `server-only`), so it
 * re-implements the same Circle REST sync here. Keep this in sync with
 * `lib/circle/gateway-webhooks.ts` — that module is the source of truth for the
 * runtime app behaviour.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// --- Config (mirrors lib/circle/gateway-webhooks.ts) ------------------------

const CIRCLE_API_BASE = "https://api.circle.com";

// Circle domain ids for the four supported testnets, as strings (the API
// rejects numbers). Mirrors DOMAIN_IDS in lib/circle/gateway-sdk.ts.
const GATEWAY_WEBHOOK_DOMAINS = ["0", "1", "6", "26"];

// We only act on deposit completions, so register exactly that type to keep the
// subscription "restricted" to what the webhook route handles.
const GATEWAY_NOTIFICATION_TYPES = ["gateway.deposit.finalized"];

// Circle caps a developer account at 50 registered addresses across all
// permissionless subscriptions.
const MAX_REGISTERED_ADDRESSES = 50;

// --- Minimal .env loader ----------------------------------------------------

// Load `.env.local` then `.env` (without overwriting anything already set in
// the environment) so `npm run webhooks:register` works without extra flags.
function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    let contents;
    try {
      contents = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const rawLine of contents.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (key in process.env) continue;
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

// --- Helpers ----------------------------------------------------------------

// The Gateway permissionless subscription must use a DIFFERENT endpoint URL than
// the standard DCW notification subscription (Circle enforces one subscription
// per endpoint URL). Mirrors getWebhookEndpointUrl in
// lib/circle/gateway-webhooks.ts.
const GATEWAY_WEBHOOK_PATH = "/api/circle/gateway-webhook";

function withGatewayPath(url) {
  try {
    const u = new URL(url);
    u.pathname = GATEWAY_WEBHOOK_PATH;
    u.search = "";
    return u.toString();
  } catch {
    return url;
  }
}

function getWebhookEndpointUrl() {
  const explicit = process.env.GATEWAY_WEBHOOK_ENDPOINT_URL;
  if (explicit) return explicit;
  const standard = process.env.WEBHOOK_ENDPOINT_URL;
  if (standard) return withGatewayPath(standard);
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (base) return `${base.replace(/\/$/, "")}${GATEWAY_WEBHOOK_PATH}`;
  return null;
}

function getEnvironment(apiKey) {
  return apiKey.startsWith("TEST") ? "TEST" : "LIVE";
}

function normalizeAddresses(addresses) {
  return Array.from(
    new Set(
      addresses
        .filter((a) => typeof a === "string" && a.length > 0)
        .map((a) => a.toLowerCase())
    )
  ).slice(0, MAX_REGISTERED_ADDRESSES);
}

function sameAddressSet(a, b) {
  if (a.length !== b.length) return false;
  const set = new Set(a.map((x) => x.toLowerCase()));
  return b.every((x) => set.has(x.toLowerCase()));
}

async function circleFetch(apiKey, path, init) {
  return fetch(`${CIRCLE_API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers ?? {}),
    },
  });
}

async function listPermissionlessSubscriptions(apiKey) {
  const res = await circleFetch(
    apiKey,
    "/v2/notifications/subscriptions/permissionless",
    { method: "GET" }
  );
  if (!res.ok) {
    throw new Error(
      `Failed to list permissionless subscriptions: ${res.status} ${await res.text()}`
    );
  }
  const json = await res.json();
  return json?.data ?? [];
}

async function createPermissionlessSubscription(apiKey, input) {
  const res = await circleFetch(
    apiKey,
    "/v2/notifications/subscriptions/permissionless",
    {
      method: "POST",
      body: JSON.stringify({
        environment: getEnvironment(apiKey),
        endpoint: input.endpoint,
        addresses: input.addresses,
        domains: input.domains,
        notificationTypes: GATEWAY_NOTIFICATION_TYPES,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(
      `Failed to create permissionless subscription: ${res.status} ${await res.text()}`
    );
  }
  return (await res.json()).data;
}

async function updatePermissionlessSubscription(apiKey, id, input) {
  const res = await circleFetch(
    apiKey,
    `/v2/notifications/subscriptions/permissionless/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        addresses: input.addresses,
        domains: input.domains,
        notificationTypes: GATEWAY_NOTIFICATION_TYPES,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(
      `Failed to update permissionless subscription ${id}: ${res.status} ${await res.text()}`
    );
  }
  return (await res.json()).data;
}

async function deletePermissionlessSubscription(apiKey, id) {
  const res = await circleFetch(
    apiKey,
    `/v2/notifications/subscriptions/permissionless/${id}`,
    { method: "DELETE" }
  );
  if (!res.ok && res.status !== 204) {
    throw new Error(
      `Failed to delete permissionless subscription ${id}: ${res.status} ${await res.text()}`
    );
  }
}

// --- Main -------------------------------------------------------------------

async function main() {
  loadEnvFiles();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.CIRCLE_API_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY; cannot read wallets."
    );
    process.exit(1);
  }
  if (!apiKey) {
    console.error("Missing CIRCLE_API_KEY; cannot talk to Circle. Skipping.");
    process.exit(1);
  }
  const endpoint = getWebhookEndpointUrl();
  if (!endpoint) {
    console.error(
      "No webhook endpoint configured (set WEBHOOK_ENDPOINT_URL or NEXT_PUBLIC_APP_URL). Skipping."
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Only depositor wallets (SCA) receive gateway.deposit.finalized; the
  // gateway_signer EOAs are delegates, not depositors, so we skip them to
  // conserve the 50-address budget.
  const { data: walletRows, error } = await supabase
    .from("wallets")
    .select("address")
    .not("address", "is", null)
    .neq("type", "gateway_signer");

  if (error) {
    console.error("Failed to load wallet addresses:", error.message);
    process.exit(1);
  }

  const requested = normalizeAddresses(
    (walletRows ?? []).map((w) => w.address)
  );

  if (requested.length === 0) {
    console.log("No wallet addresses found to register. Nothing to do.");
    return;
  }

  console.log(
    `Found ${requested.length} wallet address(es) to ensure are registered.`
  );
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Environment: ${getEnvironment(apiKey)}`);

  const existing = await listPermissionlessSubscriptions(apiKey);
  const ours = existing.find((s) => s.endpoint === endpoint);

  if (!ours) {
    const created = await createPermissionlessSubscription(apiKey, {
      endpoint,
      addresses: requested,
      domains: GATEWAY_WEBHOOK_DOMAINS,
    });
    console.log(
      `Created subscription ${created.id} with ${
        (created.addresses ?? []).length
      } address(es).`
    );
    return;
  }

  const merged = normalizeAddresses([...(ours.addresses ?? []), ...requested]);

  if (sameAddressSet(merged, ours.addresses ?? [])) {
    console.log(
      `Subscription ${ours.id} already covers all ${merged.length} address(es). No change.`
    );
    return;
  }

  try {
    const updated = await updatePermissionlessSubscription(apiKey, ours.id, {
      addresses: merged,
      domains: GATEWAY_WEBHOOK_DOMAINS,
    });
    console.log(
      `Updated subscription ${updated.id}; now covers ${
        (updated.addresses ?? []).length
      } address(es).`
    );
  } catch (updateErr) {
    // Some accounts don't allow mutating the address set in place; recreate so
    // the registered set is never silently stale.
    console.warn(
      "PATCH failed; recreating subscription instead:",
      updateErr.message
    );
    await deletePermissionlessSubscription(apiKey, ours.id);
    const recreated = await createPermissionlessSubscription(apiKey, {
      endpoint,
      addresses: merged,
      domains: GATEWAY_WEBHOOK_DOMAINS,
    });
    console.log(
      `Recreated subscription ${recreated.id}; now covers ${
        (recreated.addresses ?? []).length
      } address(es).`
    );
  }
}

main().catch((err) => {
  console.error("Gateway webhook backfill failed:", err);
  process.exit(1);
});
