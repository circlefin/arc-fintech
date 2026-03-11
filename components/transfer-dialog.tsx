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

import { useState, useEffect } from "react";
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
import { ComplianceCheckResponse } from "@/types/compliance";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import { isValidAddress } from "@/lib/compliance/utils";
import { WalletSelect, type WalletOption } from "@/components/wallet-select";

export function TransferDialog() {
  const [open, setOpen] = useState(false);
  const [sourceWallet, setSourceWallet] = useState<WalletOption | null>(null);
  const [amount, setAmount] = useState("1");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [recipientCompositeValue, setRecipientCompositeValue] = useState("");

  // Compliance & Status
  const [complianceData, setComplianceData] = useState<ComplianceCheckResponse | null>(null);
  const [isCheckingCompliance, setIsCheckingCompliance] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [showComplianceDetails, setShowComplianceDetails] = useState(false);
  const [showReviewWarning, setShowReviewWarning] = useState(false);
  const [addressError, setAddressError] = useState<string>("");
  const [isValidatingAddress, setIsValidatingAddress] = useState(false);
  const [canReceiveUSDC, setCanReceiveUSDC] = useState<boolean | null>(null);

  // Debounced compliance check and address validation
  useEffect(() => {
    if (!recipientAddress) {
      setComplianceData(null);
      setAddressError("");
      setCanReceiveUSDC(null);
      return;
    }

    if (recipientAddress.length > 0 && !isValidAddress(recipientAddress)) {
      setComplianceData(null);
      setAddressError("Invalid blockchain address format");
      setCanReceiveUSDC(null);
      return;
    }

    setAddressError("");

    if (recipientAddress.length < 10) {
      setComplianceData(null);
      setCanReceiveUSDC(null);
      return;
    }

    const timer = setTimeout(async () => {
      await validateAddress();
      await checkCompliance();
    }, 500);

    return () => clearTimeout(timer);
  }, [recipientAddress, sourceWallet?.blockchain]);

  const validateAddress = async () => {
    if (!recipientAddress || recipientAddress.length < 10 || !sourceWallet) return;

    if (!isValidAddress(recipientAddress)) {
      return;
    }

    setIsValidatingAddress(true);
    try {
      const response = await fetch("/api/wallet/validate-address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: recipientAddress,
          blockchain: sourceWallet.blockchain,
        }),
      });

      const data = await response.json();
      setCanReceiveUSDC(data.isValid);

      if (!data.isValid) {
        setAddressError("This address cannot receive USDC on the selected chain");
      }
    } catch (error) {
      console.error("Address validation failed:", error);
      // Don't block on validation errors, just log them
      setCanReceiveUSDC(null);
    } finally {
      setIsValidatingAddress(false);
    }
  };

  const checkCompliance = async () => {
    if (!recipientAddress || recipientAddress.length < 10) return;

    if (!isValidAddress(recipientAddress)) {
      toast.error("Invalid Address", {
        description: "Please enter a valid blockchain address.",
      });
      return;
    }

    setIsCheckingCompliance(true);
    try {
      const response = await fetch("/api/compliance/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: recipientAddress,
          // We pass the source chain for context if available, though API handles it optionally
          chain: sourceWallet?.blockchain
        }),
      });

      const data: ComplianceCheckResponse = await response.json();
      setComplianceData(data);

      if (data.result === "FAIL") {
        toast.error("Address Blocked", {
          description: "This address has been flagged for compliance violations.",
        });
      } else if (data.result === "REVIEW") {
        toast.warning("Review Required", {
          description: "This address requires manual review before proceeding.",
        });
      }
    } catch (error) {
      console.error("Compliance check failed:", error);
      toast.error("Compliance check failed", {
        description: "Unable to verify address. Please try again.",
      });
    } finally {
      setIsCheckingCompliance(false);
    }
  };

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

    if (complianceData?.result === "REVIEW" && !showReviewWarning) {
      setShowReviewWarning(true);
      return;
    }

    setIsTransferring(true);

    try {
      const response = await fetch("/api/wallet/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceWalletId: sourceWallet.circle_wallet_id,
          destinationAddress: recipientAddress,
          amount,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Transfer failed");
      }

      toast.success("Transfer initiated", {
        description: `Transferring ${amount} USDC on ${sourceWallet.blockchain}`,
      });
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
    setSourceWallet(null);
    setAmount("1");
    setRecipientAddress("");
    setRecipientCompositeValue("");
    setComplianceData(null);
    setShowReviewWarning(false);
    setAddressError("");
    setCanReceiveUSDC(null);
  };

  const isBlocked = complianceData?.result === "FAIL";
  const needsReview = complianceData?.result === "REVIEW";

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
                    setComplianceData(null);
                    setCanReceiveUSDC(null);
                  }}
                  placeholder="Select source wallet"
                  disabled={isTransferring}
                  excludeGatewaySigner={true}
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
        </DialogContent>
      </Dialog>

      {/* Compliance Details Dialog */}
      <ComplianceDetailsDialog
        open={showComplianceDetails}
        onOpenChange={setShowComplianceDetails}
        complianceData={complianceData}
        address={recipientAddress}
      />
    </>
  );
}
