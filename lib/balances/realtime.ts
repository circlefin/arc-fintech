/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js"
import type { FullTransaction, FullWallet } from "./types"

type WalletEventHandler = (payload: {
  eventType: "INSERT" | "UPDATE" | "DELETE"
  newRow?: FullWallet
  oldId?: string
}) => void

type TransactionEventHandler = (payload: {
  eventType: "INSERT" | "UPDATE" | "DELETE"
  newRow?: FullTransaction
  oldId?: string
}) => void

type SubscribeArgs = {
  supabase: SupabaseClient
  userId: string
  onWalletChange: WalletEventHandler
  onTransactionChange: TransactionEventHandler
}

/**
 * Subscribes to the single Realtime channel that backs the entire app's
 * wallet + transaction state. Pulled out of the provider so the provider
 * stays focused on state composition rather than channel plumbing.
 */
export function subscribeBalanceRealtime({
  supabase,
  userId,
  onWalletChange,
  onTransactionChange,
}: SubscribeArgs): RealtimeChannel {
  return supabase
    .channel("balance-context-realtime")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "wallets",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (payload.eventType === "INSERT") {
          onWalletChange({
            eventType: "INSERT",
            newRow: payload.new as FullWallet,
          })
        } else if (payload.eventType === "UPDATE") {
          onWalletChange({
            eventType: "UPDATE",
            newRow: payload.new as FullWallet,
          })
        } else if (payload.eventType === "DELETE") {
          onWalletChange({
            eventType: "DELETE",
            oldId: (payload.old as { id: string }).id,
          })
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "transactions",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (payload.eventType === "INSERT") {
          onTransactionChange({
            eventType: "INSERT",
            newRow: payload.new as FullTransaction,
          })
        } else if (payload.eventType === "UPDATE") {
          onTransactionChange({
            eventType: "UPDATE",
            newRow: payload.new as FullTransaction,
          })
        } else if (payload.eventType === "DELETE") {
          onTransactionChange({
            eventType: "DELETE",
            oldId: (payload.old as { id: string }).id,
          })
        }
      }
    )
    .subscribe()
}

/**
 * Tiny LRU-ish set used to dedupe Realtime updates that fire twice during
 * Bridge Kit settlement. Kept here so it can be unit-tested without booting
 * the React tree.
 */
export class ProcessedSet {
  private set = new Set<string>()
  constructor(private maxSize = 100, private trimTo = 50) {}

  has(id: string) {
    return this.set.has(id)
  }

  add(id: string) {
    this.set.add(id)
    if (this.set.size > this.maxSize) {
      const ids = Array.from(this.set)
      this.set = new Set(ids.slice(-this.trimTo))
    }
  }
}
