/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

"use client"

import { useEffect, useState } from "react"
import type { WalletOption } from "@/components/wallet-select"

export type BridgeFeeEstimate = {
  transferSpeed: "FAST" | "SLOW" | "INSTANT"
  protocolFees: string
  hasGasFees: boolean
  estimatedTime: string
  available?: boolean
  errorMessage?: string
  gasFeesInfo?: Array<{ chain: string; token: string; amount: string }>
}

export type BridgeFeeEstimateState = {
  slow: BridgeFeeEstimate | null
  fast: BridgeFeeEstimate | null
  gateway: BridgeFeeEstimate | null
  recommendation: "FAST" | "SLOW" | "INSTANT" | null
  isTestnet?: boolean
  gatewayAvailable?: boolean
}

const EMPTY: BridgeFeeEstimateState = {
  slow: null,
  fast: null,
  gateway: null,
  recommendation: null,
  isTestnet: false,
  gatewayAvailable: false,
}

type Args = {
  sourceWallet: WalletOption | null
  destinationWallet: WalletOption | null
  amount: string
  onRecommendation?: (
    recommendation: "FAST" | "SLOW" | "INSTANT",
    estimates: { slow: BridgeFeeEstimate; fast: BridgeFeeEstimate }
  ) => void
}

/**
 * Debounced fee-estimate fetcher for bridge rebalances. Lifts ~60 lines of
 * useEffect + fetch logic out of the dialog so the dialog stays focused on
 * orchestration and presentation.
 */
export function useBridgeFeeEstimates({
  sourceWallet,
  destinationWallet,
  amount,
  onRecommendation,
}: Args) {
  const [feeEstimates, setFeeEstimates] = useState<BridgeFeeEstimateState>(EMPTY)
  const [isEstimating, setIsEstimating] = useState(false)

  useEffect(() => {
    if (
      !sourceWallet ||
      !destinationWallet ||
      !amount ||
      parseFloat(amount) <= 0
    ) {
      setFeeEstimates(EMPTY)
      return
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      setIsEstimating(true)
      try {
        const response = await fetch("/api/bridge/estimate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceWalletId: sourceWallet.circle_wallet_id,
            sourceChain: sourceWallet.blockchain,
            destinationWalletId: destinationWallet.circle_wallet_id,
            destinationChain: destinationWallet.blockchain,
            amount,
          }),
        })

        const data = await response.json()
        if (cancelled) return

        if (response.ok && data.success) {
          setFeeEstimates({
            slow: data.estimates.slow,
            fast: data.estimates.fast,
            gateway: null,
            recommendation: data.recommendation,
            isTestnet: data.isTestnet,
          })
          onRecommendation?.(data.recommendation, data.estimates)
        } else {
          console.error("Failed to estimate fees:", data.error)
        }
      } catch (error) {
        if (!cancelled) console.error("Fee estimation error:", error)
      } finally {
        if (!cancelled) setIsEstimating(false)
      }
    }, 500)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sourceWallet, destinationWallet, amount, onRecommendation])

  const reset = () => setFeeEstimates(EMPTY)

  return { feeEstimates, isEstimating, reset }
}
