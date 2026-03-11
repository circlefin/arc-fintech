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

import { useState, useEffect } from "react"
import { IconInfoCircle } from "@tabler/icons-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { createClient } from "@/lib/supabase/client"

// Mapping API chain keys to Display labels
const CHAIN_LABELS: Record<string, string> = {
  "ethSepolia": "Ethereum Sepolia",
  "baseSepolia": "Base Sepolia",
  "avalancheFuji": "Avalanche Fuji",
  "arcTestnet": "Arc Testnet",
}

export function GatewayBalanceDialog() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [chainBalances, setChainBalances] = useState<Record<string, number>>({})
  const [totalBalance, setTotalBalance] = useState<number>(0)

  const supabase = createClient()

  useEffect(() => {
    if (open) {
      fetchGatewayBreakdown()
    }
  }, [open])

  const fetchGatewayBreakdown = async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // 1. Get all wallet addresses to query the gateway
      const { data: wallets, error } = await supabase
        .from("wallets")
        .select("address")
        .eq("user_id", user.id)

      if (error || !wallets || wallets.length === 0) {
        setLoading(false)
        return
      }

      const addresses = wallets.map((w) => w.address)

      // 2. Fetch Gateway Balances
      const res = await fetch("/api/gateway/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses }),
      })

      if (!res.ok) throw new Error("Failed to fetch balances")

      const data = await res.json()

      // 3. Aggregate balances by chain
      // Initialize with 0 for supported chains
      const totals: Record<string, number> = {
        "ethSepolia": 0,
        "baseSepolia": 0,
        "avalancheFuji": 0,
        "arcTestnet": 0,
      }

      let grandTotal = 0

      if (data.balances && Array.isArray(data.balances)) {
        data.balances.forEach((walletResult: any) => {
          if (walletResult.gatewayBalances && Array.isArray(walletResult.gatewayBalances)) {
            walletResult.gatewayBalances.forEach((gb: any) => {
              // gb.chain is the API key (e.g., "baseSepolia")
              if (totals[gb.chain] !== undefined) {
                totals[gb.chain] += gb.balance
                grandTotal += gb.balance
              }
            })
          }
        })
      }

      setChainBalances(totals)
      setTotalBalance(grandTotal)

    } catch (error) {
      console.error("Error fetching gateway breakdown:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-foreground rounded-full"
        >
          <IconInfoCircle className="size-4" />
          <span className="sr-only">Gateway Balance Info</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Gateway Balance</DialogTitle>
          <DialogDescription>
            Breakdown of USDC held in Gateway contracts across supported chains.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Total Header */}
          <div className="flex flex-col items-center justify-center p-4 bg-muted/50 rounded-lg">
            <span className="text-sm text-muted-foreground">Total Available</span>
            {loading ? (
              <Skeleton className="h-8 w-32 mt-1" />
            ) : (
              <span className="text-3xl font-bold tracking-tight">
                ${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
          </div>

          <Separator />

          {/* Chain List */}
          <div className="space-y-3">
            {Object.entries(CHAIN_LABELS).map(([apiKey, label]) => {
              const balance = chainBalances[apiKey] || 0

              return (
                <div key={apiKey} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{label}</span>
                  </div>
                  {loading ? (
                    <Skeleton className="h-4 w-16" />
                  ) : (
                    <span className="text-sm font-mono text-muted-foreground">
                      ${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}