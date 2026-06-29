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
 * Circle Gateway *permissionless* webhook subscription management.
 *
 * Gateway is permissionless and needs no API key to move funds, but webhook
 * delivery is opt-in per wallet address: Circle only fires
 * `gateway.deposit.finalized` (and the other `gateway.*` events) for addresses
 * registered on a permissionless subscription. We keep ONE such subscription
 * for the whole app — identified by its endpoint URL — and grow its address
 * list as wallets are created.
 *
 * Docs: https://developers.circle.com/gateway/webhooks
 *       https://developers.circle.com/api-reference/webhook-endpoints
 *
 * Server-side only: this module talks to Circle's REST API with the secret
 * `CIRCLE_API_KEY`, which must never reach the browser bundle.
 */

import "server-only";

import { DOMAIN_IDS } from "@/lib/circle/gateway-sdk";

const CIRCLE_API_BASE = "https://api.circle.com";

// The Circle domain ids for the four testnet chains this app supports. Gateway
// subscriptions monitor (address, domain) pairs, so we register every supported
// domain for each address. Circle's API expects these as strings (e.g. "26"),
// not numbers, so we stringify them here.
export const GATEWAY_WEBHOOK_DOMAINS: string[] = Object.values(DOMAIN_IDS).map(
  String
);

// We only act on deposit completions today (see the webhook route). Registering
// the narrow type instead of `gateway.*` keeps the subscription "restricted" to
// exactly what we handle.
const GATEWAY_NOTIFICATION_TYPES = ["gateway.deposit.finalized"];

// Circle caps a developer account at 50 registered addresses across all
// permissionless subscriptions.
const MAX_REGISTERED_ADDRESSES = 50;

export type PermissionlessSubscription = {
  id: string;
  name?: string;
  endpoint: string;
  environment?: string;
  enabled?: boolean;
  addresses?: string[];
  domains?: string[];
  notificationTypes?: string[];
};

export type SyncResult =
  | { status: "skipped"; reason: string }
  | { status: "created" | "updated" | "unchanged"; subscription: PermissionlessSubscription };

function getApiKey(): string | null {
  return process.env.CIRCLE_API_KEY || null;
}

// The Gateway permissionless subscription must use a DIFFERENT endpoint URL
// than the standard DCW notification subscription (Circle enforces one
// subscription per endpoint URL). The standard subscription owns
// `/api/circle/webhook`; the permissionless one uses this path, which routes to
// the same handler (see app/api/circle/gateway-webhook/route.ts).
const GATEWAY_WEBHOOK_PATH = "/api/circle/gateway-webhook";

