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

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  IconCopy,
  IconArrowLeftRight,
  IconArrowUpRight,
  IconArrowDownRight,
  IconCalendar,
  IconWallet,
  IconExternalLink,
  IconRefresh,
} from "@tabler/icons-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { BLOCK_EXPLORERS } from "@/lib/constants/block-explorers"
import { formatWalletDetails, shortenAddress, formatDate, formatAmount } from "@/lib/utils/data-formatters"

// Type definitions
interface WalletDetails {
  id: string
  name: string
  address: string
  blockchain: string
  type: string
  circle_wallet_id: string
  created_at: string
  updated_at?: string
}

export function WalletDetailsCard({ wallet }: { wallet: WalletDetails }) {
  const router = useRouter()

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied to clipboard`)
    } catch (error) {
      toast.error("Failed to copy to clipboard")
    }
  }

  const getBlockchainColor = (blockchain: string) => {
    const colors: Record<string, string> = {
      "ETH-SEPOLIA": "bg-purple-100 text-purple-800",
      "BASE-SEPOLIA": "bg-blue-100 text-blue-800", 
      "AVAX-FUJI": "bg-red-100 text-red-800",
      "ARC-TESTNET": "bg-yellow-100 text-yellow-800",
    }
    return colors[blockchain] || "bg-gray-100 text-gray-800"
  }

  const getExplorerUrl = (blockchain: string, address: string): string => {
    const baseUrl = BLOCK_EXPLORERS[blockchain]
    if (!baseUrl || !address) return "#"
    return `${baseUrl}/address/${address}`
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IconWallet className="h-6 w-6 text-muted-foreground" />
            <div>
              <CardTitle className="text-xl">{wallet.name}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {wallet.blockchain} • {wallet.type.charAt(0).toUpperCase() + wallet.type.slice(1)}
              </p>
            </div>
          </div>
          <Badge className={getBlockchainColor(wallet.blockchain)}>
            {wallet.blockchain}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Address Section */}
        <div className="space-y-2">
          <h3 className="text-lg font-medium">Address</h3>
          <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
            <code className="flex-1 font-mono text-sm">{wallet.address}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(wallet.address, "Address")}
            >
              <IconCopy className="h-4 w-4 mr-1" />
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(getExplorerUrl(wallet.blockchain, wallet.address), "_blank")}
            >
              <IconExternalLink className="h-4 w-4 mr-1" />
              Explorer
            </Button>
          </div>
        </div>

        {/* Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">Information</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Type</span>
                <Badge variant="secondary">{wallet.type}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Network</span>
                <Badge variant="outline">{wallet.blockchain}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Created</span>
                <span className="text-sm">{formatDate(wallet.created_at)}</span>
              </div>
              {wallet.updated_at && (
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Updated</span>
                  <span className="text-sm">{formatDate(wallet.updated_at)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Recent Activity Preview */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">Quick Actions</h3>
            <div className="space-y-2">

              <Button 
                variant="outline" 
                className="w-full justify-start"
                onClick={() => {
                  const searchParams = new URLSearchParams()
                  searchParams.set('search', wallet.address)
                  router.push(`/dashboard/activity?${searchParams.toString()}`)
                }}
              >
                <IconRefresh className="h-4 w-4 mr-2" />
                View All Activity
              </Button>
              <Button variant="outline" className="w-full justify-start">
                <IconArrowUpRight className="h-4 w-4 mr-2" />
                Send Funds (comming soon)
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
