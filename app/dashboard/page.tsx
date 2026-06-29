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

import { useState, useMemo } from "react"
import Link from "next/link"
import {
  IconArrowUpRight,
  IconPlus,
  IconWallet,
  IconLoader,
} from "@tabler/icons-react"

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
import { ChartLineInteractive } from "@/components/chart-line-interactive"
import { type ChartConfig } from "@/components/ui/chart"
import { GatewayBalanceDialog } from "@/components/gateway-balance-dialog"
import { DataFreshnessIndicator } from "@/components/data-freshness-indicator"
import { GlobalSearch } from "@/components/global-search"
import { useDateRange } from "@/hooks/use-date-range"
import { ExportButton } from "@/components/export-button"
import { useBalanceContext } from "@/lib/contexts/balance-context"
import { shortenAddress, getExplorerUrl } from "@/lib/utils/data-formatters"
import { ActivityFeed } from "@/components/dashboard/activity-feed"
import { useDashboardCharts } from "@/components/dashboard/use-dashboard-charts"
import { toast } from "sonner"

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
    gatewayPending,
    isLoadingWallet,
    isLoadingGateway,
    isLoadingData,
    fullWallets,
    transactions: contextTransactions,
    lastUpdated,
    refreshGatewayBalance,
    refreshWalletBalance,
  } = useBalanceContext()

  // The shared context owns wallets + transactions + their realtime channel.
  const localWallets = fullWallets
  const transactions = contextTransactions
  const loading = isLoadingData

  const [isCreateWalletOpen, setCreateWalletOpen] = useState(false)
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

  // Chart datasets are derived in a hook so this page stays focused on layout.
  const { transactionsChartData, flowData, chainData } = useDashboardCharts(
    transactions,
    localWallets
  )

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      // Wallet rows + transactions stream in via the BalanceProvider's
      // Realtime channel — manual refresh just kicks the balance fetchers.
      await Promise.all([refreshGatewayBalance(), refreshWalletBalance()])
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
                  {gatewayPending > 0 ? (
                    <span className="text-amber-600 dark:text-amber-400 text-sm">
                      (+${gatewayPending.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pending)
                    </span>
                  ) : null}
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
            <ActivityFeed
              wallets={localWallets}
              transactions={transactions}
              loading={loading}
              limit={5}
            />
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