/** Swap whatever path a configured URL has for the Gateway webhook path. */
function withGatewayPath(url: string): string {
  try {
    const u = new URL(url);
    u.pathname = GATEWAY_WEBHOOK_PATH;
    u.search = "";
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Public HTTPS URL Circle should POST Gateway notifications to. Must be
 * reachable from the internet, so local development needs a tunnel (e.g. ngrok)
 * or a deployed URL. Resolution order:
 *   1. `GATEWAY_WEBHOOK_ENDPOINT_URL` (explicit override), else
 *   2. the host of `WEBHOOK_ENDPOINT_URL` with the Gateway path swapped in, else
 *   3. `${NEXT_PUBLIC_APP_URL}${GATEWAY_WEBHOOK_PATH}`.
 *
 * This intentionally differs from the standard webhook URL so the two
 * subscriptions don't collide on Circle's per-endpoint uniqueness rule.
 */
export function getWebhookEndpointUrl(): string | null {
  const explicit = process.env.GATEWAY_WEBHOOK_ENDPOINT_URL;
  if (explicit) return explicit;
  const standard = process.env.WEBHOOK_ENDPOINT_URL;
  if (standard) return withGatewayPath(standard);
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (base) return `${base.replace(/\/$/, "")}${GATEWAY_WEBHOOK_PATH}`;
  return null;
}

/**
 * Test vs live is derived from the API key prefix. Circle test keys are
 * formatted `TEST_API_KEY:...`; everything else is treated as live. The values
 * are Circle's `PermissionlessEnvironment` enum (`TEST` / `LIVE`).
 */
function getEnvironment(): "TEST" | "LIVE" {
  const key = getApiKey() ?? "";
  return key.startsWith("TEST") ? "TEST" : "LIVE";
}

async function circleFetch(
  path: string,
  init: RequestInit & { method: string }
): Promise<Response> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("CIRCLE_API_KEY is not set");
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

export async function listPermissionlessSubscriptions(): Promise<
  PermissionlessSubscription[]
> {
  const res = await circleFetch("/v2/notifications/subscriptions/permissionless", {
    method: "GET",
  });
  if (!res.ok) {
    throw new Error(
      `Failed to list permissionless subscriptions: ${res.status} ${await res.text()}`
    );
  }
  const json = await res.json();
  return (json?.data ?? []) as PermissionlessSubscription[];
}

async function createPermissionlessSubscription(input: {
  endpoint: string;
  addresses: string[];
  domains: string[];
}): Promise<PermissionlessSubscription> {
  const res = await circleFetch("/v2/notifications/subscriptions/permissionless", {
    method: "POST",
    body: JSON.stringify({
      environment: getEnvironment(),
      endpoint: input.endpoint,
      addresses: input.addresses,
      domains: input.domains,
      notificationTypes: GATEWAY_NOTIFICATION_TYPES,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to create permissionless subscription: ${res.status} ${await res.text()}`
    );
  }
  return (await res.json()).data as PermissionlessSubscription;
}

async function updatePermissionlessSubscription(
  id: string,
  input: { addresses: string[]; domains: string[] }
): Promise<PermissionlessSubscription> {
  const res = await circleFetch(
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
  return (await res.json()).data as PermissionlessSubscription;
}

async function deletePermissionlessSubscription(id: string): Promise<void> {
  const res = await circleFetch(
    `/v2/notifications/subscriptions/permissionless/${id}`,
    { method: "DELETE" }
  );
  // 200 and 204 both indicate success.
  if (!res.ok && res.status !== 204) {
    throw new Error(
      `Failed to delete permissionless subscription ${id}: ${res.status} ${await res.text()}`
    );
  }
}

function normalizeAddresses(addresses: Iterable<string>): string[] {
  return Array.from(
    new Set(
      Array.from(addresses)
        .filter((a): a is string => typeof a === "string" && a.length > 0)
        .map((a) => a.toLowerCase())
    )
  ).slice(0, MAX_REGISTERED_ADDRESSES);
}

function sameAddressSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a.map((x) => x.toLowerCase()));
  return b.every((x) => set.has(x.toLowerCase()));
}

/**
 * Ensure the app's single permissionless subscription exists and covers every
 * address in `addresses` (merged with any already registered). Idempotent:
 *
 *   - no subscription yet  → create one with the merged address set
 *   - exists, set changed  → PATCH it; if the API rejects the update, fall back
 *                            to delete + recreate so a stale set never lingers
 *   - exists, set covers   → no-op
 *
 * Never throws for configuration gaps (missing API key / endpoint); returns a
 * `skipped` result instead so callers (e.g. wallet creation) aren't broken in
 * environments where webhooks aren't wired up.
 */
export async function syncGatewayWebhookSubscription(
  addresses: string[]
): Promise<SyncResult> {
  if (!getApiKey()) {
    return { status: "skipped", reason: "CIRCLE_API_KEY is not set" };
  }
  const endpoint = getWebhookEndpointUrl();
  if (!endpoint) {
    return {
      status: "skipped",
      reason:
        "No webhook endpoint configured (set WEBHOOK_ENDPOINT_URL or NEXT_PUBLIC_APP_URL)",
    };
  }

  const requested = normalizeAddresses(addresses);

  const existing = await listPermissionlessSubscriptions();
  const ours = existing.find((s) => s.endpoint === endpoint);

  if (!ours) {
    if (requested.length === 0) {
      return { status: "skipped", reason: "No addresses to register" };
    }
    const created = await createPermissionlessSubscription({
      endpoint,
      addresses: requested,
      domains: GATEWAY_WEBHOOK_DOMAINS,
    });
    return { status: "created", subscription: created };
  }

  const merged = normalizeAddresses([...(ours.addresses ?? []), ...requested]);

  if (sameAddressSet(merged, ours.addresses ?? [])) {
    return { status: "unchanged", subscription: ours };
  }

  try {
    const updated = await updatePermissionlessSubscription(ours.id, {
      addresses: merged,
      domains: GATEWAY_WEBHOOK_DOMAINS,
    });
    return { status: "updated", subscription: updated };
  } catch (updateErr) {
    // Some accounts/versions don't allow mutating a permissionless
    // subscription's address set in place. Recreate it so the registered set
    // is always correct rather than silently stale.
    console.warn(
      "PATCH of permissionless subscription failed; recreating instead:",
      updateErr
    );
    await deletePermissionlessSubscription(ours.id);
    const recreated = await createPermissionlessSubscription({
      endpoint,
      addresses: merged,
      domains: GATEWAY_WEBHOOK_DOMAINS,
    });
    return { status: "updated", subscription: recreated };
  }
}
