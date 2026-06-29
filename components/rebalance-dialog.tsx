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

import { useCallback, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { WalletSelect, type WalletOption } from "@/components/wallet-select";
import { useBridgeFeeEstimates } from "@/components/dialogs/use-bridge-fee-estimates";
import { TransferSpeedSelector } from "@/components/dialogs/transfer-speed-selector";

type RebalanceDialogProps = {
  onClose: () => void;
};

export function RebalanceDialog({ onClose }: RebalanceDialogProps) {
  const [isRebalancing, setIsRebalancing] = useState(false);

  const [sourceWallet, setSourceWallet] = useState<WalletOption | null>(null);
  const [destinationWallet, setDestinationWallet] = useState<WalletOption | null>(null);
  const [amount, setAmount] = useState<string>("1");
  const [transferSpeed, setTransferSpeed] = useState<"FAST" | "SLOW">("SLOW");

  // The fee-estimate hook auto-selects the recommended speed once both
  // options come back available; if only one is available we fall back to it.
  const handleRecommendation = useCallback(
    (
      recommendation: "FAST" | "SLOW" | "INSTANT",
      estimates: { slow: { available?: boolean }; fast: { available?: boolean } }
    ) => {
      if (estimates.slow.available && estimates.fast.available) {
        if (recommendation === "FAST" || recommendation === "SLOW") {
          setTransferSpeed(recommendation);
        }
      } else if (estimates.slow.available) {
        setTransferSpeed("SLOW");
      } else if (estimates.fast.available) {
        setTransferSpeed("FAST");
      }
    },
    []
  );

  const { feeEstimates, isEstimating, reset: resetFeeEstimates } =
    useBridgeFeeEstimates({
      sourceWallet,
      destinationWallet,
      amount,
      onRecommendation: handleRecommendation,
    });

  const handleRebalance = async () => {
    if (!sourceWallet || !destinationWallet || !amount) {
      toast.error("Please fill in all fields");
      return;
    }

    const amountNum = parseFloat(amount);
    if (amountNum <= 0) {
      toast.error("Amount must be greater than 0");
      return;
    }

    const MIN_TRANSFER_AMOUNT = transferSpeed === "FAST" ? 5.0 : 2.0;
    if (amountNum < MIN_TRANSFER_AMOUNT) {
      toast.error("Amount too small", {
        description: `Minimum transfer amount for ${transferSpeed} transfers is ${MIN_TRANSFER_AMOUNT} USDC. Please enter at least ${MIN_TRANSFER_AMOUNT} USDC or use ${transferSpeed === "FAST" ? "Standard" : "Fast"} speed.`,
        duration: 6000,
      });
      return;
    }

    if (sourceWallet.blockchain === destinationWallet.blockchain) {
      toast.error("Source and destination must be on different chains");
      return;
    }

    setIsRebalancing(true);

    try {
      const response = await fetch("/api/bridge/rebalance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceWalletId: sourceWallet.circle_wallet_id,
          sourceChain: sourceWallet.blockchain,
          destinationWalletId: destinationWallet.circle_wallet_id,
          destinationChain: destinationWallet.blockchain,
          amount,
          transferSpeed,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error === "Amount too small") {
          const minAmount = data.minAmount || 2.0;
          const currentAmount = data.currentAmount || parseFloat(amount);

          toast.error("Transfer amount too small", {
            description:
              data.message ||
              `Minimum transfer amount is ${minAmount} USDC. Your amount: ${currentAmount} USDC. Try a larger amount or different transfer speed.`,
            duration: 6000,
          });
          setIsRebalancing(false);
          return;
        }

        const errorMessage =
          data.message || data.error || "Failed to initiate rebalance";
        console.error("Rebalance API error:", {
          error: data.error,
          message: data.message,
          code: data.code,
          type: data.type,
          fullResponse: data,
        });

        // Approve succeeded but burn failed: surface that so users don't
        // double-approve.
        if (data.partialSuccess) {
          throw new Error(
            `${errorMessage}\n\nNote: The approval transaction succeeded, so you may need to wait before retrying to avoid duplicate approvals.`
          );
        }

        throw new Error(errorMessage);
      }

      // The handler now waits for Bridge Kit to resolve (or the maxDuration
      // budget to elapse). PENDING means we did not reach finality in-band;
      // the webhook + bridge/monitor will advance the row.
      const finalStatus = data.result?.status;
      if (finalStatus === "COMPLETE") {
        toast.success("Rebalance complete", {
          description: `Bridged ${amount} USDC from ${sourceWallet.blockchain} to ${destinationWallet.blockchain}.`,
          duration: 6000,
        });
      } else {
        toast.success("Rebalance in progress", {
          description: `Bridging ${amount} USDC from ${sourceWallet.blockchain} to ${destinationWallet.blockchain}. You can close this dialog; the activity feed will update when it settles.`,
          duration: 8000,
        });
      }

      setSourceWallet(null);
      setDestinationWallet(null);
      setAmount("1");
      resetFeeEstimates();

      onClose();
    } catch (error) {
      console.error("Rebalance error:", error);
      toast.error("Rebalance failed", {
        description: error instanceof Error ? error.message : "Please try again",
        duration: 5000,
      });
    } finally {
      setIsRebalancing(false);
    }
  };

  const showSpeedSelector =
    !!sourceWallet && !!destinationWallet && !!amount && parseFloat(amount) > 0;

  return (
    <div className="grid gap-4 py-4 pb-0">
      <div className="grid gap-2">
        <Label>Source Wallet</Label>
        <WalletSelect
          value={
            sourceWallet
              ? `${sourceWallet.address}-${sourceWallet.blockchain}`
              : ""
          }
          onValueChange={() => {}}
          onSelectWallet={(wallet) => {
            setSourceWallet(wallet);
            // Bridges are cross-chain only; clear destination if it now
            // collides with the new source.
            if (
              destinationWallet &&
              wallet.blockchain === destinationWallet.blockchain
            ) {
              setDestinationWallet(null);
            }
          }}
          placeholder="Select source wallet"
          disabled={isRebalancing}
          excludeGatewaySigner={true}
        />
      </div>

      <div className="grid gap-2">
        <Label>Destination Wallet</Label>
        <WalletSelect
          value={
            destinationWallet
              ? `${destinationWallet.address}-${destinationWallet.blockchain}`
              : ""
          }
          onValueChange={() => {}}
          onSelectWallet={setDestinationWallet}
          placeholder={
            !sourceWallet
              ? "Select source wallet first"
              : "Select destination wallet"
          }
          disabled={!sourceWallet || isRebalancing}
          // Cross-chain only: exclude the source wallet itself (by
          // address+chain tuple, since Circle SCA wallets share the same
          // address across chains) and exclude the source chain so the
          // destination is on a different chain.
          excludeWallet={
            sourceWallet
              ? {
                  address: sourceWallet.address,
                  blockchain: sourceWallet.blockchain,
                }
              : undefined
          }
          excludeChain={sourceWallet?.blockchain}
          excludeGatewaySigner={true}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="amount">Amount (USDC)</Label>
        <Input
          id="amount"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min={0.01}
          step={0.01}
          placeholder="0.00"
          className="h-8 w-full"
          disabled={isRebalancing}
        />
        {sourceWallet && destinationWallet && (
          <p className="text-xs text-muted-foreground">
            Minimum: {transferSpeed === "FAST" ? "5.0" : "2.0"} USDC for{" "}
            {transferSpeed === "FAST" ? "Fast" : "Standard"} transfers
          </p>
        )}
      </div>

      {showSpeedSelector && (
        <TransferSpeedSelector
          feeEstimates={feeEstimates}
          isEstimating={isEstimating}
          transferSpeed={transferSpeed}
          onChange={setTransferSpeed}
        />
      )}

      <Button
        onClick={handleRebalance}
        disabled={
          isRebalancing ||
          !sourceWallet ||
          !destinationWallet ||
          parseFloat(amount) <= 0
        }
        className="mt-2"
      >
        {isRebalancing ? (
          <>
            <IconLoader2 className="size-4 animate-spin" />
            Processing...
          </>
        ) : (
          "Rebalance"
        )}
      </Button>
    </div>
  );
}
