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

import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { sidebarData } from "@/lib/constants/sidebar-data"
import { usePathname } from "next/navigation"
import { useMemo, useState, useEffect } from "react"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { GlobalSearch } from "@/components/global-search"
import { createClient } from "@/lib/supabase/client"

// Types required for GlobalSearch data
type Wallet = {
  id: string
  name: string
  address: string
  blockchain: string
  type: "treasury" | "payout" | "customer"
  circle_wallet_id: string
  created_at: string
}

type Transaction = {
  id: string
  amount: number
  sender_address: string
  recipient_address: string
  created_at: string
  status: "PENDING" | "CONFIRMED" | "COMPLETE" | "FAILED"
  type: "INBOUND" | "OUTBOUND"
  blockchain: "ETH-SEPOLIA" | "BASE-SEPOLIA" | "AVAX-FUJI" | "ARC-TESTNET"
}

export function SiteHeader() {
  const pathname = usePathname()
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const supabase = createClient()

  // Fetch data for Global Search
  useEffect(() => {
    // Only fetch data if we are on the dashboard
    if (pathname !== "/dashboard") return

    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const [walletsResult, transactionsResult] = await Promise.all([
        supabase.from("wallets").select("*").eq("user_id", user.id),
        supabase.from("transactions").select("*").eq("user_id", user.id)
      ])

      if (walletsResult.data) setWallets(walletsResult.data)
      if (transactionsResult.data) setTransactions(transactionsResult.data)
    }

    fetchData()
  }, [supabase, pathname])

  const navTitle = useMemo(() => {
    if (pathname === "/usuarios")
      return "Usuários"

    const navItem = sidebarData.navMain.find(item => item.url === pathname)

    if (!navItem) return ""

    return navItem.title
  }, [pathname])

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium whitespace-nowrap">
          {navTitle}
        </h1>

        {/* Global Search: Only visible on /dashboard */}
        {pathname === "/dashboard" && (
          <div className="ml-auto flex-1 max-w-md">
            <GlobalSearch wallets={wallets} transactions={transactions} />
          </div>
        )}

        {/* ml-auto ensures this stays on the right whether search exists or not */}
        <div className={`flex items-center gap-2 ${pathname !== "/dashboard" ? "ml-auto" : ""}`}>
          <ThemeSwitcher />
        </div>
      </div>
    </header>
  )
}