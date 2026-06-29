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

"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  ReactNode,
} from "react"
import { createClient } from "@/lib/supabase/client"
import { RealtimeChannel } from "@supabase/supabase-js"
import {
  ChainBalances,
  EMPTY_CHAIN_BALANCES,
  FullTransaction,
  FullWallet,
  Wallet,
} from "@/lib/balances/types"
import {
  computeWalletTotal,
  fetchGatewayBalance as fetchGatewayBalanceApi,
  fetchWalletBalance as fetchWalletBalanceApi,
} from "@/lib/balances/fetcher"
import {
  ProcessedSet,
  subscribeBalanceRealtime,
} from "@/lib/balances/realtime"

export type { FullWallet, FullTransaction } from "@/lib/balances/types"

// Debounce delay - prevents rapid consecutive API calls
const DEBOUNCE_DELAY = 3000

// Cooldown period - minimum time between actual API calls
const FETCH_COOLDOWN = 5000

type BalanceContextType = {
  /**
   * On-wallet USDC per chain (viem `balanceOf` against each USDC contract).
   * These are funds the user has not yet deposited into Gateway.
   */
  chainBalances: ChainBalances
  /** Confirmed Gateway balance per chain. */
  gatewayChainBalances: ChainBalances
  /** Pending Gateway balance per chain. */
  gatewayPendingChainBalances: ChainBalances
  /** Total confirmed Gateway balance across all chains and wallets. */
  gatewayTotal: number
  /** Total pending Gateway balance across all chains and wallets. */
  gatewayPending: number

  walletBalances: Record<string, string>
  walletTotal: number

  isLoadingGateway: boolean
  isLoadingWallet: boolean
  isLoadingData: boolean

  /** Slim wallet list used internally (exposed for legacy consumers). */
  wallets: Wallet[]

  /**
   * Full `wallets` rows for everything outside the balance loop — activity
   * feed, wallets table, dialogs. Owned by this provider so we keep a single
   * Realtime subscription for wallet changes.
   */
  fullWallets: FullWallet[]

  /**
   * All `transactions` rows for the current user, kept in sync via the
   * provider's Realtime subscription. Replaces the per-page channels that
   * previously duplicated this load.
   */
  transactions: FullTransaction[]

  /** Most recent dataset refresh (used by status indicators). */
  lastUpdated: Date | null

  refreshGatewayBalance: () => Promise<void>
  refreshWalletBalance: () => Promise<void>
}

const BalanceContext = createContext<BalanceContextType | null>(null)

export function useBalanceContext() {
  const context = useContext(BalanceContext)
  if (!context) {
    throw new Error("useBalanceContext must be used within a BalanceProvider")
  }
  return context
}

