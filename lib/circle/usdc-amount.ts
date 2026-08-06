/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

const ZERO_BIGINT = BigInt(0);
const USDC_ATOMIC_MULTIPLIER = BigInt(1_000_000);

/**
 * Matches a plain non-negative decimal with at most six fractional digits.
 *
 * USDC and EURC both use six decimals on every chain this app supports, so the
 * same pattern validates either ticker. Deliberately strict: no sign, no
 * exponent, no thousands separators, and no embedded/trailing non-digits — so a
 * value like "1USDC" or "1.5abc" is rejected rather than silently reinterpreted.
 */
export const USDC_AMOUNT_PATTERN = /^\d+(?:\.\d{1,6})?$/;

/**
 * Convert a decimal amount string into six-decimal atomic units.
 *
 * Unlike parseFloat, this rejects partially numeric input and amounts with more
 * than six fractional digits (which would otherwise be silently truncated), so a
 * request can never move a different value than the literal string asked for.
 *
 * @throws if `value` is not a valid non-negative six-decimal amount.
 */
export function parseUsdcAmountToAtomicUnits(value: string): bigint {
  const normalized = value.trim();
  if (!USDC_AMOUNT_PATTERN.test(normalized)) {
    throw new Error(`Invalid USDC amount: ${value}`);
  }

  const [whole, fraction = ""] = normalized.split(".");
  const paddedFraction = `${fraction}000000`.slice(0, 6);
  return BigInt(whole) * USDC_ATOMIC_MULTIPLIER + BigInt(paddedFraction);
}

/**
 * Render six-decimal atomic units back into a canonical decimal string, with no
 * trailing zeros (e.g. 1_500_000n -> "1.5", 1_000_000n -> "1").
 */
export function formatUsdcAtomicUnits(value: bigint): string {
  const whole = value / USDC_ATOMIC_MULTIPLIER;
  const fraction = value % USDC_ATOMIC_MULTIPLIER;

  if (fraction === ZERO_BIGINT) {
    return whole.toString();
  }

  const fractionDigits = fraction.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractionDigits}`;
}
