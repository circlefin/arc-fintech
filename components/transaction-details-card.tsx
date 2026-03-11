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
  IconArrowLeft,
  IconArrowUp,
  IconArrowDown,
  IconCalendar,
  IconExternalLink,
  IconRefresh,
} from "@tabler/icons-react"
import { toast } from "sonner"
import { BLOCK_EXPLORERS } from "@/lib/constants/block-explorers"
import { TransactionDetails, shortenAddress, formatDate, formatAmount } from "@/lib/utils/data-formatters"

export function TransactionDetailsCard({ transaction }: { transaction: TransactionDetails }) {
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied to clipboard`)
    } catch (error) {
      toast.error("Failed to copy to clipboard")
    }
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      "PENDING": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
      "CONFIRMED": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
      "COMPLETE": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      "FAILED": "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    }
    return colors[status] || "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400"
  }

  const getDirectionIcon = (type: string) => {
    return type === "INBOUND" ? (
      <IconArrowDown className="h-4 w-4 text-green-600 dark:text-green-400" />
    ) : (
      <IconArrowUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
    )
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
          <div>
            <CardTitle className="text-xl">Transaction Details</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {transaction.blockchain} • {transaction.type}
            </p>
          </div>
          <Badge className={getStatusColor(transaction.status)}>
            {transaction.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Amount */}
        <div className="text-center p-6 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20 rounded-lg border dark:border-border">
          <div className="text-3xl font-bold text-foreground">
            {formatAmount(transaction.amount)}
          </div>
          <div className="flex items-center justify-center gap-2 mt-2">
            {getDirectionIcon(transaction.type)}
            <span className="text-sm font-medium">
              {transaction.type === "INBOUND" ? "Received" : "Sent"}
            </span>
          </div>
        </div>

        {/* Transaction Details */}
        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-lg font-medium">Transaction Information</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Property</TableHead>
                  <TableHead>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium text-muted-foreground">Transaction ID</TableCell>
                  <TableCell className="font-mono text-sm">{transaction.id}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium text-muted-foreground">Amount</TableCell>
                  <TableCell className="font-mono text-sm font-semibold">
                    {formatAmount(transaction.amount)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium text-muted-foreground">Type</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getDirectionIcon(transaction.type)}
                      <span className="font-medium">{transaction.type}</span>
                    </div>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium text-muted-foreground">Status</TableCell>
                  <TableCell>
                    <Badge className={getStatusColor(transaction.status)}>
                      {transaction.status}
                    </Badge>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium text-muted-foreground">Blockchain</TableCell>
                  <TableCell>
                    <Badge variant="outline">{transaction.blockchain}</Badge>
                  </TableCell>
                </TableRow>
                {transaction.tx_hash && (
                  <TableRow>
                    <TableCell className="font-medium text-muted-foreground">Transaction Hash</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="font-mono text-sm flex-1">
                          {transaction.tx_hash}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(transaction.tx_hash || "", "Transaction hash")}
                        >
                          <IconCopy className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <Separator />

          {/* Addresses */}
          <div className="space-y-2">
            <h3 className="text-lg font-medium">Addresses</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Type</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium text-muted-foreground">From</TableCell>
                  <TableCell>
                    <code className="font-mono text-sm">
                      {shortenAddress(transaction.sender_address)}
                    </code>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(transaction.sender_address || "", "Sender address")}
                      >
                        <IconCopy className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => window.open(getExplorerUrl(transaction.blockchain, transaction.sender_address), "_blank")}
                      >
                        <IconExternalLink className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {transaction.recipient_address && (
                  <TableRow>
                    <TableCell className="font-medium text-muted-foreground">To</TableCell>
                    <TableCell>
                      <code className="font-mono text-sm">
                        {shortenAddress(transaction.recipient_address)}
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(transaction.recipient_address || "", "Recipient address")}
                        >
                          <IconCopy className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.open(getExplorerUrl(transaction.blockchain, transaction.recipient_address || ""), "_blank")}
                        >
                          <IconExternalLink className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <Separator />

          {/* Timeline */}
          <div className="space-y-2">
            <h3 className="text-lg font-medium">Timeline</h3>
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <IconCalendar className="h-5 w-5 text-muted-foreground" />
                <div>
                  <div className="font-medium">Created</div>
                  <div className="text-sm text-muted-foreground">
                    {formatDate(transaction.created_at)}
                  </div>
                </div>
              </div>
              {transaction.updated_at && (
                <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                  <IconRefresh className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="font-medium">Updated</div>
                    <div className="text-sm text-muted-foreground">
                      {formatDate(transaction.updated_at)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