export function BalanceProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [fullWallets, setFullWallets] = useState<FullWallet[]>([])
  const [transactions, setTransactions] = useState<FullTransaction[]>([])
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isLoadingData, setIsLoadingData] = useState(true)
  const walletsRef = useRef<Wallet[]>([])

  const [chainBalances, setChainBalances] = useState<ChainBalances>({
    ...EMPTY_CHAIN_BALANCES,
  })
  const [gatewayChainBalances, setGatewayChainBalances] = useState<ChainBalances>({
    ...EMPTY_CHAIN_BALANCES,
  })
  const [gatewayPendingChainBalances, setGatewayPendingChainBalances] = useState<ChainBalances>({
    ...EMPTY_CHAIN_BALANCES,
  })
  const [gatewayTotal, setGatewayTotal] = useState(0)
  const [gatewayPending, setGatewayPending] = useState(0)
  const [isLoadingGateway, setIsLoadingGateway] = useState(true)

  const [walletBalances, setWalletBalances] = useState<Record<string, string>>({})
  const [walletTotal, setWalletTotal] = useState(0)
  const [isLoadingWallet, setIsLoadingWallet] = useState(true)

  const gatewayDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const walletDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const lastGatewayFetchRef = useRef<number>(0)
  const lastWalletFetchRef = useRef<number>(0)

  // Dedupes bursty Realtime UPDATE payloads (Bridge Kit fires twice on settle).
  const processedTxRef = useRef<ProcessedSet>(new ProcessedSet())

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    walletsRef.current = wallets
  }, [wallets])

  const loadGatewayBalance = useCallback(async (currentWallets: Wallet[]) => {
    try {
      const summary = await fetchGatewayBalanceApi(currentWallets)
      // `totals` is on-wallet (un-deposited) USDC per chain via viem.
      setChainBalances(summary.totals)
      // `gatewayTotals` is confirmed Gateway balance per chain via App Kit.
      setGatewayChainBalances(summary.gatewayTotals)
      setGatewayPendingChainBalances(summary.gatewayPendingTotals)
      setGatewayTotal(summary.grandTotal)
      setGatewayPending(summary.pendingTotal)
      lastGatewayFetchRef.current = Date.now()
    } catch (error) {
      console.error("Error fetching gateway balance:", error)
    } finally {
      setIsLoadingGateway(false)
    }
  }, [])

  const loadWalletBalance = useCallback(async (currentWallets: Wallet[]) => {
    try {
      const data = await fetchWalletBalanceApi(currentWallets)
      setWalletBalances((prev) => {
        const newBalances = { ...prev, ...data }
        setWalletTotal(computeWalletTotal(walletsRef.current, newBalances))
        return newBalances
      })
      lastWalletFetchRef.current = Date.now()
    } catch (error) {
      console.error("Error fetching wallet balance:", error)
    } finally {
      setIsLoadingWallet(false)
    }
  }, [])

  // Debounced refreshers — used by Realtime handlers so a burst of webhook
  // UPDATEs collapses into a single Circle round-trip.
  const debouncedGatewayRefresh = useCallback(() => {
    if (gatewayDebounceRef.current) clearTimeout(gatewayDebounceRef.current)
    const timeSinceLastFetch = Date.now() - lastGatewayFetchRef.current
    const delay =
      timeSinceLastFetch < FETCH_COOLDOWN
        ? Math.max(DEBOUNCE_DELAY, FETCH_COOLDOWN - timeSinceLastFetch)
        : DEBOUNCE_DELAY
    gatewayDebounceRef.current = setTimeout(() => {
      loadGatewayBalance(walletsRef.current)
    }, delay)
  }, [loadGatewayBalance])

  const debouncedWalletRefresh = useCallback(() => {
    if (walletDebounceRef.current) clearTimeout(walletDebounceRef.current)
    const timeSinceLastFetch = Date.now() - lastWalletFetchRef.current
    const delay =
      timeSinceLastFetch < FETCH_COOLDOWN
        ? Math.max(DEBOUNCE_DELAY, FETCH_COOLDOWN - timeSinceLastFetch)
        : DEBOUNCE_DELAY
    walletDebounceRef.current = setTimeout(() => {
      loadWalletBalance(walletsRef.current)
    }, delay)
  }, [loadWalletBalance])

  // Manual refreshers used by dialogs after a user-initiated action — they
  // bypass debouncing because the user expects immediate feedback.
  const refreshGatewayBalance = useCallback(async () => {
    await loadGatewayBalance(walletsRef.current)
  }, [loadGatewayBalance])

  const refreshWalletBalance = useCallback(async () => {
    await loadWalletBalance(walletsRef.current)
  }, [loadWalletBalance])

  useEffect(() => {
    let channel: RealtimeChannel | null = null

    const setupData = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return

        // Load wallets and transactions in parallel. We previously fetched a
        // slim wallets shape here and the dashboard refetched `*` itself in a
        // second channel — collapsed to one place so consumers stay in sync.
        const [walletsRes, txRes] = await Promise.all([
          supabase
            .from("wallets")
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false }),
          supabase
            .from("transactions")
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false }),
        ])

        if (walletsRes.error) throw walletsRes.error
        if (txRes.error) throw txRes.error

        const fullWalletsData = (walletsRes.data || []) as FullWallet[]
        // Slim list is what feeds the balance fetchers — rows missing the
        // critical fields (address/circle_wallet_id/blockchain are all
        // nullable in the wallets table) would just produce 0 balances and
        // crash the Realtime handlers later if we let them through.
        const initialWallets: Wallet[] = fullWalletsData
          .filter(
            (w) => !!w.address && !!w.circle_wallet_id && !!w.blockchain
          )
          .map((w) => ({
            id: w.id,
            address: w.address,
            circle_wallet_id: w.circle_wallet_id,
            blockchain: w.blockchain,
          }))

        setFullWallets(fullWalletsData)
        setTransactions((txRes.data || []) as FullTransaction[])
        setWallets(initialWallets)
        walletsRef.current = initialWallets
        setLastUpdated(new Date())
        setIsLoadingData(false)

        await Promise.all([
          loadGatewayBalance(initialWallets),
          loadWalletBalance(initialWallets),
        ])

        channel = subscribeBalanceRealtime({
          supabase,
          userId: user.id,
          onWalletChange: ({ eventType, newRow, oldId }) => {
            if (eventType === "INSERT" && newRow) {
              // The wallets table allows null address/circle_wallet_id/blockchain
              // (see 20251210161755_create_wallets_table.sql), and Circle's
              // create-wallet flow inserts the row before the address is
              // populated. Skip side-effects until the row is actually usable
              // — the follow-up UPDATE will pick it up.
              setFullWallets((prev) =>
                prev.some((w) => w.id === newRow.id) ? prev : [newRow, ...prev]
              )
              setLastUpdated(new Date())

              if (
                !newRow.address ||
                !newRow.circle_wallet_id ||
                !newRow.blockchain
              ) {
                return
              }

              const slim: Wallet = {
                id: newRow.id,
                address: newRow.address,
                circle_wallet_id: newRow.circle_wallet_id,
                blockchain: newRow.blockchain,
              }
              setWallets((prev) => {
                if (prev.some((w) => w.id === slim.id)) return prev
                const updated = [slim, ...prev]
                walletsRef.current = updated
                loadWalletBalance([slim])
                const isNewAddress = !prev.some(
                  (w) =>
                    !!w.address &&
                    w.address.toLowerCase() === slim.address.toLowerCase()
                )
                if (isNewAddress) debouncedGatewayRefresh()
                return updated
              })
            } else if (eventType === "UPDATE" && newRow) {
              setFullWallets((prev) =>
                prev.map((w) => (w.id === newRow.id ? newRow : w))
              )
              setLastUpdated(new Date())

              // Same nullable-column guard as INSERT. If the UPDATE is what
              // fills in a previously-empty address, promote the row into
              // the slim list now (and refresh balances), otherwise just
              // update the existing entry in place.
              if (
                !newRow.address ||
                !newRow.circle_wallet_id ||
                !newRow.blockchain
              ) {
                return
              }

              const slim: Wallet = {
                id: newRow.id,
                address: newRow.address,
                circle_wallet_id: newRow.circle_wallet_id,
                blockchain: newRow.blockchain,
              }
              setWallets((prev) => {
                const existing = prev.find((w) => w.id === slim.id)
                if (!existing) {
                  const updated = [slim, ...prev]
                  walletsRef.current = updated
                  loadWalletBalance([slim])
                  debouncedGatewayRefresh()
                  return updated
                }
                const updated = prev.map((w) => (w.id === slim.id ? slim : w))
                walletsRef.current = updated
                return updated
              })
            } else if (eventType === "DELETE" && oldId) {
              setFullWallets((prev) => prev.filter((w) => w.id !== oldId))
              setWallets((prev) => {
                const updated = prev.filter((w) => w.id !== oldId)
                walletsRef.current = updated
                if (updated.length === 0) {
                  setGatewayTotal(0)
                  setGatewayPending(0)
                  setGatewayChainBalances({ ...EMPTY_CHAIN_BALANCES })
                  setGatewayPendingChainBalances({ ...EMPTY_CHAIN_BALANCES })
                  setWalletTotal(0)
                }
                return updated
              })
              setLastUpdated(new Date())
            }
          },
          onTransactionChange: ({ eventType, newRow, oldId }) => {
            // Refresh balances once a transaction reaches its terminal COMPLETE
            // state and touches one of our wallets. Handles both UPDATE→COMPLETE
            // (dashboard-initiated flows that settle later) and INSERT of an
            // already-COMPLETE row (e.g. a Gateway deposit made outside the app
            // that the webhook records straight as COMPLETE). ProcessedSet
            // dedupes the bursty pairs Bridge Kit fires during settlement.
            const maybeRefreshForCompletedTx = (row: FullTransaction) => {
              if (row.status !== "COMPLETE") return
              if (processedTxRef.current.has(row.id)) return
              processedTxRef.current.add(row.id)

              // Defensive lower-casing: any of these address fields can be
              // null in the schema, and Realtime payloads occasionally arrive
              // without the full row.
              const sender = row.sender_address?.toLowerCase() ?? ""
              const recipient = row.recipient_address?.toLowerCase() ?? ""
              const isRelevant = walletsRef.current.some((w) => {
                const addr = w.address?.toLowerCase() ?? ""
                if (!addr) return false
                return addr === sender || addr === recipient
              })
              if (isRelevant) {
                debouncedWalletRefresh()
                debouncedGatewayRefresh()
              }
            }

            if (eventType === "INSERT" && newRow) {
              setTransactions((prev) =>
                prev.some((tx) => tx.id === newRow.id) ? prev : [newRow, ...prev]
              )
              setLastUpdated(new Date())
              maybeRefreshForCompletedTx(newRow)
            } else if (eventType === "UPDATE" && newRow) {
              setTransactions((prev) =>
                prev.map((tx) => (tx.id === newRow.id ? newRow : tx))
              )
              setLastUpdated(new Date())
              maybeRefreshForCompletedTx(newRow)
            } else if (eventType === "DELETE" && oldId) {
              setTransactions((prev) => prev.filter((tx) => tx.id !== oldId))
              setLastUpdated(new Date())
            }
          },
        })
      } catch (error) {
        console.error("Error setting up balance context:", error)
        setIsLoadingGateway(false)
        setIsLoadingWallet(false)
        setIsLoadingData(false)
      }
    }

    setupData()

    return () => {
      if (channel) supabase.removeChannel(channel)
      if (gatewayDebounceRef.current) clearTimeout(gatewayDebounceRef.current)
      if (walletDebounceRef.current) clearTimeout(walletDebounceRef.current)
    }
  }, [
    supabase,
    loadGatewayBalance,
    loadWalletBalance,
    debouncedGatewayRefresh,
    debouncedWalletRefresh,
  ])

  return (
    <BalanceContext.Provider
      value={{
        chainBalances,
        gatewayChainBalances,
        gatewayPendingChainBalances,
        gatewayTotal,
        gatewayPending,
        walletBalances,
        walletTotal,
        isLoadingGateway,
        isLoadingWallet,
        isLoadingData,
        wallets,
        fullWallets,
        transactions,
        lastUpdated,
        refreshGatewayBalance,
        refreshWalletBalance,
      }}
    >
      {children}
    </BalanceContext.Provider>
  )
}
