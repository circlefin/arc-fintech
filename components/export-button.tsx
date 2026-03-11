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
import { IconDownload, IconFileCv, IconFileText } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "sonner"

interface ExportButtonProps {
  data: any[]
  filename: string
  type: "transactions" | "wallets"
  className?: string
}

export function ExportButton({ data, filename, type, className }: ExportButtonProps) {
  const formatTimestamp = (dateString: string) => {
    return new Date(dateString).toISOString()
  }

  const shortenAddress = (address: string) => {
    if (!address) return ""
    if (address.length < 10) return address
    return `${address.slice(0, 6)}...${address.slice(-5)}`
  }

  const prepareDataForExport = () => {
    if (type === "transactions") {
      return data.map(tx => ({
        ID: tx.id,
        Amount: tx.amount || 0,
        Currency: "USD",
        Sender: shortenAddress(tx.sender_address || ""),
        Recipient: shortenAddress(tx.recipient_address || ""),
        Status: tx.status || "",
        Type: tx.type || "",
        Blockchain: tx.blockchain || "",
        "Transaction Hash": tx.tx_hash || "",
        "Created At": formatTimestamp(tx.created_at),
        "Updated At": formatTimestamp(tx.updated_at),
      }))
    } else {
      return data.map(wallet => ({
        ID: wallet.id,
        Name: wallet.name || "",
        Address: wallet.address || "",
        "Short Address": shortenAddress(wallet.address || ""),
        Type: wallet.type || "",
        Blockchain: wallet.blockchain || "",
        "Circle Wallet ID": wallet.circle_wallet_id || "",
        "Created At": formatTimestamp(wallet.created_at),
        "Updated At": formatTimestamp(wallet.updated_at),
      }))
    }
  }

  const exportToCSV = () => {
    try {
      const exportData = prepareDataForExport()
      
      if (exportData.length === 0) {
        toast.error("No data to export")
        return
      }

      const headers = Object.keys(exportData[0])
      const csvContent = [
        headers.join(','),
        ...exportData.map(row => 
          headers.map(header => {
            const value = row[header as keyof typeof row]
            // Escape quotes and wrap in quotes if contains comma or quote
            const stringValue = String(value || '').replace(/"/g, '""')
            return stringValue.includes(',') || stringValue.includes('"') 
              ? `"${stringValue}"` 
              : stringValue
          }).join(',')
        )
      ].join('\n')

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      
      link.setAttribute('href', url)
      link.setAttribute('download', `${filename}-${new Date().toISOString().split('T')[0]}.csv`)
      link.style.visibility = 'hidden'
      
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      
      toast.success(`Exported ${exportData.length} records to CSV`)
    } catch (error) {
      console.error('Export error:', error)
      toast.error("Failed to export data")
    }
  }

  const exportToJSON = () => {
    try {
      const exportData = prepareDataForExport()
      
      if (exportData.length === 0) {
        toast.error("No data to export")
        return
      }

      const jsonContent = JSON.stringify(exportData, null, 2)
      const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' })
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      
      link.setAttribute('href', url)
      link.setAttribute('download', `${filename}-${new Date().toISOString().split('T')[0]}.json`)
      link.style.visibility = 'hidden'
      
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      
      toast.success(`Exported ${exportData.length} records to JSON`)
    } catch (error) {
      console.error('Export error:', error)
      toast.error("Failed to export data")
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={className}>
          <IconDownload className="mr-2 h-4 w-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={exportToCSV}>
          <IconFileCv className="mr-2 h-4 w-4" />
          Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportToJSON}>
          <IconFileText className="mr-2 h-4 w-4" />
          Export as JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Utility function for bulk export operations
export function exportMultipleData(
  datasets: { data: any[]; filename: string; type: "transactions" | "wallets" }[]
) {
  datasets.forEach(({ data, filename, type }) => {
    const exportButton = { data, filename, type }
    // Use the export logic from ExportButton
    if (data.length > 0) {
      const headers = Object.keys(data[0])
      const csvContent = [
        headers.join(','),
        ...data.map(row => 
          headers.map(header => {
            const value = row[header as keyof typeof row]
            const stringValue = String(value || '').replace(/"/g, '""')
            return stringValue.includes(',') || stringValue.includes('"') 
              ? `"${stringValue}"` 
              : stringValue
          }).join(',')
        )
      ].join('\n')

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      
      link.setAttribute('href', url)
      link.setAttribute('download', `${filename}-${new Date().toISOString().split('T')[0]}.csv`)
      link.style.visibility = 'hidden'
      
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  })
}