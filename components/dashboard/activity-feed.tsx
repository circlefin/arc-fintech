/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

"use client"

import * as React from "react"
import {
  IconArrowsLeftRight,
  IconLoader,
  IconPlus,
  IconWallet,
} from "@tabler/icons-react"

import { isGatewayDepositRecipient } from "@/lib/constants/chains"
import {
  shortenAddress,
  getExplorerUrl,
} from "@/lib/utils/data-formatters"
import type {
  FullTransaction,
  FullWallet,
} from "@/lib/contexts/balance-context"

type ActivityItem = {
  id: string
  type: "wallet_created" | "transfer" | "deposit"
  title: React.ReactNode
  description: React.ReactNode
  timestamp: string
  icon: React.ElementType
}

function formatDate(dateString: string) {
  if (typeof window === "undefined") return dateString
  try {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    })
  } catch {
    return dateString
  }
}

/**
 * Renders the most recent N entries of the dashboard activity feed (wallet
 * creations + transactions). Lifted out of `app/dashboard/page.tsx` so the
 * page is not 700 lines and so the same feed can be reused.
 */
export function ActivityFeed({
  wallets,
  transactions,
  loading,
  limit = 5,
}: {
  wallets: FullWallet[]
  transactions: FullTransaction[]
  loading: boolean
  limit?: number
}) {
  const items = React.useMemo<ActivityItem[]>(() => {
    const walletItems: ActivityItem[] = wallets.map((wallet) => ({
      id: `create-${wallet.id}`,
      type: "wallet_created",
      title: (
        <span>
          New <span className="font-semibold">{wallet.type}</span> wallet created
        </span>
      ),
      timestamp: wallet.created_at,
      icon: IconWallet,
      description: (
        <span>
          {wallet.name}{" "}
          <span className="text-muted-foreground">({wallet.blockchain})</span>
        </span>
      ),
    }))

    const txItems: ActivityItem[] = transactions.map((tx) => {
      const isDeposit = isGatewayDepositRecipient(tx.recipient_address)

      if (isDeposit) {
        const senderWallet = wallets.find(
          (w) =>
            (w.address ?? "").toLowerCase() ===
            (tx.sender_address ?? "").toLowerCase()
        )
        const blockchain = senderWallet?.blockchain

        return {
          id: `tx-${tx.id}`,
          type: "deposit",
          title: (
            <span>
              ${(tx.amount ?? 0).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          ),
          timestamp: tx.created_at,
          icon: IconPlus,
          description: (
            <>
              {blockchain ? (
                <a
                  href={getExplorerUrl(blockchain, tx.sender_address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono hover:text-primary hover:underline transition-colors"
                >
                  {shortenAddress(tx.sender_address)}
                </a>
              ) : (
                <span className="font-mono">
                  {shortenAddress(tx.sender_address)}
                </span>
              )}{" "}
              → Gateway Balance
            </>
          ),
        }
      }

      return {
        id: `tx-${tx.id}`,
        type: "transfer",
        title: (
          <span>
            ${(tx.amount ?? 0).toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        ),
        timestamp: tx.created_at,
        icon: IconArrowsLeftRight,
        description: (
          <span>
            {shortenAddress(tx.sender_address)} →{" "}
            {shortenAddress(tx.recipient_address)}
          </span>
        ),
      }
    })

    return [...walletItems, ...txItems].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
  }, [wallets, transactions])

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <IconLoader className="animate-spin" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
        <div className="bg-muted flex size-12 items-center justify-center rounded-full">
          <IconArrowsLeftRight className="text-muted-foreground size-6" />
        </div>
        <h3 className="text-sm font-medium">No activity yet</h3>
        <p className="text-muted-foreground text-xs">
          Create a wallet and make your first transaction to see activity.
        </p>
      </div>
    )
  }

  return (
    <>
      {items.slice(0, limit).map((item) => (
        <div
          key={item.id}
          className="flex items-start gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500"
        >
          <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg border border-transparent">
            <item.icon className="size-4" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium leading-none">{item.title}</div>
              <span className="text-[10px] text-muted-foreground/60">
                {formatDate(item.timestamp)}
              </span>
            </div>
            <div className="text-muted-foreground text-xs">
              {item.description}
            </div>
          </div>
        </div>
      ))}
    </>
  )
}
