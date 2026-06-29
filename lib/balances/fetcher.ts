/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {
  ChainBalances,
  EMPTY_CHAIN_BALANCES,
  Wallet,
} from "./types"

type ChainBalanceItem = {
  chain: keyof ChainBalances | string
  balance: number
}

/**
 * Per-chain Gateway breakdown row returned by `/api/gateway/balance`. Mirrors
 * the App Kit `ChainBalanceBreakdown` after we map the SDK's chain enum back
 * to our internal SDK chain key.
 */
type GatewayChainBalanceItem = {
  domain: number
  balance: number
  pendingBalance: number
  chain: string
  address: string
}

type GatewayBalanceWalletResult = {
  gatewayTotal?: number
  gatewayPending?: number
  gatewayBalances?: GatewayChainBalanceItem[]
  chainBalances?: ChainBalanceItem[]
}

type GatewayBalanceResponse = {
  balances?: GatewayBalanceWalletResult[]
  totalUnified?: number
  totalUnifiedPending?: number
}

export type GatewayBalanceSummary = {
  /**
   * On-wallet USDC totals per chain (viem `balanceOf`). These are funds the
   * user has *not* yet deposited into Gateway.
   */
  totals: ChainBalances
  /** Sum of confirmed Gateway balances across every chain and address. */
  grandTotal: number
  /** Sum of pending Gateway balances across every chain and address. */
  pendingTotal: number
  /** Confirmed Gateway balance per chain. */
  gatewayTotals: ChainBalances
  /** Pending Gateway balance per chain. */
  gatewayPendingTotals: ChainBalances
}

/**
 * Calls `/api/gateway/balance` and aggregates the per-wallet totals into the
 * shape the UI expects. Returns an empty summary if no wallets are passed.
 */
export async function fetchGatewayBalance(
  wallets: Wallet[]
): Promise<GatewayBalanceSummary> {
  const empty: GatewayBalanceSummary = {
    totals: { ...EMPTY_CHAIN_BALANCES },
    grandTotal: 0,
    pendingTotal: 0,
    gatewayTotals: { ...EMPTY_CHAIN_BALANCES },
    gatewayPendingTotals: { ...EMPTY_CHAIN_BALANCES },
  }
  if (!wallets || wallets.length === 0) return empty

  const addresses = wallets.map((w) => w.address)
  const res = await fetch("/api/gateway/balance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addresses }),
  })
  if (!res.ok) throw new Error("Failed to fetch gateway balance")

  const data: GatewayBalanceResponse = await res.json()
  const summary: GatewayBalanceSummary = {
    totals: { ...EMPTY_CHAIN_BALANCES },
    grandTotal: 0,
    pendingTotal: 0,
    gatewayTotals: { ...EMPTY_CHAIN_BALANCES },
    gatewayPendingTotals: { ...EMPTY_CHAIN_BALANCES },
  }

  if (data.balances && Array.isArray(data.balances)) {
    data.balances.forEach((walletResult) => {
      summary.grandTotal += walletResult.gatewayTotal || 0
      summary.pendingTotal += walletResult.gatewayPending || 0

      if (walletResult.chainBalances && Array.isArray(walletResult.chainBalances)) {
        walletResult.chainBalances.forEach((cb) => {
          if (summary.totals[cb.chain as keyof ChainBalances] !== undefined) {
            summary.totals[cb.chain as keyof ChainBalances] += cb.balance
          }
        })
      }

      if (
        walletResult.gatewayBalances &&
        Array.isArray(walletResult.gatewayBalances)
      ) {
        walletResult.gatewayBalances.forEach((gb) => {
          const key = gb.chain as keyof ChainBalances
          if (summary.gatewayTotals[key] !== undefined) {
            summary.gatewayTotals[key] += gb.balance
            summary.gatewayPendingTotals[key] += gb.pendingBalance
          }
        })
      }
    })
  }

  return summary
}

/**
 * Calls `/api/wallet/balance` for a set of wallets and returns the raw
 * `{ [walletId]: balanceString }` map. Caller is responsible for merging with
 * any prior balances and computing per-address totals.
 */
export async function fetchWalletBalance(
  wallets: Wallet[]
): Promise<Record<string, string>> {
  if (!wallets || wallets.length === 0) return {}

  const walletIds = wallets.map((w) => w.circle_wallet_id)
  const res = await fetch("/api/wallet/balance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletIds }),
  })
  if (!res.ok) throw new Error("Failed to fetch wallet balance")

  return (await res.json()) as Record<string, string>
}

/**
 * Computes a deduplicated USDC total across wallets given the raw balance
 * map. We collapse to one entry per (address, chain) so the same wallet
 * isn't counted multiple times when several wallet IDs share an address.
 */
export function computeWalletTotal(
  wallets: Wallet[],
  balances: Record<string, string>
): number {
  const walletKey = new Map<string, number>()
  wallets.forEach((wallet) => {
    const balance = balances[wallet.circle_wallet_id]
    if (typeof balance !== "string") return
    const numericPart = balance.split(" ")[0].replace(/[$,]/g, "")
    const num = parseFloat(numericPart)
    if (Number.isNaN(num)) return
    const key = `${wallet.address.toLowerCase()}-${wallet.blockchain}`
    const existing = walletKey.get(key) || 0
    walletKey.set(key, Math.max(existing, num))
  })
  return Array.from(walletKey.values()).reduce((total, bal) => total + bal, 0)
}
