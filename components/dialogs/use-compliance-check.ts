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
import { toast } from "sonner"
import type { ComplianceCheckResponse } from "@/types/compliance"
import { isValidAddress } from "@/lib/compliance/utils"

type UseComplianceCheckArgs = {
  address: string
  /** Source chain context. Compliance API treats this as optional. */
  chain?: string
  /**
   * Whether to also call `/api/wallet/validate-address` to confirm the
   * destination can receive USDC on the chosen chain. Defaults to true.
   */
  validateChainCompatibility?: boolean
}

/**
 * Centralizes the debounced address-validation + compliance-screening flow
 * shared by the Transfer and Send dialogs. Pulls ~120 lines of logic out of
 * each dialog and ensures both stay in sync about when to block/warn.
 */
export function useComplianceCheck({
  address,
  chain,
  validateChainCompatibility = true,
}: UseComplianceCheckArgs) {
  const [complianceData, setComplianceData] =
    useState<ComplianceCheckResponse | null>(null)
  const [isCheckingCompliance, setIsCheckingCompliance] = useState(false)
  const [isValidatingAddress, setIsValidatingAddress] = useState(false)
  const [addressError, setAddressError] = useState<string>("")
  const [canReceiveUSDC, setCanReceiveUSDC] = useState<boolean | null>(null)

  useEffect(() => {
    if (!address) {
      setComplianceData(null)
      setAddressError("")
      setCanReceiveUSDC(null)
      return
    }

    if (address.length > 0 && !isValidAddress(address)) {
      setComplianceData(null)
      setAddressError("Invalid blockchain address format")
      setCanReceiveUSDC(null)
      return
    }

    setAddressError("")
    if (address.length < 10) {
      setComplianceData(null)
      setCanReceiveUSDC(null)
      return
    }

    const timer = setTimeout(async () => {
      if (validateChainCompatibility && chain) {
        await runValidate(address, chain)
      }
      await runScreening(address, chain)
    }, 500)

    return () => clearTimeout(timer)

    async function runValidate(addr: string, blockchain: string) {
      setIsValidatingAddress(true)
      try {
        const response = await fetch("/api/wallet/validate-address", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: addr, blockchain }),
        })
        const data = await response.json()
        setCanReceiveUSDC(data.isValid)
        if (!data.isValid) {
          setAddressError(
            "This address cannot receive USDC on the selected chain"
          )
        }
      } catch (error) {
        console.error("Address validation failed:", error)
        setCanReceiveUSDC(null)
      } finally {
        setIsValidatingAddress(false)
      }
    }

    async function runScreening(addr: string, blockchain?: string) {
      setIsCheckingCompliance(true)
      try {
        const response = await fetch("/api/compliance/screen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: addr, chain: blockchain }),
        })
        const data: ComplianceCheckResponse = await response.json()
        setComplianceData(data)

        if (data.result === "FAIL") {
          toast.error("Address Blocked", {
            description:
              "This address has been flagged for compliance violations.",
          })
        } else if (data.result === "ERROR") {
          toast.error("Screening Unavailable", {
            description:
              "Compliance screening could not complete. Please retry before transferring.",
          })
        } else if (data.result === "REVIEW") {
          toast.warning("Review Required", {
            description: "This address requires manual review before proceeding.",
          })
        }
      } catch (error) {
        console.error("Compliance check failed:", error)
        toast.error("Compliance check failed", {
          description: "Unable to verify address. Please try again.",
        })
      } finally {
        setIsCheckingCompliance(false)
      }
    }
  }, [address, chain, validateChainCompatibility])

  const reset = () => {
    setComplianceData(null)
    setAddressError("")
    setCanReceiveUSDC(null)
  }

  return {
    complianceData,
    isCheckingCompliance,
    isValidatingAddress,
    addressError,
    canReceiveUSDC,
    isBlocked:
      complianceData?.result === "FAIL" || complianceData?.result === "ERROR",
    needsReview: complianceData?.result === "REVIEW",
    setAddressError,
    reset,
  }
}
