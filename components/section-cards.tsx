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

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useBalanceContext } from "@/lib/contexts/balance-context"

// Configuration for the cards we want to display
const CHAIN_CONFIG = [
  { key: "arcTestnet", label: "Arc Testnet Balance" },
  { key: "baseSepolia", label: "Base Sepolia Balance" },
  { key: "avalancheFuji", label: "Avalanche Fuji Balance" },
  { key: "ethSepolia", label: "Ethereum Sepolia Balance" },
] as const

export function SectionCards() {
  const { chainBalances, isLoadingGateway } = useBalanceContext()

  return (
    <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      {CHAIN_CONFIG.map((chain) => (
        <Card key={chain.key} className="@container/card">
          <CardHeader>
            <CardDescription>{chain.label}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {isLoadingGateway ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                `$${(chainBalances[chain.key] || 0).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`
              )}
            </CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}
