/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodType } from "zod";

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

/**
 * Parse a JSON body against a Zod schema. On failure returns a 400 response
 * the caller can short-circuit on. We intentionally surface the raw zod issues
 * because every consumer of these APIs is our own UI.
 */
export async function validateJsonBody<T>(
  request: NextRequest,
  schema: ZodType<T>
): Promise<ValidationResult<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      ),
    };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Invalid request body",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 }
      ),
    };
  }

  return { ok: true, data: parsed.data };
}

/**
 * Parse query string params against a Zod schema. Use `z.coerce.number()` for
 * numeric query params — query strings are always strings, and the previous
 * code passed raw `parseInt(...)` results into `.range()` which yielded NaN
 * when callers omitted the param.
 */
export function validateQuery<T>(
  url: URL,
  schema: ZodType<T>
): ValidationResult<T> {
  const obj: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    obj[k] = v;
  });
  const parsed = schema.safeParse(obj);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Invalid query params",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 }
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

// Reusable primitives for routes.
export const blockchainSchema = z.enum([
  "ETH-SEPOLIA",
  "AVAX-FUJI",
  "BASE-SEPOLIA",
  "ARC-TESTNET",
]);

export const evmAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");

export const usdcAmountSchema = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "string" ? Number(v) : v))
  .refine((n) => Number.isFinite(n) && n > 0, {
    message: "Amount must be a positive number",
  });
