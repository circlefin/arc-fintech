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

import * as React from "react"
import { Suspense } from "react"
import {
  IconSearch,
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
  IconWallet,
  IconArrowUp,
  IconArrowDown,
  IconArrowsSort,
  IconRefresh,
} from "@tabler/icons-react"
import { format } from "date-fns"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { BLOCK_EXPLORERS } from "@/lib/constants/block-explorers"

const GATEWAY_ADDRESS = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"
const ITEMS_PER_PAGE = 10

type ActivityItem = {
  id: string
  type: "wallet_created" | "transfer" | "deposit" | "rebalance"
  title: string
  amount?: number
  blockchain?: string
  address?: string
  secondaryAddress?: string
  txHash?: string
  timestamp: string
}

type SortConfig = {
  key: "amount" | "timestamp" | null
  direction: "asc" | "desc" | null
}

function shortenAddress(address: string) {
  if (!address) return ""
  if (address.length < 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function getExplorerUrl(blockchain: string | undefined, address: string) {
  if (!blockchain) return "#"
  const baseUrl = BLOCK_EXPLORERS[blockchain]
  if (!baseUrl) return "#"
  return `${baseUrl}/address/${address}`
}

function ActivityContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activities, setActivities] = React.useState<ActivityItem[]>([])
  const [loading, setLoading] = React.useState(true)
  

const [filter, setFilter] = React.useState(searchParams.get("search") || "")

React.useEffect(() => {
  const initialSearch = searchParams.get("search")
  if (initialSearch) {
    setFilter(initialSearch)
    const params = new URLSearchParams(searchParams.toString())
    params.delete("search")
    router.replace(`/dashboard/activity?${params.toString()}`)
  }
}, [searchParams, router])
  const [currentPage, setCurrentPage] = React.useState(1)
  const [sortConfig, setSortConfig] = React.useState<SortConfig>({
    key: "timestamp",
    direction: "desc",
  })

  const supabase = createClient()

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

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

        const wallets = walletsData || []
        const transactions = transactionsData || []

        const walletActivities: ActivityItem[] = wallets.map((w: any) => ({
          id: `create-${w.id}`,
          type: "wallet_created",
          title: w.name,
          blockchain: w.blockchain,
          address: w.address,
          timestamp: w.created_at,
        }))

        const transactionActivities: ActivityItem[] = transactions.map((tx: any) => {
          const isDeposit = tx.recipient_address.toLowerCase() === GATEWAY_ADDRESS.toLowerCase()
          
          let type: ActivityItem["type"] = "transfer"
          let title = "Transfer"

          if (tx.type === "REBALANCE") {
            type = "rebalance"
            title = "Rebalance"
          } else if (isDeposit) {
            type = "deposit"
            title = "Gateway Deposit"
          }

          const senderWallet = wallets.find(
            (w: any) => w.address.toLowerCase() === tx.sender_address.toLowerCase()
          )

          return {
            id: `tx-${tx.id}`,
            type,
            title,
            amount: tx.amount,
            blockchain: senderWallet?.blockchain || tx.blockchain,
            address: tx.sender_address,
            secondaryAddress: tx.recipient_address,
            timestamp: tx.created_at,
          }
        })

        setActivities([...walletActivities, ...transactionActivities])
      } catch (error) {
        console.error("Error loading activity:", error)
        toast.error("Failed to load activity history")
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [supabase])

  const handleSort = (key: "amount" | "timestamp") => {
    setSortConfig((current: any) => {
      if (current.key === key) {
        if (current.direction === "asc") return { key, direction: "desc" }
        if (current.direction === "desc") return { key: null, direction: null }
      }
      return { key, direction: "asc" }
    })
  }

  const sortedActivities = React.useMemo(() => {
    let result = activities.filter((item: any) =>
      item.title.toLowerCase().includes(filter.toLowerCase()) ||
      item.address?.toLowerCase().includes(filter.toLowerCase()) ||
      item.secondaryAddress?.toLowerCase().includes(filter.toLowerCase())
    )

    if (sortConfig.key && sortConfig.direction) {
      result.sort((a: any, b: any) => {
        let valA: number | string = 0
        let valB: number | string = 0

        if (sortConfig.key === "amount") {
          valA = a.amount || 0
          valB = b.amount || 0
        } else if (sortConfig.key === "timestamp") {
          valA = new Date(a.timestamp).getTime()
          valB = new Date(b.timestamp).getTime()
        }

        if (valA < valB) return sortConfig.direction === "asc" ? -1 : 1
        if (valA > valB) return sortConfig.direction === "asc" ? 1 : -1
        return 0
      })
    } else {
      result.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    }

    return result
  }, [activities, filter, sortConfig])

  const totalPages = Math.ceil(sortedActivities.length / ITEMS_PER_PAGE)

  const paginatedActivities = React.useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE
    return sortedActivities.slice(start, start + ITEMS_PER_PAGE)
  }, [sortedActivities, currentPage])

  React.useEffect(() => {
    setCurrentPage(1)
  }, [filter])

  const getTypeBadge = (type: ActivityItem["type"]) => {
    switch (type) {
      case "deposit":
        return <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800"><IconPlus className="mr-1 size-3" /> Deposit</Badge>
      case "transfer":
        return <Badge variant="secondary">Transfer</Badge>
      case "rebalance":
        return <Badge variant="outline" className="border-blue-200 text-blue-700 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800"><IconRefresh className="mr-1 size-3" /> Rebalance</Badge>
      case "wallet_created":
        return <Badge variant="outline"><IconWallet className="mr-1 size-3" /> Created</Badge>
    }
  }

  const SortIcon = ({ columnKey }: { columnKey: "amount" | "timestamp" }) => {
    if (sortConfig.key !== columnKey) return <IconArrowsSort className="ml-2 h-4 w-4" />
    if (sortConfig.direction === "asc") return <IconArrowUp className="ml-2 h-4 w-4" />
    return <IconArrowDown className="ml-2 h-4 w-4" />
  }

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <IconSearch className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by address or name..."
            className="pl-9"
            value={filter}
            onChange={(e: any) => setFilter(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead className="text-right">
                <Button
                  variant="ghost"
                  onClick={() => handleSort("amount")}
                  className="hover:bg-transparent p-0 font-medium"
                >
                  Amount
                  <SortIcon columnKey="amount" />
                </Button>
              </TableHead>
              <TableHead className="text-right">
                <Button
                  variant="ghost"
                  onClick={() => handleSort("timestamp")}
                  className="hover:bg-transparent p-0 font-medium"
                >
                  Date
                  <SortIcon columnKey="timestamp" />
                </Button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-6 w-16 ml-auto" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-6 w-32 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : paginatedActivities.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  No activity found.
                </TableCell>
              </TableRow>
            ) : (
              paginatedActivities.map((item: any) => (
                <TableRow
                  key={item.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => {
                    if (item.type === "wallet_created") {
                      const walletId = item.id.replace("create-", "")
                      router.push(`/details/wallet/${walletId}`)
                    } else {
                      const txId = item.id.replace("tx-", "")
                      router.push(`/details/transaction/${txId}`)
                    }
                  }}
                >
                  <TableCell>
                    {getTypeBadge(item.type)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-sm">{item.title}</span>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        {item.type === "wallet_created" ? (
                          <a
                            href={getExplorerUrl(item.blockchain, item.address || "")}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono hover:text-primary hover:underline transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {shortenAddress(item.address || "")}
                          </a>
                        ) : (
                          <>
                            <a
                              href={getExplorerUrl(item.blockchain, item.address || "")}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono hover:text-primary hover:underline transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {shortenAddress(item.address || "")}
                            </a>
                            <span className="mx-1">→</span>
                            {item.secondaryAddress === GATEWAY_ADDRESS ? (
                              <span className="font-mono">Gateway Balance</span>
                            ) : (
                              <a
                                href={getExplorerUrl(item.blockchain, item.secondaryAddress || "")}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono hover:text-primary hover:underline transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {shortenAddress(item.secondaryAddress || "")}
                              </a>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {item.blockchain ? (
                      <Badge variant="outline" className="font-normal text-xs">
                        {item.blockchain}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {item.amount !== undefined ? (
                      <span className={item.type === "deposit" ? "text-green-600 dark:text-green-400" : ""}>
                        {item.type === "deposit" ? "+" : ""}${item.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm">
                    {format(new Date(item.timestamp), "MMM d, yyyy HH:mm")}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!loading && sortedActivities.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, sortedActivities.length)} of {sortedActivities.length} events
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p: any) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <IconChevronLeft className="mr-2 h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p: any) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
              <IconChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="p-4 lg:p-6 flex justify-center"><Skeleton className="h-[400px] w-full" /></div>}>
      <ActivityContent />
    </Suspense>
  )
}
