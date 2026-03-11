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

import { useEffect, useState, useMemo } from "react"
import Link from "next/link"
import {
  IconArrowsLeftRight,
  IconArrowUpRight,
  IconPlus,
  IconWallet,
  IconLoader,
} from "@tabler/icons-react"
import { RealtimeChannel } from "@supabase/supabase-js"

import { AddFundsDialog } from "@/components/add-funds-dialog"
import { NewWalletDialog } from "@/components/new-wallet-dialog"
import { RebalanceButton } from "@/components/rebalance-button"
import { SectionCards } from "@/components/section-cards"
import { SendButton } from "@/components/send-button"
import { TransferDialog } from "@/components/transfer-dialog"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { createClient } from "@/lib/supabase/client"
import { BLOCK_EXPLORERS } from "@/lib/constants/block-explorers"
import { ChartLineInteractive } from "@/components/chart-area-interactive"
import { type ChartConfig } from "@/components/ui/chart"
import { GatewayBalanceDialog } from "@/components/gateway-balance-dialog"
import { DataFreshnessIndicator } from "@/components/data-freshness-indicator"
import { GlobalSearch } from "@/components/global-search"
import { useDateRange } from "@/hooks/use-date-range"
import { ExportButton } from "@/components/export-button"
import { useBalanceContext } from "@/lib/contexts/balance-context"
import { toast } from "sonner"

const GATEWAY_ADDRESS = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"

type Wallet = {
  id: string
  name: string
  address: string
  blockchain: string
  type: "treasury" | "payout" | "customer"
  circle_wallet_id: string
  created_at: string
}

type Transaction = {
  id: string
  amount: number
  sender_address: string
  recipient_address: string
  created_at: string
  status: "PENDING" | "CONFIRMED" | "COMPLETE" | "FAILED"
  type: "INBOUND" | "OUTBOUND"
  blockchain: "ETH-SEPOLIA" | "BASE-SEPOLIA" | "AVAX-FUJI" | "ARC-TESTNET"
}

type ActivityItem = {
  id: string
  type: "wallet_created" | "transfer" | "deposit" | "send"
  title: React.ReactNode
  description: React.ReactNode
  timestamp: string
  icon: React.ElementType
}

function shortenAddress(address: string) {
  if (!address) return ""
  if (address.length < 10) return address
  return `${address.slice(0, 6)}...${address.slice(-5)}`
}

function getExplorerUrl(blockchain: string, address: string) {
  const baseUrl = BLOCK_EXPLORERS[blockchain]
  if (!baseUrl) return "#"
  return `${baseUrl}/address/${address}`
}

