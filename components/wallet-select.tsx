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
import { createClient } from "@/lib/supabase/client"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { useBalanceContext } from "@/lib/contexts/balance-context"

export type WalletOption = {
  id: string
  address: string
  circle_wallet_id: string
  blockchain: string
  name: string
  type?: string
}

interface WalletSelectProps {
  value?: string
  onValueChange: (value: string) => void
  onSelectWallet?: (wallet: WalletOption) => void
  disabled?: boolean
  placeholder?: string
  chainFilter?: string
  excludeChain?: string
  excludeAddress?: string
  excludeGatewaySigner?: boolean
  excludeArcWallets?: boolean
  minBalance?: number
}

export function WalletSelect({
  value,
  onValueChange,
  onSelectWallet,
  disabled,
  placeholder = "Select a wallet",
  chainFilter,
  excludeChain,
  excludeAddress,
  excludeGatewaySigner = false,
  excludeArcWallets = false,
  minBalance,
}: WalletSelectProps) {
  const [wallets, setWallets] = React.useState<WalletOption[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const supabase = createClient()
  
  // Try to access balance context, handle if it's not available
  let walletBalances: Record<string, string> = {}
  try {
    // eslint-disable-next-line
    const context = useBalanceContext()
    walletBalances = context.walletBalances
  } catch (e) {
    // Ignore error if context is missing
  }

  React.useEffect(() => {
    const fetchWallets = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data, error } = await supabase
          .from("wallets")
          .select("id, address, circle_wallet_id, blockchain, name, type")
          .eq("user_id", user.id)

        if (error) throw error
        setWallets(data || [])
      } catch (error) {
        console.error("Error fetching wallets:", error)
        toast.error("Failed to load wallets")
      } finally {
        setIsLoading(false)
      }
    }

    fetchWallets()
  }, [supabase])

  // Filter wallets based on chain and excluded address, and deduplicate by address
  const displayedWallets = React.useMemo(() => {
    let result = wallets

    if (chainFilter) {
      result = result.filter((w) => w.blockchain === chainFilter)
    }

    if (excludeChain) {
      result = result.filter((w) => w.blockchain !== excludeChain)
    }

    if (excludeAddress) {
      result = result.filter((w) => w.address !== excludeAddress)
    }

    if (excludeGatewaySigner) {
      result = result.filter((w) => w.type !== "gateway_signer")
    }

    if (excludeArcWallets) {
      result = result.filter((w) => w.blockchain !== "ARC-TESTNET")
    }

    if (minBalance !== undefined) {
      result = result.filter((w) => {
        const balanceStr = walletBalances[w.circle_wallet_id]
        if (!balanceStr) return false
        const numericPart = balanceStr.split(" ")[0].replace(/[$,]/g, "")
        const balance = parseFloat(numericPart)
        return !isNaN(balance) && balance > minBalance
      })
    }

    // Deduplicate wallets by address + blockchain combination to prevent duplicate keys
    // Same address on different chains are different wallets, so we need both
    const seen = new Set<string>()
    result = result.filter((wallet) => {
      const key = `${wallet.address.toLowerCase()}-${wallet.blockchain.toLowerCase()}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })

    return result
  }, [wallets, chainFilter, excludeChain, excludeAddress, excludeGatewaySigner, excludeArcWallets, minBalance, walletBalances])

  // Helper to format chain names nicely
  const formatChainName = (chain: string) => {
    return chain
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ")
  }

  return (
    <Select
      value={value}
      onValueChange={(val) => {
        // Pass the full composite value to the parent's onValueChange
        onValueChange(val)
        
        if (onSelectWallet) {
          // Find wallet by the full composite value for accuracy
          const selected = displayedWallets.find((w) => 
            `${w.address}-${w.blockchain}` === val
          )
          if (selected) {
            onSelectWallet(selected)
          }
        }
      }}
      disabled={disabled || isLoading}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={isLoading ? "Loading wallets..." : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {displayedWallets.map((wallet) => (
          <SelectItem 
            key={wallet.id} 
            value={`${wallet.address}-${wallet.blockchain}`}
          >
            <div className="flex items-center justify-between gap-2 w-full">
              <span className="font-mono text-sm">
                {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
              </span>
              <span className="text-muted-foreground text-xs truncate max-w-[200px]">
                {wallet.name} ({formatChainName(wallet.blockchain)})
                {walletBalances[wallet.circle_wallet_id] && ` - ${walletBalances[wallet.circle_wallet_id].split(" ")[0]}`}
              </span>
            </div>
          </SelectItem>
        ))}
        {!isLoading && displayedWallets.length === 0 && (
          <div className="p-2 text-sm text-muted-foreground text-center">
            No available wallets
          </div>
        )}
      </SelectContent>
    </Select>
  )
}
