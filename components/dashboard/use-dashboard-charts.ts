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

import { useEffect, useMemo, useState } from "react"
import { isGatewayDepositRecipient } from "@/lib/constants/chains"
import type {
  FullTransaction,
  FullWallet,
} from "@/lib/contexts/balance-context"

const DAYS_TO_LOOK_BACK = 90

// Build the rolling date window for the dashboard charts. This is its own
// helper so we can call it inside `useEffect` (i.e. only in the browser).
// Reading `new Date()` during render is forbidden in Next.js 16 client
// components without a Suspense boundary above them — see
// https://nextjs.org/docs/messages/next-prerender-current-time-client.
function buildWindow(): string[] {
  const today = new Date()
  const dates: string[] = []
  for (let i = DAYS_TO_LOOK_BACK - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(today.getDate() - i)
    dates.push(d.toLocaleDateString("en-CA"))
  }
  return dates
}

export type DashboardChartDatasets = {
  transactionsChartData: Array<{ date: string; total: number }>
  flowData: Array<{ date: string; inflow: number; outflow: number }>
  chainData: Array<{
    date: string
    eth: number
    base: number
    avax: number
    arc: number
  }>
}

/**
 * Bucket the user's transactions into the three datasets the dashboard charts
 * render: total transaction count per day, inflow vs outflow per day, and
 * per-chain distribution per day. Pulled out of `app/dashboard/page.tsx` so
 * the page component is just composition.
 */
export function useDashboardCharts(
  transactions: FullTransaction[],
  wallets: FullWallet[]
): DashboardChartDatasets {
  // Defer "what days are in the rolling 90d window" to a browser-only effect
  // so SSR doesn't try to read the current time. Until the effect fires we
  // return empty datasets, which is fine — the charts also need
  // transactions/wallets from BalanceContext (also browser-only) before they
  // render anything meaningful.
  const [windowDates, setWindowDates] = useState<string[] | null>(null)
  useEffect(() => {
    setWindowDates(buildWindow())
  }, [])

  return useMemo(() => {
    if (!windowDates) {
      return {
        transactionsChartData: [],
        flowData: [],
        chainData: [],
      }
    }

    const dataMap = new Map<
      string,
      {
        date: string
        total: number
        inflow: number
        outflow: number
        eth: number
        base: number
        avax: number
        arc: number
      }
    >()

    for (const dateStr of windowDates) {
      dataMap.set(dateStr, {
        date: dateStr,
        total: 0,
        inflow: 0,
        outflow: 0,
        eth: 0,
        base: 0,
        avax: 0,
        arc: 0,
      })
    }

    const internalWalletAddresses = new Set(
      wallets.map((w) => (w.address ?? "").toLowerCase())
    )

    transactions.forEach((tx) => {
      const dateStr = new Date(tx.created_at).toLocaleDateString("en-CA")
      if (!dataMap.has(dateStr)) return
      const entry = dataMap.get(dateStr)!

      entry.total += 1

      const isGateway = isGatewayDepositRecipient(tx.recipient_address)
      const isSenderInternal = internalWalletAddresses.has(
        (tx.sender_address ?? "").toLowerCase()
      )
      const isRecipientInternal = internalWalletAddresses.has(
        (tx.recipient_address ?? "").toLowerCase()
      )

      if (!isGateway && isSenderInternal && isRecipientInternal) {
        entry.inflow += 1
        entry.outflow += 1
      } else if (tx.type === "INBOUND") {
        entry.inflow += 1
      } else {
        entry.outflow += 1
      }

      switch (tx.blockchain) {
        case "ETH-SEPOLIA":
          entry.eth += 1
          break
        case "BASE-SEPOLIA":
          entry.base += 1
          break
        case "AVAX-FUJI":
          entry.avax += 1
          break
        case "ARC-TESTNET":
          entry.arc += 1
          break
      }
    })

    const sortedData = Array.from(dataMap.values()).sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    )

    // Force 00:00 local so the chart x-axis labels don't shift back a day.
    const formatForChart = <T extends { date: string }>(d: T): T => ({
      ...d,
      date: `${d.date}T00:00:00`,
    })

    return {
      transactionsChartData: sortedData.map((d) =>
        formatForChart({ date: d.date, total: d.total })
      ),
      flowData: sortedData.map((d) =>
        formatForChart({ date: d.date, inflow: d.inflow, outflow: d.outflow })
      ),
      chainData: sortedData.map((d) =>
        formatForChart({
          date: d.date,
          eth: d.eth,
          base: d.base,
          avax: d.avax,
          arc: d.arc,
        })
      ),
    }
  }, [transactions, wallets, windowDates])
}
