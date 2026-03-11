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

import { Metadata } from "next"
import { notFound } from "next/navigation"
import React, { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { BackButton } from "@/components/back-button"
import { WalletDetailsCard } from "@/components/wallet-details-card"
import { TransactionDetailsCard } from "@/components/transaction-details-card"
import { formatWalletDetails, formatTransactionDetails } from "@/lib/utils/data-formatters"

async function getDetailsData(type: string, id: string) {
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    notFound()
  }

  let itemData: any

  if (type === "wallet") {
    // Use the ID directly (no prefix to remove)
    const walletId = id

    const { data, error } = await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", user.id)
      .eq("id", walletId)
      .single()

    if (error || !data) {
      notFound()
    }

    itemData = formatWalletDetails(data)
  } else if (type === "transaction") {
    // Remove "tx-" prefix if present (handled for backward compatibility with search results)
    const txId = id.startsWith("tx-") ? id.slice(3) : id

    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", user.id)
      .eq("id", txId)
      .single()

    if (error || !data) {
      notFound()
    }

    itemData = formatTransactionDetails(data)
  } else {
    notFound()
  }

  return { type, itemData }
}

function DetailsContent({ type, itemData }: { type: string; itemData: any }) {
  return (
    <div className="max-w-2xl mx-auto py-6">
      <div className="mb-6">
        <BackButton />
      </div>

      {type === "wallet" ? (
        <WalletDetailsCard wallet={itemData} />
      ) : (
        <TransactionDetailsCard transaction={itemData} />
      )}
    </div>
  )
}

export default async function DetailsPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  return (
    <Suspense fallback={<div className="container mx-auto py-6">Loading...</div>}>
      <AsyncDetailsContent params={params} />
    </Suspense>
  )
}

async function AsyncDetailsContent({ params }: { params: Promise<{ type: string; id: string }> }) {
  try {
    const resolvedParams = await params
    const { type, id } = resolvedParams
    const data = await getDetailsData(type, id)
    return <DetailsContent type={data.type} itemData={data.itemData} />
  } catch (error) {
    console.error("Error loading details:", error)
    notFound()
  }
}

export async function generateMetadata({ params }: { params: Promise<{ type: string; id: string }> }): Promise<Metadata> {
  const { type } = await params

  const titles: Record<string, string> = {
    wallet: "Wallet Details",
    transaction: "Transaction Details"
  }

  const descriptions: Record<string, string> = {
    wallet: "View detailed information about this wallet including address, balance, and transaction history.",
    transaction: "View complete transaction details including amount, addresses, and status."
  }

  return {
    title: titles[type] || "Details",
    description: descriptions[type] || "View detailed information.",
  }
}
