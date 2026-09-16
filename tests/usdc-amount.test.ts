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
  formatUsdcAtomicUnits,
  parseUsdcAmountToAtomicUnits,
} from "@/lib/circle/usdc-amount"

describe("parseUsdcAmountToAtomicUnits", () => {
  it("converts whole and fractional amounts to six-decimal atomic units", () => {
    expect(parseUsdcAmountToAtomicUnits("10")).toBe(BigInt(10_000_000))
    expect(parseUsdcAmountToAtomicUnits("1.5")).toBe(BigInt(1_500_000))
    expect(parseUsdcAmountToAtomicUnits("0.000001")).toBe(BigInt(1))
  })

  it("tolerates surrounding whitespace", () => {
    expect(parseUsdcAmountToAtomicUnits("  2.5  ")).toBe(BigInt(2_500_000))
  })

  it("rejects partially numeric input instead of silently truncating it", () => {
    // The core payout bug: parseFloat("1USDC") === 1 would move 1 USDC for a
    // request body that never asked for a clean amount.
    for (const bad of ["1USDC", "1.5abc", "0x10", "1,000", "1e6"]) {
      expect(() => parseUsdcAmountToAtomicUnits(bad)).toThrow()
    }
  })

  it("rejects more fractional digits than USDC supports", () => {
    expect(() => parseUsdcAmountToAtomicUnits("1.1234567")).toThrow()
  })

  it("rejects empty, signed, and non-numeric amounts", () => {
    for (const bad of ["", "   ", "-1", "+1", "abc", "NaN", "Infinity", "."]) {
      expect(() => parseUsdcAmountToAtomicUnits(bad)).toThrow()
    }
  })
})

describe("formatUsdcAtomicUnits", () => {
  it("renders atomic units without trailing zeros", () => {
    expect(formatUsdcAtomicUnits(BigInt(1_000_000))).toBe("1")
    expect(formatUsdcAtomicUnits(BigInt(1_500_000))).toBe("1.5")
    expect(formatUsdcAtomicUnits(BigInt(1))).toBe("0.000001")
  })

  it("round-trips with the parser", () => {
    for (const amount of ["10", "1.5", "0.000001", "1234.56"]) {
      expect(
        formatUsdcAtomicUnits(parseUsdcAmountToAtomicUnits(amount))
      ).toBe(amount)
    }
  })
})
