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
import Link from "next/link"
import { IconSearch, IconX, IconWallet, IconArrowsLeftRight } from "@tabler/icons-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"

interface SearchResult {
  id: string
  type: "wallet" | "transaction"
  title: string
  description: string
  url: string
  metadata?: any
}

interface GlobalSearchProps {
  wallets: any[]
  transactions: any[]
  className?: string
}

export function GlobalSearch({ wallets, transactions, className }: GlobalSearchProps) {
  const [open, setOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [searchResults, setSearchResults] = React.useState<SearchResult[]>([])
  const router = useRouter()
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  const search = React.useCallback((query: string) => {
    if (!query || !query.trim()) {
      setSearchResults([])
      return
    }

    const results: SearchResult[] = []
    const lowerQuery = query.toLowerCase()

    // Search wallets
    wallets.forEach((wallet) => {
      if (
        wallet.name?.toLowerCase().includes(lowerQuery) ||
        (wallet.address && wallet.address.toLowerCase().includes(lowerQuery)) ||
        (wallet.blockchain && wallet.blockchain.toLowerCase().includes(lowerQuery))
      ) {
        results.push({
          id: `wallet-${wallet.id}`,
          type: "wallet",
          title: wallet.name || "Unnamed Wallet",
          description: `${wallet.address?.slice(0, 8)}...${wallet.address?.slice(-6)} • ${wallet.blockchain || 'Unknown'}`,
          url: `/details/wallet/${wallet.id}`,
          metadata: wallet
        })
      }
    })

    // Search transactions
    transactions.forEach((tx) => {
      if (
        (tx.amount && tx.amount.toString().includes(lowerQuery)) ||
        (tx.sender_address && tx.sender_address.toLowerCase().includes(lowerQuery)) ||
        (tx.recipient_address && tx.recipient_address.toLowerCase().includes(lowerQuery)) ||
        (tx.blockchain && tx.blockchain.toLowerCase().includes(lowerQuery)) ||
        (tx.status && tx.status.toLowerCase().includes(lowerQuery)) ||
        (tx.tx_hash && tx.tx_hash.toLowerCase().includes(lowerQuery))
      ) {
        results.push({
          id: `tx-${tx.id}`,
          type: "transaction",
          title: `$${tx.amount?.toLocaleString() || '0'}`,
          description: `From: ${tx.sender_address?.slice(0, 6)}...${tx.sender_address?.slice(-4)} • ${tx.blockchain || 'Unknown'} • ${tx.status || 'Unknown'}`,
          url: `/details/transaction/${tx.id}`,
          metadata: tx
        })
      }
    })

    setSearchResults(results.slice(0, 6))
  }, [wallets, transactions])

  React.useEffect(() => {
    search(searchQuery)
  }, [searchQuery, search])

  const handleSelect = React.useCallback((result: SearchResult, event?: React.MouseEvent) => {
    // Prevent event propagation and handle navigation
    if (event) {
      event.preventDefault()
      event.stopPropagation()
    }

    setOpen(false)
    setSearchQuery("")

    // Navigate immediately
    if (result.url) {
      router.push(result.url)
    }
  }, [router])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      setSearchQuery("")
    }
    if (e.key === 'Enter' && searchResults.length > 0) {
      handleSelect(searchResults[0])
    }
  }, [searchResults, handleSelect])

  const handleClear = React.useCallback(() => {
    setSearchQuery("")
    setOpen(false)
    setSearchResults([])
  }, [])

  const getIcon = (type: string) => {
    switch (type) {
      case "wallet":
        return <IconWallet className="mr-2 h-4 w-4" />
      case "transaction":
        return <IconArrowsLeftRight className="mr-2 h-4 w-4" />
      default:
        return null
    }
  }

  return (
    <div ref={containerRef} className={cn("relative max-w-md", className)}>
      <div className="relative">
        <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search wallets, transactions, amounts, or addresses"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value)
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          className="pl-10 pr-10"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 p-0"
            onClick={handleClear}
          >
            <IconX className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Search Results - Simple Dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 min-w-[350px] max-h-[400px] bg-background border rounded-lg shadow-xl p-0">
          {searchResults.length === 0 ? (
            <div className="py-6 px-4 text-center">
              <IconSearch className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">
                {searchQuery ? "No results found." : "Start typing to search wallets, transactions, amounts, or addresses"}
              </p>
            </div>
          ) : (
            <div className="py-2">
              {/* Wallets */}
              {searchResults.some(r => r.type === "wallet") && (
                <div className="mb-4">
                  <h3 className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Wallets
                  </h3>
                  <div className="px-2">
                    {searchResults
                      .filter(r => r.type === "wallet")
                      .map((result) => (
                        <Link
                          key={result.id}
                          href={result.url}
                          onClick={() => {
                            setOpen(false)
                            setSearchQuery("")
                          }}
                          className="flex items-center gap-2 px-3 py-2 text-left hover:bg-accent transition-colors cursor-pointer rounded-md border-b border-transparent hover:border-border"
                        >
                          {getIcon(result.type)}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{result.title}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {result.description}
                            </div>
                          </div>
                          <Badge variant="secondary" className="text-xs flex-shrink-0">
                            Wallet
                          </Badge>
                        </Link>
                      ))}
                  </div>
                </div>
              )}

              {/* Transactions */}
              {searchResults.some(r => r.type === "transaction") && (
                <div className="mb-2">
                  <h3 className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Transactions
                  </h3>
                  <div className="px-2">
                    {searchResults
                      .filter(r => r.type === "transaction")
                      .map((result) => (
                        <Link
                          key={result.id}
                          href={result.url}
                          onClick={() => {
                            setOpen(false)
                            setSearchQuery("")
                          }}
                          className="flex items-center gap-2 px-3 py-2 text-left hover:bg-accent transition-colors cursor-pointer rounded-md border-b border-transparent hover:border-border"
                        >
                          {getIcon(result.type)}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{result.title}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {result.description}
                            </div>
                          </div>
                          <Badge variant="secondary" className="text-xs flex-shrink-0">
                            Transaction
                          </Badge>
                        </Link>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
