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

import { useState } from "react"
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
import { useBalanceContext } from "@/lib/contexts/balance-context"
import type { ChainBalances } from "@/lib/balances/types"

const CHAIN_LABELS: Record<keyof ChainBalances, string> = {
  ethSepolia: "Ethereum Sepolia",
  baseSepolia: "Base Sepolia",
  avalancheFuji: "Avalanche Fuji",
  arcTestnet: "Arc Testnet",
}

const CHAIN_ORDER: Array<keyof ChainBalances> = [
  "ethSepolia",
  "baseSepolia",
  "avalancheFuji",
  "arcTestnet",
]

const formatUsdc = (n: number) =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

export function GatewayBalanceDialog() {
  const [open, setOpen] = useState(false)
  const {
    gatewayChainBalances,
    gatewayPendingChainBalances,
    gatewayTotal,
    gatewayPending,
    isLoadingGateway,
  } = useBalanceContext()

  const hasAnyPending =
    gatewayPending > 0 ||
    CHAIN_ORDER.some((key) => gatewayPendingChainBalances[key] > 0)

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
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Gateway Balance</DialogTitle>
          <DialogDescription>
            Breakdown of USDC held in Gateway across supported chains. Pending
            shows recent deposits that haven&apos;t yet finalized into the
            confirmed Gateway balance.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="flex flex-col items-center justify-center p-4 bg-muted/50 rounded-lg">
            <span className="text-sm text-muted-foreground">Total Available</span>
            {isLoadingGateway ? (
              <Skeleton className="h-8 w-32 mt-1" />
            ) : (
              <span className="text-3xl font-bold tracking-tight">
                {formatUsdc(gatewayTotal)}
              </span>
            )}
            {!isLoadingGateway && gatewayPending > 0 ? (
              <span className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                +{formatUsdc(gatewayPending)} pending
              </span>
            ) : null}
          </div>

          <Separator />

          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 text-sm items-center">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Chain
            </span>
            <span className="text-xs uppercase tracking-wide text-muted-foreground text-right">
              Confirmed
            </span>
            <span className="text-xs uppercase tracking-wide text-muted-foreground text-right">
              {hasAnyPending ? "Pending" : ""}
            </span>

            {CHAIN_ORDER.map((key) => {
              const confirmed = gatewayChainBalances[key] ?? 0
              const pending = gatewayPendingChainBalances[key] ?? 0
              return (
                <div
                  key={key}
                  className="contents"
                >
                  <span className="font-medium">{CHAIN_LABELS[key]}</span>
                  {isLoadingGateway ? (
                    <Skeleton className="h-4 w-16 justify-self-end" />
                  ) : (
                    <span className="font-mono text-muted-foreground text-right">
                      {formatUsdc(confirmed)}
                    </span>
                  )}
                  {isLoadingGateway ? (
                    <Skeleton className="h-4 w-16 justify-self-end" />
                  ) : (
                    <span
                      className={
                        "font-mono text-right " +
                        (pending > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground/50")
                      }
                    >
                      {pending > 0 ? `+${formatUsdc(pending)}` : "—"}
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
