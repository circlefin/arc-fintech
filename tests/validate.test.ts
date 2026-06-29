/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from "vitest"
import {
  blockchainSchema,
  evmAddressSchema,
  usdcAmountSchema,
  validateQuery,
} from "@/lib/api/validate"
import { z } from "zod"

describe("blockchainSchema", () => {
  it("accepts the four supported testnet identifiers", () => {
    for (const chain of ["ETH-SEPOLIA", "AVAX-FUJI", "BASE-SEPOLIA", "ARC-TESTNET"]) {
      expect(blockchainSchema.parse(chain)).toBe(chain)
    }
  })

  it("rejects unknown chains", () => {
    expect(() => blockchainSchema.parse("ETH-MAINNET")).toThrow()
    expect(() => blockchainSchema.parse("")).toThrow()
  })
})

describe("evmAddressSchema", () => {
  it("accepts a 0x-prefixed 40-hex address", () => {
    const addr = "0x" + "a".repeat(40)
    expect(evmAddressSchema.parse(addr)).toBe(addr)
  })

  it("rejects malformed input", () => {
    expect(() => evmAddressSchema.parse("not-an-address")).toThrow()
    expect(() => evmAddressSchema.parse("0xabc")).toThrow()
    // Non-hex chars
    expect(() => evmAddressSchema.parse("0x" + "g".repeat(40))).toThrow()
  })
})

describe("usdcAmountSchema", () => {
  it("coerces strings to numbers", () => {
    expect(usdcAmountSchema.parse("12.5")).toBe(12.5)
  })

  it("rejects zero, negative, NaN, and Infinity", () => {
    expect(() => usdcAmountSchema.parse(0)).toThrow()
    expect(() => usdcAmountSchema.parse(-1)).toThrow()
    expect(() => usdcAmountSchema.parse("nope")).toThrow()
    expect(() => usdcAmountSchema.parse(Infinity)).toThrow()
  })
})

describe("validateQuery", () => {
  const schema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })

  it("applies defaults when query params are missing", () => {
    const url = new URL("http://example.test/api?other=1")
    const result = validateQuery(url, schema)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ limit: 50, offset: 0 })
    }
  })

  it("rejects garbage that previously produced NaN", () => {
    // The pre-refactor compliance/logs handler accepted `?limit=abc`,
    // parseInt'd it to NaN, and passed that to PostgREST's .range().
    const url = new URL("http://example.test/api?limit=abc")
    const result = validateQuery(url, schema)
    expect(result.ok).toBe(false)
  })

  it("clamps limit to its declared upper bound", () => {
    const url = new URL("http://example.test/api?limit=999999")
    const result = validateQuery(url, schema)
    expect(result.ok).toBe(false)
  })
})
