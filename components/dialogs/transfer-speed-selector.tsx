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

import { IconBolt, IconClock, IconLoader2 } from "@tabler/icons-react"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type {
  BridgeFeeEstimate,
  BridgeFeeEstimateState,
} from "./use-bridge-fee-estimates"

type Props = {
  feeEstimates: BridgeFeeEstimateState
  isEstimating: boolean
  transferSpeed: "FAST" | "SLOW"
  onChange: (speed: "FAST" | "SLOW") => void
}

/**
 * Renders the Standard/Fast toggle and per-option fee/time chips for the
 * rebalance dialog. Pure presentational once estimates are loaded.
 */
export function TransferSpeedSelector({
  feeEstimates,
  isEstimating,
  transferSpeed,
  onChange,
}: Props) {
  return (
    <div className="grid gap-2">
      <Label>Transfer Speed</Label>
      {isEstimating ? (
        <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
          <IconLoader2 className="size-4 animate-spin mr-2" />
          Estimating fees...
        </div>
      ) : feeEstimates.slow && feeEstimates.fast ? (
        <div className="space-y-2">
          <ToggleGroup
            type="single"
            value={transferSpeed}
            onValueChange={(value) => {
              if (value) onChange(value as "FAST" | "SLOW")
            }}
            className="grid grid-cols-2 gap-2"
          >
            <SpeedToggle
              value="SLOW"
              icon={<IconClock className="size-4" />}
              label="Standard"
              estimate={feeEstimates.slow}
              recommended={
                feeEstimates.recommendation === "SLOW" &&
                feeEstimates.slow.available !== false
              }
              isTestnet={feeEstimates.isTestnet}
            />
            <SpeedToggle
              value="FAST"
              icon={<IconBolt className="size-4" />}
              label="Fast"
              estimate={feeEstimates.fast}
              recommended={
                feeEstimates.recommendation === "FAST" &&
                feeEstimates.fast.available !== false
              }
              isTestnet={feeEstimates.isTestnet}
            />
          </ToggleGroup>
          {feeEstimates.isTestnet && (
            <p className="text-xs text-muted-foreground bg-muted p-2 rounded">
              ℹ️ Testnet transfers may have reduced or zero fees. Mainnet fees
              will apply in production.
            </p>
          )}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {transferSpeed === "FAST"
                ? "Fast transfers use Circle's fast burn for quicker confirmation"
                : "Standard transfers are cost-effective and reliable"}
            </p>
            <p className="text-xs text-muted-foreground">
              Minimum amount:{" "}
              <span className="font-medium">
                {transferSpeed === "FAST" ? "5.0" : "2.0"} USDC
              </span>
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SpeedToggle({
  value,
  icon,
  label,
  estimate,
  recommended,
  isTestnet,
}: {
  value: "FAST" | "SLOW"
  icon: React.ReactNode
  label: string
  estimate: BridgeFeeEstimate
  recommended: boolean
  isTestnet?: boolean
}) {
  const unavailable = estimate.available === false
  return (
    <ToggleGroupItem
      value={value}
      disabled={unavailable}
      className="flex flex-col items-start p-3 h-auto data-[state=on]:bg-primary data-[state=on]:text-primary-foreground disabled:opacity-50"
    >
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="font-medium">{label}</span>
        {recommended && (
          <span className="text-[10px] bg-green-500 text-white px-1 rounded">
            Recommended
          </span>
        )}
      </div>
      <div className="text-xs opacity-80">{estimate.estimatedTime}</div>
      {unavailable ? (
        <div className="text-xs text-destructive mt-1">Not available</div>
      ) : (
        <div className="text-xs font-medium mt-1">
          Fee: {parseFloat(estimate.protocolFees).toFixed(4)} USDC
          {isTestnet && parseFloat(estimate.protocolFees) === 0 && (
            <span className="ml-1 text-muted-foreground">(Testnet)</span>
          )}
        </div>
      )}
    </ToggleGroupItem>
  )
}
