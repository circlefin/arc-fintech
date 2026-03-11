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
import {
  IconSearch,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconWallet,
  IconArrowUp,
  IconArrowDown,
  IconArrowsSort,
} from "@tabler/icons-react"
import { format } from "date-fns"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useRouter } from "next/navigation"
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

type Wallet = {
  id: string
  name: string
  address: string
  blockchain: string
  type: "treasury" | "payout" | "customer"
  circle_wallet_id: string
  created_at: string
}

type SortConfig = {
  key: "balance" | "created_at" | null
  direction: "asc" | "desc" | null
}

const ITEMS_PER_PAGE = 10

// --- Helpers ---

function shortenAddress(address: string) {
  if (!address) return ""
  if (address.length < 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function getExplorerUrl(blockchain: string, address: string) {
  const baseUrl = BLOCK_EXPLORERS[blockchain]
  if (!baseUrl) return "#"
  return `${baseUrl}/address/${address}`
}

export default function Page() {
  const router = useRouter()
  const [wallets, setWallets] = React.useState<Wallet[]>([])
  const [balances, setBalances] = React.useState<Record<string, string>>({})
  const [loading, setLoading] = React.useState(true)

  // Filter, Pagination & Sorting State
  const [filter, setFilter] = React.useState("")
  const [currentPage, setCurrentPage] = React.useState(1)
  const [sortConfig, setSortConfig] = React.useState<SortConfig>({
    key: null,
    direction: null,
  })

  const supabase = createClient()

  const fetchBalances = async (currentWallets: Wallet[]) => {
    if (currentWallets.length === 0) return

    const walletIds = currentWallets.map((w) => w.circle_wallet_id)

    try {
      const res = await fetch("/api/wallet/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletIds }),
      })

      if (res.ok) {
        const data = await res.json()
        setBalances((prev) => ({ ...prev, ...data }))
      }
    } catch (error) {
      console.error("Error fetching balances:", error)
    }
  }

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data, error } = await supabase
          .from("wallets")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })

        if (error) throw error

        const initialWallets = data || []
        setWallets(initialWallets)
        setLoading(false)

        // Fetch balances after wallets are loaded
        fetchBalances(initialWallets)
      } catch (error) {
        console.error("Error loading wallets:", error)
        setLoading(false)
      }
    }

    fetchData()
  }, [supabase])

  // --- Sorting Logic ---

  const handleSort = (key: "balance" | "created_at") => {
    setSortConfig((current) => {
      if (current.key === key) {
        if (current.direction === "asc") return { key, direction: "desc" }
        if (current.direction === "desc") return { key: null, direction: null }
      }
      return { key, direction: "asc" }
    })
  }

  const parseBalance = (balanceStr?: string) => {
    if (!balanceStr) return 0
    // Remove '$', commas, and split by space to ignore suffix like " (ETH-SEPOLIA)"
    const numericPart = balanceStr.split(" ")[0].replace(/[$,]/g, "")
    return parseFloat(numericPart) || 0
  }

  const filteredWallets = React.useMemo(() => {
    let result = wallets.filter((wallet) =>
      wallet.name.toLowerCase().includes(filter.toLowerCase())
    )

    if (sortConfig.key && sortConfig.direction) {
      result.sort((a, b) => {
        let valA: number | number = 0
        let valB: number | number = 0

        if (sortConfig.key === "balance") {
          valA = parseBalance(balances[a.circle_wallet_id])
          valB = parseBalance(balances[b.circle_wallet_id])
        } else if (sortConfig.key === "created_at") {
          valA = new Date(a.created_at).getTime()
          valB = new Date(b.created_at).getTime()
        }

        if (valA < valB) return sortConfig.direction === "asc" ? -1 : 1
        if (valA > valB) return sortConfig.direction === "asc" ? 1 : -1
        return 0
      })
    }

    return result
  }, [wallets, filter, sortConfig, balances])

  const totalPages = Math.ceil(filteredWallets.length / ITEMS_PER_PAGE)

  const paginatedWallets = React.useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE
    return filteredWallets.slice(start, start + ITEMS_PER_PAGE)
  }, [filteredWallets, currentPage])

  // Reset to page 1 when filter changes
  React.useEffect(() => {
    setCurrentPage(1)
  }, [filter])

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success("Address copied to clipboard")
  }

  const formatChain = (chain: string) => {
    return chain.replace("-", " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase())
  }

  // Helper to render sort icon
  const SortIcon = ({ columnKey }: { columnKey: "balance" | "created_at" }) => {
    if (sortConfig.key !== columnKey) return <IconArrowsSort className="ml-2 h-4 w-4" />
    if (sortConfig.direction === "asc") return <IconArrowUp className="ml-2 h-4 w-4" />
    return <IconArrowDown className="ml-2 h-4 w-4" />
  }

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <IconSearch className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by wallet name..."
            className="pl-9"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Circle Wallet ID</TableHead>
              <TableHead className="text-right">
                <Button
                  variant="ghost"
                  onClick={() => handleSort("balance")}
                  className="hover:bg-transparent p-0 font-medium"
                >
                  Balance
                  <SortIcon columnKey="balance" />
                </Button>
              </TableHead>
              <TableHead className="text-right">
                <Button
                  variant="ghost"
                  onClick={() => handleSort("created_at")}
                  className="hover:bg-transparent p-0 font-medium"
                >
                  Created At
                  <SortIcon columnKey="created_at" />
                </Button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              // Loading Skeletons
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-5 w-24 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : paginatedWallets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  No wallets found.
                </TableCell>
              </TableRow>
            ) : (
              paginatedWallets.map((wallet) => {
                const balanceString = balances[wallet.circle_wallet_id]
                // Extract just the amount if needed, or display the full string returned by API
                // API returns "$100.00 (CHAIN)" or "$0.00"
                const displayBalance = balanceString ? balanceString.split(' (')[0] : null

                return (
                  <TableRow
                    key={wallet.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/details/wallet/${wallet.id}`)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <div className="flex size-8 items-center justify-center rounded-full bg-muted">
                          <IconWallet className="size-4 text-muted-foreground" />
                        </div>
                        <div className="flex flex-col">
                          <span>{wallet.name}</span>
                          <span className="text-xs text-muted-foreground capitalize">{wallet.type}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {formatChain(wallet.blockchain)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <a
                          href={getExplorerUrl(wallet.blockchain, wallet.address)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-muted-foreground hover:text-primary hover:underline transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {shortenAddress(wallet.address)}
                        </a>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => {
                            e.stopPropagation()
                            copyToClipboard(wallet.address)
                          }}
                        >
                          <IconCopy className="h-3 w-3" />
                          <span className="sr-only">Copy address</span>
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-muted-foreground">
                          {shortenAddress(wallet.circle_wallet_id)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => {
                            e.stopPropagation()
                            copyToClipboard(wallet.circle_wallet_id)
                          }}
                        >
                          <IconCopy className="h-3 w-3" />
                          <span className="sr-only">Copy Circle wallet ID</span>
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {displayBalance ? (
                        displayBalance
                      ) : (
                        <Skeleton className="h-4 w-16 ml-auto" />
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {format(new Date(wallet.created_at), "MMM d, yyyy")}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {!loading && filteredWallets.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredWallets.length)} of {filteredWallets.length} wallets
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <IconChevronLeft className="mr-2 h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
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
