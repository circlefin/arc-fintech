/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/** Client-safe formatting helpers for the Earn UI. */

/** Render a decimal rate (0.0497) as a percentage string ("4.97%"). */
export function formatApy(decimal: number, fractionDigits = 2): string {
  if (!Number.isFinite(decimal)) return "-"
  return `${(decimal * 100).toFixed(fractionDigits)}%`
}

/**
 * Compact USD for large vault figures, mirroring Morpho's "$326.73M" style.
 * `value` is a decimal string of a USDC amount (1 USDC ~ $1).
 */
export function formatCompactUsd(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value
  if (!Number.isFinite(n)) return "$0"
  if (n === 0) return "$0"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(n)
}

/** A token amount with its symbol, e.g. "12.50 USDC". Trims noise to `maxFrac`. */
export function formatTokenAmount(
  amount: string | number,
  symbol: string,
  maxFrac = 4
): string {
  const n = typeof amount === "string" ? Number(amount) : amount
  if (!Number.isFinite(n)) return `0 ${symbol}`
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: maxFrac,
  }).format(n)
  return `${formatted} ${symbol}`
}

/**
 * Format a P&L / yield amount for display. Rounds to `maxFrac` decimals like a
 * fiat balance (2 for USDC), so the sub-unit rounding dust ERC-4626 vaults leave
 * on a fresh deposit - e.g. a 10 USDC deposit reading back as 9.999997, i.e.
 * -0.000003 "yield" - collapses to "0.00" instead of surfacing as a misleading
 * signed value. The returned `sign` is derived from the *rounded* number so
 * callers color the row from what the user actually sees: dust reads neutral,
 * while a real loss larger than the display precision still rounds through as
 * negative and is colored as a loss.
 */
export function formatYieldAmount(
  amount: string | number,
  symbol: string,
  maxFrac = 2
): { text: string; sign: "positive" | "negative" | "zero" } {
  const n = typeof amount === "string" ? Number(amount) : amount
  if (!Number.isFinite(n)) return { text: `0.00 ${symbol}`, sign: "zero" }
  const factor = 10 ** maxFrac
  const rounded = Math.round(n * factor) / factor
  const sign = rounded > 0 ? "positive" : rounded < 0 ? "negative" : "zero"
  // Normalize -0 to 0 so a rounded-away negative never renders as "-0.00".
  const text = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: maxFrac,
    maximumFractionDigits: maxFrac,
  }).format(rounded === 0 ? 0 : rounded)
  return { text: `${text} ${symbol}`, sign }
}

/** Truncate a decimal amount string for display without forcing trailing zeros. */
export function trimAmount(amount: string | number, maxFrac = 6): string {
  const n = typeof amount === "string" ? Number(amount) : amount
  if (!Number.isFinite(n)) return "0"
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: maxFrac,
    useGrouping: false,
  }).format(n)
}