function formatDate(dateString: string) {
  if (typeof window === 'undefined') return dateString
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

const transactionsConfig = {
  total: { label: "Transactions", color: "#2563EB" }, // Blue-600
} satisfies ChartConfig

const flowConfig = {
  inflow: { label: "Inflow", color: "#3B82F6" }, // Blue-500
  outflow: { label: "Outflow", color: "#F59E0B" }, // Amber-500
} satisfies ChartConfig

const chainConfig = {
  base: { label: "Base", color: "#0052FF" }, // Base Blue
  eth: { label: "Ethereum", color: "#627EEA" }, // ETH Purple
  avax: { label: "Avalanche", color: "#E84142" }, // Avax Red
  arc: { label: "Arc", color: "#E9A13F" }, // Arc Blockstream Gold
} satisfies ChartConfig

export default function Page() {
  // Get balance data from shared context (single source of truth)
  const {
    walletBalances,
    walletTotal,
    gatewayTotal,
    isLoadingWallet,
    isLoadingGateway,
    wallets: contextWallets,
    refreshGatewayBalance,
    refreshWalletBalance,
  } = useBalanceContext()

  // Local state for data not in context
  const [localWallets, setLocalWallets] = useState<Wallet[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [isCreateWalletOpen, setCreateWalletOpen] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [dateRange] = useDateRange(7)
  const [selectedChains] = useState<string[]>([])
  const [selectedStatuses] = useState<string[]>([])

  // Filter transactions based on date range and other filters
  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      // Date range filter
      const txDate = new Date(tx.created_at)
      if (dateRange.from && txDate < dateRange.from) return false
      if (dateRange.to && txDate > dateRange.to) return false

      // Chain filter
      if (selectedChains.length > 0 && !selectedChains.includes(tx.blockchain)) {
        return false
      }

      // Status filter
      if (selectedStatuses.length > 0 && !selectedStatuses.includes(tx.status)) {
        return false
      }

      return true
    })
  }, [transactions, dateRange, selectedChains, selectedStatuses])

  // Chart Data States
  const [transactionsChartData, setTransactionsChartData] = useState<any[]>([])
  const [flowData, setFlowData] = useState<any[]>([])
  const [chainData, setChainData] = useState<any[]>([])

  const supabase = createClient()

  // Merge context wallets with local wallets (context has basic info, local has full details)
  const wallets = useMemo(() => {
    if (localWallets.length > 0) return localWallets
    // Map context wallets to full wallet type (missing some fields)
    return contextWallets.map(w => ({
      ...w,
      name: "",
      type: "treasury" as const,
      created_at: "",
    }))
  }, [localWallets, contextWallets])

  // 1. Process Real Data for ALL charts
  useEffect(() => {
    // Initialize a map for the last 90 days
    const dataMap = new Map<string, {
      date: string;
      total: number;
      inflow: number;
      outflow: number;
      eth: number;
      base: number;
      avax: number;
      arc: number;
    }>()

    const today = new Date()
    const daysToLookBack = 90

    // Pre-fill dates with 0 values
    for (let i = daysToLookBack - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(today.getDate() - i)
      const dateStr = d.toLocaleDateString('en-CA')

      dataMap.set(dateStr, {
        date: dateStr,
        total: 0,
        inflow: 0,
        outflow: 0,
        eth: 0,
        base: 0,
        avax: 0,
        arc: 0
      })
    }

    // Create a Set of internal wallet addresses for O(1) lookup
    const internalWalletAddresses = new Set(wallets.map(w => (w.address ?? "").toLowerCase()))

    // Aggregate transaction data
    transactions.forEach((tx) => {
      const dateStr = new Date(tx.created_at).toLocaleDateString('en-CA')

      // Only process if within our 90 day window
      if (dataMap.has(dateStr)) {
        const entry = dataMap.get(dateStr)!

        // 1. Total Transactions Count
        entry.total += 1

        // 2. Inflow vs Outflow (Count of Transactions)
        const isGateway = (tx.recipient_address ?? "").toLowerCase() === GATEWAY_ADDRESS.toLowerCase()
        const isSenderInternal = internalWalletAddresses.has((tx.sender_address ?? "").toLowerCase())
        const isRecipientInternal = internalWalletAddresses.has((tx.recipient_address ?? "").toLowerCase())

        if (!isGateway && isSenderInternal && isRecipientInternal) {
          entry.inflow += 1
          entry.outflow += 1
        } else {
          if (tx.type === 'INBOUND') {
            entry.inflow += 1
          } else {
            entry.outflow += 1
          }
        }

        // 3. Chain Distribution
        switch (tx.blockchain) {
          case 'ETH-SEPOLIA': entry.eth += 1; break;
          case 'BASE-SEPOLIA': entry.base += 1; break;
          case 'AVAX-FUJI': entry.avax += 0; break;
          case 'ARC-TESTNET': entry.arc += 1; break;
        }
      }
    })

    // Convert Map to Arrays
    const sortedData = Array.from(dataMap.values()).sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    )

    // This prevents "2025-12-19" (UTC Midnight) from shifting to "Dec 18" (Local Previous Day)
    const formatForChart = (d: any) => ({ ...d, date: `${d.date}T00:00:00` })

    setTransactionsChartData(sortedData.map(d => formatForChart({ date: d.date, total: d.total })))
    setFlowData(sortedData.map(d => formatForChart({ date: d.date, inflow: d.inflow, outflow: d.outflow })))
    setChainData(sortedData.map(d => formatForChart({ date: d.date, eth: d.eth, base: d.base, avax: d.avax, arc: d.arc })))
  }, [transactions, wallets])

  // Fetch transactions and wallet details (for activity feed and charts)
  // Balance fetching is handled by the shared context
  useEffect(() => {
    let channel: RealtimeChannel | null = null

    const setupData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        // Fetch wallets with full details (for activity feed)
        const { data: walletsData, error: walletsError } = await supabase
          .from("wallets")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })

        if (walletsError) throw walletsError

        const { data: transactionsData, error: transactionsError } = await supabase
          .from("transactions")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })

        if (transactionsError) throw transactionsError

        setLocalWallets(walletsData || [])
        setTransactions(transactionsData || [])
        if (typeof window !== 'undefined') {
          setLastUpdated(new Date())
        }
        setLoading(false)

        // Subscribe to wallet changes (for activity feed updates)
        channel = supabase
          .channel("dashboard-activity-realtime")
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
                setLocalWallets((prev) => {
                  if (prev.some((w) => w.id === newWallet.id)) return prev
                  return [newWallet, ...prev]
                })
              } else if (payload.eventType === "DELETE") {
                setLocalWallets((prev) => prev.filter((w) => w.id !== payload.old.id))
              } else if (payload.eventType === "UPDATE") {
                setLocalWallets((prev) =>
                  prev.map((w) => (w.id === payload.new.id ? (payload.new as Wallet) : w))
                )
              }
              setLastUpdated(new Date())
            }
          )
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "transactions",
              filter: `user_id=eq.${user.id}`,
            },
            (payload) => {
              // Only handle transaction list updates (for activity feed)
              // Balance updates are handled by the shared context
              if (payload.eventType === "INSERT") {
                const newTx = payload.new as Transaction
                setTransactions((prev) => {
                  if (prev.some((tx) => tx.id === newTx.id)) return prev
                  return [newTx, ...prev]
                })
              } else if (payload.eventType === "UPDATE") {
                const updatedTx = payload.new as Transaction
                setTransactions((prev) =>
                  prev.map((tx) => (tx.id === updatedTx.id ? updatedTx : tx))
                )
              }
              setLastUpdated(new Date())
            }
          )
          .subscribe()

      } catch (error) {
        console.error("Error setting up dashboard:", error)
        toast.error("Failed to load dashboard data")
        setLoading(false)
      }
    }

    setupData()

    return () => {
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [supabase])

  const activityFeed = useMemo(() => {
    const walletActivities: ActivityItem[] = localWallets.map((wallet) => ({
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
          {wallet.name} <span className="text-muted-foreground">({wallet.blockchain})</span>
        </span>
      ),
    }))

    const transactionActivities: ActivityItem[] = transactions.map((tx) => {
      const isDeposit = (tx.recipient_address ?? "").toLowerCase() === GATEWAY_ADDRESS.toLowerCase()

      if (isDeposit) {
        const senderWallet = localWallets.find(
          (w) => (w.address ?? "").toLowerCase() === (tx.sender_address ?? "").toLowerCase()
        )
        const blockchain = senderWallet?.blockchain

        return {
          id: `tx-${tx.id}`,
          type: "deposit",
          title: (
            <span>
              ${(tx.amount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                <span className="font-mono">{shortenAddress(tx.sender_address)}</span>
              )}
              {" "}→ Gateway Balance
            </>
          ),
        }
      }

      return {
        id: `tx-${tx.id}`,
        type: "transfer",
        title: (
          <span>
            ${(tx.amount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        ),
        timestamp: tx.created_at,
        icon: IconArrowsLeftRight,
        description: (
          <span>
            {shortenAddress(tx.sender_address)} → {shortenAddress(tx.recipient_address)}
          </span>
        ),
      }
    })

    return [...walletActivities, ...transactionActivities].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
  }, [localWallets, transactions])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      // Re-fetch data
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const [_, __, { data: walletsData }, { data: transactionsData }] = await Promise.all([
        refreshGatewayBalance(),
        refreshWalletBalance(),
        supabase.from("wallets").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
        supabase.from("transactions").select("*").eq("user_id", user.id).order("created_at", { ascending: false })
      ])

      setLocalWallets(walletsData || [])
      setTransactions(transactionsData || [])
      setLastUpdated(new Date())
      toast.success("Data refreshed successfully")
    } catch (error) {
      console.error("Error refreshing data:", error)
      toast.error("Failed to refresh data")
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <div className="flex flex-col p-4 md:p-6">
      <NewWalletDialog
        open={isCreateWalletOpen}
        onOpenChange={setCreateWalletOpen}
      />

      {/* Header */}
      <div className="flex flex-col mb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="scroll-m-20 text-3xl tracking-tight flex items-center">
              <span className="mr-2">Balance</span>
              {!isLoadingWallet ? (
                `$${walletTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              ) : (
                <Skeleton className="h-6 w-20" />
              )}
            </h3>
            <div className="text-muted-foreground flex items-center gap-2 text-lg">
              <span>Gateway Balance</span>
              {!isLoadingGateway ? (
                <>
                  <span>
                    ${gatewayTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <GatewayBalanceDialog />
                </>
              ) : (
                <Skeleton className="h-4 w-11" />
              )}
            </div>
          </div>
          <DataFreshnessIndicator
            lastUpdated={lastUpdated}
            isRefreshing={isRefreshing}
            onRefresh={handleRefresh}
          />
        </div>
      </div>



      {/* Actions */}
      <div className="flex flex-wrap gap-3 mb-4 md:mb-6">
        <TransferDialog />
        <SendButton />
        <RebalanceButton />
        <AddFundsDialog />
        <Button variant="outline" onClick={() => setCreateWalletOpen(true)}>
          <IconWallet className="mr-2 size-4" />
          New wallet
        </Button>
      </div>

      <SectionCards />

      <Tabs defaultValue="transactions" className="mt-4 md:mt-6 space-y-4">
        <TabsList>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="inflows-vs-outflows">Inflows vs Outflows</TabsTrigger>
          <TabsTrigger value="chain-distribution">Chain Distribution</TabsTrigger>
        </TabsList>

        <TabsContent value="transactions" className="space-y-4">
          <ChartLineInteractive
            title="Transaction Volume"
            description="Total transactions over time"
            data={transactionsChartData}
            config={transactionsConfig}
          />
        </TabsContent>

        <TabsContent value="inflows-vs-outflows" className="space-y-4">
          <ChartLineInteractive
            title="Transaction Flow Volume"
            description="Count of Inbound vs Outbound Transactions"
            data={flowData}
            config={flowConfig}
          />
        </TabsContent>

        <TabsContent value="chain-distribution" className="space-y-4">
          <ChartLineInteractive
            title="Chain Activity"
            description="Transaction volume distribution by blockchain"
            data={chainData}
            config={chainConfig}
          />
        </TabsContent>
      </Tabs>

      {/* Activity & Wallets Lists */}
      <div className="grid gap-8 lg:grid-cols-2 mt-4 md:mt-6">
        {/* Activity Column */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Activity</h2>
            <div className="flex items-center gap-2">
              <ExportButton
                data={filteredTransactions}
                filename="transactions"
                type="transactions"
                className="h-8"
              />
              <Button variant="ghost" className="text-muted-foreground hover:text-foreground h-auto text-sm font-normal hover:bg-transparent">
                <Link href="/dashboard/activity">
                  View all
                </Link>
                <IconArrowUpRight className="ml-1 size-4" />
              </Button>
            </div>
          </div>

          <Separator className="mb-6" />

          <div className="space-y-6">
            {loading ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <IconLoader className="animate-spin" />
              </div>
            ) : activityFeed.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
                <div className="bg-muted flex size-12 items-center justify-center rounded-full">
                  <IconArrowsLeftRight className="text-muted-foreground size-6" />
                </div>
                <h3 className="text-sm font-medium">No activity yet</h3>
                <p className="text-muted-foreground text-xs">
                  Create a wallet and make your first transaction to see activity.
                </p>
              </div>
            ) : (
              activityFeed.slice(0, 5).map((item) => (
                <div key={item.id} className="flex items-start gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
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
              ))
            )}
          </div>
        </div>

        {/* Wallets Column */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Wallets</h2>
            <div className="flex items-center gap-2">
              <ExportButton
                data={localWallets}
                filename="wallets"
                type="wallets"
                className="h-8"
              />
              <Button variant="ghost" className="text-muted-foreground hover:text-foreground h-auto text-sm font-normal hover:bg-transparent">
                <Link href="/dashboard/wallets">
                  View all
                </Link>
                <IconArrowUpRight className="ml-1 size-4" />
              </Button>
            </div>
          </div>

          <Separator className="mb-6" />

          <div className="space-y-6">
            {loading ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <IconLoader className="animate-spin" />
              </div>
            ) : localWallets.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
                <div className="bg-muted flex size-12 items-center justify-center rounded-full">
                  <IconWallet className="text-muted-foreground size-6" />
                </div>
                <h3 className="text-sm font-medium">No wallets created</h3>
                <p className="text-muted-foreground text-xs">
                  Create your first developer-controlled wallet to get started.
                </p>
                <div className="mt-2">
                  <Button size="sm" onClick={() => setCreateWalletOpen(true)}>
                    Create Wallet
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {localWallets.slice(0, 5).map((wallet) => {
                  const balance = walletBalances[wallet.circle_wallet_id]

                  return (
                    <div key={wallet.id} className="flex items-start gap-4">
                      <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg border border-transparent">
                        <IconWallet className="size-4" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium leading-none">
                          {wallet.name}{" "}
                          <a
                            href={getExplorerUrl(wallet.blockchain, wallet.address)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground font-mono text-xs hover:text-primary hover:underline transition-colors"
                          >
                            {shortenAddress(wallet.address)}
                          </a>
                        </p>
                        {/* Display Skeleton if balance is undefined, otherwise display balance */}
                        {balance !== undefined ? (
                          <p className="text-muted-foreground text-xs">
                            {balance}
                          </p>
                        ) : (
                          <Skeleton className="h-3 w-10 rounded-sm mt-1" />
                        )}
                      </div>
                    </div>
                  )
                })}

                <Button
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground h-auto text-sm font-normal hover:bg-transparent"
                  onClick={() => setCreateWalletOpen(true)}
                >
                  <IconPlus className="mr-2 size-4" />
                  Create new wallet
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
