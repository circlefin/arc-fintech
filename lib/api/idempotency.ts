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

import { createHash } from "crypto";
import { NextResponse } from "next/server";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

type IdempotencyRecord =
  | { status: "pending"; bodyHash: string; expiresAt: number }
  | {
      status: "completed";
      bodyHash: string;
      expiresAt: number;
      // Serialized JSON body previously returned to the client.
      responseBody: unknown;
      responseStatus: number;
    };

/**
 * Process-local idempotency cache for outbound write routes.
 *
 * This closes the lost-response retry hole on a single Node instance (the
 * common local/dev and warm-lambda case). Durable cross-instance storage is
 * intentionally out of scope for this sample; swap the Map for Redis/DB in
 * production.
 */
const slots = new Map<string, IdempotencyRecord>();

function pruneExpired(now = Date.now()): void {
  for (const [key, record] of slots) {
    if (record.expiresAt <= now) {
      slots.delete(key);
    }
  }
}

export function hashIdempotencyBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export function idempotencySlotKey(
  surface: string,
  userId: string,
  idempotencyKey: string
): string {
  return `${surface}:${userId}:${idempotencyKey}`;
}

export function readIdempotencyKey(req: Request): string | null {
  const header = req.headers.get("idempotency-key")?.trim();
  return header && header.length > 0 ? header : null;
}

type BeginResult =
  | { kind: "fresh" }
  | { kind: "replay"; response: NextResponse }
  | { kind: "conflict"; response: NextResponse }
  | { kind: "in_flight"; response: NextResponse };

/**
 * Admit a request into the idempotency slot.
 *
 * - Missing key → treat as fresh (caller may still require the header).
 * - Same key + same body after success → replay the cached response.
 * - Same key + different body → 409 conflict.
 * - Same key while pending → 409 in-flight.
 */
export function beginIdempotent(args: {
  surface: string;
  userId: string;
  idempotencyKey: string | null;
  bodyHash: string;
  ttlMs?: number;
}): BeginResult {
  if (!args.idempotencyKey) {
    return { kind: "fresh" };
  }

  pruneExpired();
  const slot = idempotencySlotKey(
    args.surface,
    args.userId,
    args.idempotencyKey
  );
  const existing = slots.get(slot);
  const now = Date.now();

  if (!existing || existing.expiresAt <= now) {
    slots.set(slot, {
      status: "pending",
      bodyHash: args.bodyHash,
      expiresAt: now + (args.ttlMs ?? DEFAULT_TTL_MS),
    });
    return { kind: "fresh" };
  }

  if (existing.bodyHash !== args.bodyHash) {
    return {
      kind: "conflict",
      response: NextResponse.json(
        {
          error:
            "Idempotency-Key was reused with a different request body. Use a new key.",
        },
        { status: 409 }
      ),
    };
  }

  if (existing.status === "pending") {
    return {
      kind: "in_flight",
      response: NextResponse.json(
        {
          error:
            "A request with this Idempotency-Key is still in flight. Retry shortly.",
        },
        { status: 409 }
      ),
    };
  }

  return {
    kind: "replay",
    response: NextResponse.json(existing.responseBody, {
      status: existing.responseStatus,
      headers: { "Idempotency-Replayed": "true" },
    }),
  };
}

export function completeIdempotent(args: {
  surface: string;
  userId: string;
  idempotencyKey: string | null;
  bodyHash: string;
  responseBody: unknown;
  responseStatus?: number;
  ttlMs?: number;
}): void {
  if (!args.idempotencyKey) {
    return;
  }

  const slot = idempotencySlotKey(
    args.surface,
    args.userId,
    args.idempotencyKey
  );
  slots.set(slot, {
    status: "completed",
    bodyHash: args.bodyHash,
    expiresAt: Date.now() + (args.ttlMs ?? DEFAULT_TTL_MS),
    responseBody: args.responseBody,
    responseStatus: args.responseStatus ?? 200,
  });
}

export function abandonIdempotent(args: {
  surface: string;
  userId: string;
  idempotencyKey: string | null;
}): void {
  if (!args.idempotencyKey) {
    return;
  }
  const slot = idempotencySlotKey(
    args.surface,
    args.userId,
    args.idempotencyKey
  );
  const existing = slots.get(slot);
  if (existing?.status === "pending") {
    slots.delete(slot);
  }
}
