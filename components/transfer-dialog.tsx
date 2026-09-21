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

"use client";

import { useRef, useState } from "react";
import { IconArrowsLeftRight, IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ComplianceStatusBadge } from "@/components/compliance-status-badge";
import { ComplianceDetailsDialog } from "@/components/compliance-details-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import { WalletSelect, type WalletOption } from "@/components/wallet-select";
import { CurrencyToggle } from "@/components/currency-toggle";
import type { Currency } from "@/lib/constants/currency";
import { useComplianceCheck } from "@/components/dialogs/use-compliance-check";

export function TransferDialog() {
  const [open, setOpen] = useState(false);
  const [sourceWallet, setSourceWallet] = useState<WalletOption | null>(null);
  const [currency, setCurrency] = useState<Currency>("USDC");
  const [amount, setAmount] = useState("1");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [recipientCompositeValue, setRecipientCompositeValue] = useState("");

  // Compliance + chain validation lives in a shared hook so this dialog and
  // the SendButton stay in sync about when to block/warn.
  const {
    complianceData,
    isCheckingCompliance,
    isValidatingAddress,
    addressError,
    canReceiveUSDC,
    isBlocked,
    needsReview,
    setAddressError,
    reset: resetCompliance,
  } = useComplianceCheck({
    address: recipientAddress,
    chain: sourceWallet?.blockchain,
    validateChainCompatibility: true,
  });

  const [isTransferring, setIsTransferring] = useState(false);
  const [showComplianceDetails, setShowComplianceDetails] = useState(false);
  const [showReviewWarning, setShowReviewWarning] = useState(false);

  // Stable per-intent key so a lost response + Confirm retry does not
  // broadcast a second transfer (#50).
  const idempotencyKeyRef = useRef<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!sourceWallet) {
      toast.error("Missing Source", { description: "Please select a source wallet." });
      return;
    }

    if (complianceData?.result === "FAIL") {
      toast.error("Transfer Blocked", {
        description: "This address is blocked and cannot receive transfers.",
      });
      return;
    }

    if (complianceData?.result === "ERROR") {
      toast.error("Screening Unavailable", {
        description: "Cannot transfer until compliance screening succeeds. Please retry the check.",
      });
      return;
    }

    if (complianceData?.result === "REVIEW" && !showReviewWarning) {
      setShowReviewWarning(true);
      return;
    }

    setIsTransferring(true);
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }

    try {
      const response = await fetch("/api/wallet/transfer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKeyRef.current,
        },
        body: JSON.stringify({
          sourceWalletId: sourceWallet.circle_wallet_id,
          destinationAddress: recipientAddress,
          amount,
          currency,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Transfer failed");
      }

      toast.success("Transfer initiated", {
        description: `Transferring ${amount} ${currency} on ${sourceWallet.blockchain}`,
      });
      idempotencyKeyRef.current = null;
      setOpen(false);
      resetForm();
    } catch (error) {
      console.error("Transfer error:", error);
      toast.error("Transfer Failed", {
        description: error instanceof Error ? error.message : "An unknown error occurred",
      });
    } finally {
      setIsTransferring(false);
    }
  };

  const resetForm = () => {
    idempotencyKeyRef.current = null;
    setSourceWallet(null);
    setCurrency("USDC");
    setAmount("1");
    setRecipientAddress("");
    setRecipientCompositeValue("");
    setShowReviewWarning(false);
    resetCompliance();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) {
          resetForm();
        }
      }}>
        <DialogTrigger asChild>
          <Button variant="outline">
            <IconArrowsLeftRight />
            Transfer
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Transfer</DialogTitle>
              <DialogDescription>
                Send USDC between internal wallets on the same chain.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">

              {/* Source Wallet Selection */}
              <div className="flex flex-col gap-2">
                <Label>Source Wallet</Label>
                <WalletSelect
                  value={sourceWallet ? `${sourceWallet.address}-${sourceWallet.blockchain}` : ""}
                  onValueChange={() => { }}
                  onSelectWallet={(wallet) => {
                    setSourceWallet(wallet);
                    setRecipientAddress("");
                    setRecipientCompositeValue("");
                    resetCompliance();
                  }}
                  placeholder="Select source wallet"
                  disabled={isTransferring}
                  excludeGatewaySigner={true}
                  token={currency}
                />
              </div>

              {/* Currency Toggle */}
              <div className="flex flex-col gap-2">
                <Label>Currency</Label>
                <CurrencyToggle
                  value={currency}
                  onChange={setCurrency}
                  disabled={isTransferring}
                />
              </div>

              {/* Recipient Wallet Selection */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="recipient">Recipient Address</Label>
                <WalletSelect
                  value={recipientCompositeValue}
                  onValueChange={(value) => {
                    setRecipientCompositeValue(value);
                    setAddressError("");
                  }}
                  onSelectWallet={(wallet) => {
                    setRecipientAddress(wallet.address);
                    setRecipientCompositeValue(`${wallet.address}-${wallet.blockchain}`);
                  }}
                  placeholder={!sourceWallet ? "Select source wallet first" : "Select recipient wallet"}
                  disabled={!sourceWallet || isTransferring}
                  excludeAddress={sourceWallet?.address}
                  chainFilter={sourceWallet?.blockchain}
                  excludeGatewaySigner={true}
                />

                {addressError && (
                  <p className="text-xs text-red-500">{addressError}</p>
                )}
                {(isCheckingCompliance || isValidatingAddress) && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <IconLoader2 className="size-3 animate-spin" />
                    {isValidatingAddress ? "Validating address..." : "Checking compliance..."}
                  </div>
                )}
                {complianceData && !isCheckingCompliance && (
                  <div className="flex items-center justify-between">
                    <ComplianceStatusBadge result={complianceData.result} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowComplianceDetails(true)}
                      className="h-auto p-1 text-xs"
                    >
                      View Details
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="amount">Amount</Label>
                <Input
                  id="amount"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  min={0.01}
                  step={0.01}
                  className="col-span-2 h-8"
                  disabled={isTransferring}
                />
              </div>

              {/* Blocked Alert */}
              {isBlocked && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    This address has been blocked due to compliance violations. Transfer
                    cannot proceed.
                  </AlertDescription>
                </Alert>
              )}

              {/* Review Warning */}
              {needsReview && showReviewWarning && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    This address requires manual review. By proceeding, you acknowledge the
                    risk and take responsibility for this transaction.
                  </AlertDescription>
                </Alert>
              )}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" onClick={resetForm} disabled={isTransferring}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={
                  isBlocked ||
                  !sourceWallet ||
                  !recipientAddress ||
                  !!addressError ||
                  isCheckingCompliance ||
                  isValidatingAddress ||
                  canReceiveUSDC === false ||
                  isTransferring ||
                  parseFloat(amount) <= 0
                }
              >
                {isTransferring ? (
                  <>
                    <IconLoader2 className="size-4 animate-spin" />
                    Processing...
                  </>
                ) : needsReview && !showReviewWarning ? (
                  "Review & Confirm"
                ) : (
                  "Confirm"
                )}
              </Button>
            </DialogFooter>
          </form>

          {/* Rendered as a child of DialogContent (not a sibling of Dialog) so
              React's portal-aware event bubbling lets this dialog's outer
              DismissableLayer recognize clicks inside the compliance dialog
              as "inside its own tree" instead of an outside interaction that
              would otherwise close both dialogs. */}
          <ComplianceDetailsDialog
            open={showComplianceDetails}
            onOpenChange={setShowComplianceDetails}
            complianceData={complianceData}
            address={recipientAddress}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
