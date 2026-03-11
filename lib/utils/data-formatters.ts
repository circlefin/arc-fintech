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

// Utility to create wallet/transaction details for search results
export interface WalletDetails {
  id: string
  name: string
  address: string
  blockchain: string
  type: string
  balance?: string
  created_at: string
}

export interface TransactionDetails {
  id: string
  amount: number
  sender_address: string
  recipient_address?: string
  blockchain: string
  status: string
  type: string
  created_at: string
  updated_at?: string
  tx_hash?: string
}

export function formatWalletDetails(wallet: any): WalletDetails {
  return {
    id: wallet.id || '',
    name: wallet.name || 'Unnamed Wallet',
    address: wallet.address || '',
    blockchain: wallet.blockchain || 'Unknown',
    type: wallet.type || 'Unknown',
    balance: wallet.balance || '$0.00',
    created_at: wallet.created_at || new Date().toISOString()
  }
}

export function formatTransactionDetails(tx: any): TransactionDetails {
  return {
    id: tx.id || '',
    amount: tx.amount || 0,
    sender_address: tx.sender_address || '',
    recipient_address: tx.recipient_address || '',
    blockchain: tx.blockchain || 'Unknown',
    status: tx.status || 'Unknown',
    type: tx.type || 'Unknown',
    created_at: tx.created_at || new Date().toISOString(),
    updated_at: tx.updated_at,
    tx_hash: tx.tx_hash
  }
}

export function shortenAddress(address: string, chars: number = 6): string {
  if (!address) return ''
  if (address.length < chars * 2) return address
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

export function formatDate(dateString: string): string {
  if (typeof window === 'undefined') return dateString
  try {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "numeric"
    })
  } catch {
    return dateString
  }
}

export function formatAmount(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount)
}
