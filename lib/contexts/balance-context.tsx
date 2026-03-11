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

import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo, ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { RealtimeChannel } from "@supabase/supabase-js"

const GATEWAY_ADDRESS = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"

// Debounce delay - prevents rapid consecutive API calls
const DEBOUNCE_DELAY = 3000

// Cooldown period - minimum time between actual API calls
const FETCH_COOLDOWN = 5000

type Wallet = {
  id: string
  address: string
  circle_wallet_id: string
  blockchain: string
}

type Transaction = {
  id: string
  status: string
  sender_address: string
  recipient_address: string
}

type ChainBalances = {
  ethSepolia: number
  baseSepolia: number
  avalancheFuji: number
  arcTestnet: number
}

type BalanceContextType = {
  // Gateway balance data (for SectionCards)
  chainBalances: ChainBalances
  gatewayTotal: number

  // Wallet balance data (for Dashboard)
  walletBalances: Record<string, string>
  walletTotal: number

  // Loading states
  isLoadingGateway: boolean
  isLoadingWallet: boolean

  // Wallets list
  wallets: Wallet[]

  // Manual refresh functions (for dialogs, etc.)
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
  const walletsRef = useRef<Wallet[]>([])

  // Gateway balance state
  const [chainBalances, setChainBalances] = useState<ChainBalances>({
    ethSepolia: 0,
    baseSepolia: 0,
    avalancheFuji: 0,
    arcTestnet: 0,
  })
  const [gatewayTotal, setGatewayTotal] = useState(0)
  const [isLoadingGateway, setIsLoadingGateway] = useState(true)

  // Wallet balance state
  const [walletBalances, setWalletBalances] = useState<Record<string, string>>({})
  const [walletTotal, setWalletTotal] = useState(0)
  const [isLoadingWallet, setIsLoadingWallet] = useState(true)

  // Debounce and cooldown refs
  const gatewayDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const walletDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const lastGatewayFetchRef = useRef<number>(0)
  const lastWalletFetchRef = useRef<number>(0)

  // Track processed transaction IDs to avoid duplicate processing
  const processedTxRef = useRef<Set<string>>(new Set())

  const supabase = useMemo(() => createClient(), [])

  // Keep ref in sync
  useEffect(() => {
    walletsRef.current = wallets
  }, [wallets])

  // Fetch gateway balance
  const fetchGatewayBalance = useCallback(async (currentWallets: Wallet[]) => {
    if (!currentWallets || currentWallets.length === 0) {
      setChainBalances({ ethSepolia: 0, baseSepolia: 0, avalancheFuji: 0, arcTestnet: 0 })
      setGatewayTotal(0)
      setIsLoadingGateway(false)
      return
    }

    const addresses = currentWallets.map((w) => w.address)

    try {
      const res = await fetch("/api/gateway/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses }),
      })

      if (!res.ok) throw new Error("Failed to fetch gateway balance")

      const data = await res.json()

      const totals: ChainBalances = {
        ethSepolia: 0,
        baseSepolia: 0,
        avalancheFuji: 0,
        arcTestnet: 0,
      }

      let grandTotal = 0

      if (data.balances && Array.isArray(data.balances)) {
        data.balances.forEach((walletResult: any) => {
          grandTotal += walletResult.gatewayTotal || 0

          if (walletResult.chainBalances && Array.isArray(walletResult.chainBalances)) {
            walletResult.chainBalances.forEach((cb: any) => {
              if (totals[cb.chain as keyof ChainBalances] !== undefined) {
                totals[cb.chain as keyof ChainBalances] += cb.balance
              }
            })
          }
        })
      }

      setChainBalances(totals)
      setGatewayTotal(grandTotal)
      lastGatewayFetchRef.current = Date.now()
    } catch (error) {
      console.error("Error fetching gateway balance:", error)
    } finally {
      setIsLoadingGateway(false)
    }
  }, [])

  // Fetch wallet balance
  const fetchWalletBalance = useCallback(async (currentWallets: Wallet[]) => {
    if (!currentWallets || currentWallets.length === 0) {
      setWalletBalances({})
      setWalletTotal(0)
      setIsLoadingWallet(false)
      return
    }

    const walletIds = currentWallets.map((w) => w.circle_wallet_id)

    try {
      const res = await fetch("/api/wallet/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletIds }),
      })

      if (!res.ok) throw new Error("Failed to fetch wallet balance")

      const data = await res.json()

      setWalletBalances((prev) => {
        const newBalances = { ...prev, ...data }

        // Calculate total
        const walletKey = new Map<string, number>()
        walletsRef.current.forEach((wallet) => {
          const balance = newBalances[wallet.circle_wallet_id]
          if (typeof balance === "string") {
            const numericPart = balance.split(" ")[0].replace(/[$,]/g, "")
            const num = parseFloat(numericPart)
            if (!isNaN(num)) {
              const key = `${wallet.address.toLowerCase()}-${wallet.blockchain}`
              const existing = walletKey.get(key) || 0
              walletKey.set(key, Math.max(existing, num))
            }
          }
        })

        const sum = Array.from(walletKey.values()).reduce((total, bal) => total + bal, 0)
        setWalletTotal(sum)

        return newBalances
      })

      lastWalletFetchRef.current = Date.now()
    } catch (error) {
      console.error("Error fetching wallet balance:", error)
    } finally {
      setIsLoadingWallet(false)
    }
  }, [])

  // Debounced gateway refresh with cooldown
  const debouncedGatewayRefresh = useCallback(() => {
    if (gatewayDebounceRef.current) {
      clearTimeout(gatewayDebounceRef.current)
    }

    const timeSinceLastFetch = Date.now() - lastGatewayFetchRef.current
    const delay = timeSinceLastFetch < FETCH_COOLDOWN
      ? Math.max(DEBOUNCE_DELAY, FETCH_COOLDOWN - timeSinceLastFetch)
      : DEBOUNCE_DELAY

    gatewayDebounceRef.current = setTimeout(() => {
      fetchGatewayBalance(walletsRef.current)
    }, delay)
  }, [fetchGatewayBalance])

  // Debounced wallet refresh with cooldown
  const debouncedWalletRefresh = useCallback(() => {
    if (walletDebounceRef.current) {
      clearTimeout(walletDebounceRef.current)
    }

    const timeSinceLastFetch = Date.now() - lastWalletFetchRef.current
    const delay = timeSinceLastFetch < FETCH_COOLDOWN
      ? Math.max(DEBOUNCE_DELAY, FETCH_COOLDOWN - timeSinceLastFetch)
      : DEBOUNCE_DELAY

    walletDebounceRef.current = setTimeout(() => {
      fetchWalletBalance(walletsRef.current)
    }, delay)
  }, [fetchWalletBalance])

  // Manual refresh functions (immediate, bypasses debounce)
  const refreshGatewayBalance = useCallback(async () => {
    await fetchGatewayBalance(walletsRef.current)
  }, [fetchGatewayBalance])

  const refreshWalletBalance = useCallback(async () => {
    await fetchWalletBalance(walletsRef.current)
  }, [fetchWalletBalance])

  // Single Realtime subscription for the entire app
  useEffect(() => {
    let channel: RealtimeChannel | null = null

    const setupData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        // Fetch initial wallets
        const { data: walletsData, error } = await supabase
          .from("wallets")
          .select("id, address, circle_wallet_id, blockchain")
          .eq("user_id", user.id)

        if (error) throw error

        const initialWallets = (walletsData || []) as Wallet[]
        setWallets(initialWallets)
        walletsRef.current = initialWallets

        // Fetch initial balances
        await Promise.all([
          fetchGatewayBalance(initialWallets),
          fetchWalletBalance(initialWallets),
        ])

        // Single Realtime subscription
        channel = supabase
          .channel("balance-context-realtime")
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "wallets",
              filter: `user_id=eq.${user.id}`,
            },
            (payload) => {
              if (payload.eventType === "INSERT") {
                const newWallet = payload.new as Wallet
                setWallets((prev) => {
                  const updated = [newWallet, ...prev]
                  walletsRef.current = updated
                  // Immediate fetch for new wallet (user expects to see it)
                  fetchWalletBalance([newWallet])
                  // Debounced gateway refresh
                  const isNewAddress = !prev.some(
                    (w) => w.address.toLowerCase() === newWallet.address.toLowerCase()
                  )
                  if (isNewAddress) {
                    debouncedGatewayRefresh()
                  }
                  return updated
                })
              } else if (payload.eventType === "DELETE") {
                setWallets((prev) => {
                  const updated = prev.filter((w) => w.id !== payload.old.id)
                  walletsRef.current = updated
                  if (updated.length === 0) {
                    setGatewayTotal(0)
                    setWalletTotal(0)
                  }
                  return updated
                })
              } else if (payload.eventType === "UPDATE") {
                setWallets((prev) => {
                  const updated = prev.map((w) =>
                    w.id === payload.new.id ? (payload.new as Wallet) : w
                  )
                  walletsRef.current = updated
                  return updated
                })
              }
            }
          )
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "transactions",
              filter: `user_id=eq.${user.id}`,
            },
            (payload) => {
              const updatedTx = payload.new as Transaction

              // Only process COMPLETE status (terminal state)
              if (updatedTx.status !== "COMPLETE") return

              // Skip if we've already processed this transaction
              if (processedTxRef.current.has(updatedTx.id)) return
              processedTxRef.current.add(updatedTx.id)

              // Clean up old processed IDs (keep last 100)
              if (processedTxRef.current.size > 100) {
                const ids = Array.from(processedTxRef.current)
                processedTxRef.current = new Set(ids.slice(-50))
              }

              // Check if transaction involves our wallets
              const isRelevant = walletsRef.current.some(
                (w) =>
                  w.address.toLowerCase() === updatedTx.sender_address.toLowerCase() ||
                  w.address.toLowerCase() === updatedTx.recipient_address.toLowerCase()
              )

              if (isRelevant) {
                debouncedWalletRefresh()
                debouncedGatewayRefresh()
              }
            }
          )
          .subscribe()
      } catch (error) {
        console.error("Error setting up balance context:", error)
        setIsLoadingGateway(false)
        setIsLoadingWallet(false)
      }
    }

    setupData()

    return () => {
      if (channel) {
        supabase.removeChannel(channel)
      }
      if (gatewayDebounceRef.current) {
        clearTimeout(gatewayDebounceRef.current)
      }
      if (walletDebounceRef.current) {
        clearTimeout(walletDebounceRef.current)
      }
    }
  }, [supabase, fetchGatewayBalance, fetchWalletBalance, debouncedGatewayRefresh, debouncedWalletRefresh])

  return (
    <BalanceContext.Provider
      value={{
        chainBalances,
        gatewayTotal,
        walletBalances,
        walletTotal,
        isLoadingGateway,
        isLoadingWallet,
        wallets,
        refreshGatewayBalance,
        refreshWalletBalance,
      }}
    >
      {children}
    </BalanceContext.Provider>
  )
}
