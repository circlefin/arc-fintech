/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Slim wallet shape used internally for balance fetching. Activity feed,
 * wallets table, etc. consume the full row instead — see {@link FullWallet}.
 */
export type Wallet = {
  id: string
  address: string
  circle_wallet_id: string
  blockchain: string
}

/**
 * The full `wallets` row shape. Keep this in sync with the Supabase schema
 * (or replace with the generated types once `npx supabase gen types` is
 * wired up — Phase 4).
 */
export type FullWallet = {
  id: string
  user_id: string
  name: string
  address: string
  blockchain: string
  type: "treasury" | "payout" | "customer" | "gateway_signer"
  circle_wallet_id: string
  created_at: string
  updated_at?: string | null
}

export type FullTransaction = {
  id: string
  user_id: string
  amount: number
  sender_address: string
  recipient_address: string
  blockchain: string
  status: "PENDING" | "CONFIRMED" | "COMPLETE" | "FAILED"
  type: "INBOUND" | "OUTBOUND" | "REBALANCE"
  tx_hash: string | null
  circle_transaction_id: string | null
  created_at: string
  updated_at?: string | null
}

export type ChainBalances = {
  ethSepolia: number
  baseSepolia: number
  avalancheFuji: number
  arcTestnet: number
}

export const EMPTY_CHAIN_BALANCES: ChainBalances = {
  ethSepolia: 0,
  baseSepolia: 0,
  avalancheFuji: 0,
  arcTestnet: 0,
}
