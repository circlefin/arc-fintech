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
import { IconLoader2, IconBolt, IconClock } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { WalletSelect, type WalletOption } from "@/components/wallet-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Card } from "@/components/ui/card";

type RebalanceDialogProps = {
  onClose: () => void;
};

type FeeEstimate = {
  transferSpeed: "FAST" | "SLOW" | "INSTANT";
  protocolFees: string;
  hasGasFees: boolean;
  estimatedTime: string;
  available?: boolean;
  errorMessage?: string;
  gasFeesInfo?: Array<{ chain: string; token: string; amount: string }>;
};

export function RebalanceDialog({ onClose }: RebalanceDialogProps) {
  const [isRebalancing, setIsRebalancing] = useState(false);
  const [isEstimating, setIsEstimating] = useState(false);

  // Form state - storing full wallet objects to access chain info
  const [sourceWallet, setSourceWallet] = useState<WalletOption | null>(null);
  const [destinationWallet, setDestinationWallet] = useState<WalletOption | null>(null);
  const [amount, setAmount] = useState<string>("1");
  const [transferSpeed, setTransferSpeed] = useState<"FAST" | "SLOW">("SLOW");
  
  // Fee estimation state
  const [feeEstimates, setFeeEstimates] = useState<{
    slow: FeeEstimate | null;
    fast: FeeEstimate | null;
    gateway: FeeEstimate | null;
    recommendation: "FAST" | "SLOW" | "INSTANT" | null;
    isTestnet?: boolean;
    gatewayAvailable?: boolean;
  }>({ slow: null, fast: null, gateway: null, recommendation: null, isTestnet: false, gatewayAvailable: false });

  // Fetch fee estimates when all required fields are filled
  useEffect(() => {
    const fetchFeeEstimates = async () => {
      if (!sourceWallet || !destinationWallet || !amount || parseFloat(amount) <= 0) {
        setFeeEstimates({ slow: null, fast: null, gateway: null, recommendation: null });
        return;
      }

      setIsEstimating(true);
      try {
        const response = await fetch("/api/bridge/estimate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sourceWalletId: sourceWallet.circle_wallet_id,
            sourceChain: sourceWallet.blockchain,
            destinationWalletId: destinationWallet.circle_wallet_id,
            destinationChain: destinationWallet.blockchain,
            amount,
          }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          setFeeEstimates({
            slow: data.estimates.slow,
            fast: data.estimates.fast,
            gateway: null,
            recommendation: data.recommendation,
            isTestnet: data.isTestnet,
          });
          
          // Auto-select recommended speed (prefer available option)
          if (data.estimates.slow.available && data.estimates.fast.available) {
            setTransferSpeed(data.recommendation);
          } else if (data.estimates.slow.available) {
            setTransferSpeed("SLOW");
          } else if (data.estimates.fast.available) {
            setTransferSpeed("FAST");
          }
        } else {
          console.error("Failed to estimate fees:", data.error);
        }
      } catch (error) {
        console.error("Fee estimation error:", error);
      } finally {
        setIsEstimating(false);
      }
    };

    // Debounce the fee estimation
    const timer = setTimeout(fetchFeeEstimates, 500);
    return () => clearTimeout(timer);
  }, [sourceWallet, destinationWallet, amount]);

  const handleRebalance = async () => {
    // Validation
    if (!sourceWallet || !destinationWallet || !amount) {
      toast.error("Please fill in all fields");
      return;
    }

    const amountNum = parseFloat(amount);
    if (amountNum <= 0) {
      toast.error("Amount must be greater than 0");
      return;
    }

    // Validate minimum transfer amounts
    const MIN_TRANSFER_AMOUNT = transferSpeed === "FAST" ? 5.0 : 2.0;
    if (amountNum < MIN_TRANSFER_AMOUNT) {
      toast.error("Amount too small", {
        description: `Minimum transfer amount for ${transferSpeed} transfers is ${MIN_TRANSFER_AMOUNT} USDC. Please enter at least ${MIN_TRANSFER_AMOUNT} USDC or use ${transferSpeed === "FAST" ? "Standard" : "Fast"} speed.`,
        duration: 6000,
      });
      return;
    }

    // Double check logic (though UI prevents this)
    if (sourceWallet.blockchain === destinationWallet.blockchain) {
      toast.error("Source and destination must be on different chains");
      return;
    }

    setIsRebalancing(true);

    try {
      // Call the Bridge Kit API endpoint
      const response = await fetch("/api/bridge/rebalance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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
        // Handle specific error types with better messaging
        if (data.error === "Amount too small") {
          // Backend validation caught minimum amount issue
          const minAmount = data.minAmount || 2.0;
          const currentAmount = data.currentAmount || parseFloat(amount);
          
          toast.error("Transfer amount too small", {
            description: data.message || `Minimum transfer amount is ${minAmount} USDC. Your amount: ${currentAmount} USDC. Try a larger amount or different transfer speed.`,
            duration: 6000,
          });
          setIsRebalancing(false);
          return;
        }
        
        // Use the user-friendly message if available, otherwise fall back to error
        const errorMessage = data.message || data.error || "Failed to initiate rebalance";
        console.error("Rebalance API error:", { 
          error: data.error, 
          message: data.message, 
          code: data.code,
          type: data.type,
          fullResponse: data 
        });

        // For partial success (approve succeeded but burn failed), provide specific guidance
        if (data.partialSuccess) {
          throw new Error(
            `${errorMessage}\n\nNote: The approval transaction succeeded, so you may need to wait before retrying to avoid duplicate approvals.`
          );
        }

        throw new Error(errorMessage);
      }

      // Success - close dialog immediately and show progress notification
      const selectedEstimate = transferSpeed === "FAST" ? feeEstimates.fast : feeEstimates.slow;
      const transferType = selectedEstimate ? `${transferSpeed} mode` : "instant transfer";

      toast.success("Rebalance initiated successfully!", {
        description: `Bridging ${amount} USDC from ${sourceWallet.blockchain} to ${destinationWallet.blockchain} (${transferType}). This process may take ~20 minutes to complete. You can close this dialog.`,
        duration: 8000,
      });

      // Reset form
      setSourceWallet(null);
      setDestinationWallet(null);
      setAmount("1");
      setFeeEstimates({ slow: null, fast: null, gateway: null, recommendation: null });

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

  return (
    <div className="grid gap-4 py-4 pb-0">
      {/* Source Wallet */}
      <div className="grid gap-2">
        <Label>Source Wallet</Label>
        <WalletSelect
          value={sourceWallet ? `${sourceWallet.address}-${sourceWallet.blockchain}` : ""}
          onValueChange={() => { }} // Handled by onSelectWallet
          onSelectWallet={(wallet) => {
            setSourceWallet(wallet);
            // If the new source chain matches the current destination chain, clear destination
            if (destinationWallet && wallet.blockchain === destinationWallet.blockchain) {
              setDestinationWallet(null);
            }
          }}
          placeholder="Select source wallet"
          disabled={isRebalancing}
          excludeGatewaySigner={true}
        />
      </div>

      {/* Destination Wallet */}
      <div className="grid gap-2">
        <Label>Destination Wallet</Label>
        <WalletSelect
          value={destinationWallet ? `${destinationWallet.address}-${destinationWallet.blockchain}` : ""}
          onValueChange={() => { }} // Handled by onSelectWallet
          onSelectWallet={setDestinationWallet}
          placeholder={!sourceWallet ? "Select source wallet first" : "Select destination wallet"}
          disabled={!sourceWallet || isRebalancing}
          // Logic: Exclude the source wallet itself AND exclude the source chain (Cross-chain only)
          excludeAddress={sourceWallet?.address}
          excludeChain={sourceWallet?.blockchain}
          excludeGatewaySigner={true}
        />
      </div>

      {/* Amount */}
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
            Minimum: {transferSpeed === "FAST" ? "5.0" : "2.0"} USDC for {transferSpeed === "FAST" ? "Fast" : "Standard"} transfers
          </p>
        )}
      </div>

      {/* Transfer Speed Selection */}
      {sourceWallet && destinationWallet && amount && parseFloat(amount) > 0 && (
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
                  if (value) setTransferSpeed(value as "FAST" | "SLOW");
                }}
                className="grid grid-cols-2 gap-2"
              >
                <ToggleGroupItem
                  value="SLOW"
                  disabled={feeEstimates.slow.available === false}
                  className="flex flex-col items-start p-3 h-auto data-[state=on]:bg-primary data-[state=on]:text-primary-foreground disabled:opacity-50"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <IconClock className="size-4" />
                    <span className="font-medium">Standard</span>
                    {feeEstimates.recommendation === "SLOW" && feeEstimates.slow.available !== false && (
                      <span className="text-[10px] bg-green-500 text-white px-1 rounded">Recommended</span>
                    )}
                  </div>
                  <div className="text-xs opacity-80">{feeEstimates.slow.estimatedTime}</div>
                  {feeEstimates.slow.available === false ? (
                    <div className="text-xs text-destructive mt-1">Not available</div>
                  ) : (
                    <div className="text-xs font-medium mt-1">
                      Fee: {parseFloat(feeEstimates.slow.protocolFees).toFixed(4)} USDC
                      {feeEstimates.isTestnet && parseFloat(feeEstimates.slow.protocolFees) === 0 && (
                        <span className="ml-1 text-muted-foreground">(Testnet)</span>
                      )}
                    </div>
                  )}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="FAST"
                  disabled={feeEstimates.fast.available === false}
                  className="flex flex-col items-start p-3 h-auto data-[state=on]:bg-primary data-[state=on]:text-primary-foreground disabled:opacity-50"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <IconBolt className="size-4" />
                    <span className="font-medium">Fast</span>
                    {feeEstimates.recommendation === "FAST" && feeEstimates.fast.available !== false && (
                      <span className="text-[10px] bg-green-500 text-white px-1 rounded">Recommended</span>
                    )}
                  </div>
                  <div className="text-xs opacity-80">{feeEstimates.fast.estimatedTime}</div>
                  {feeEstimates.fast.available === false ? (
                    <div className="text-xs text-destructive mt-1">Not available</div>
                  ) : (
                    <div className="text-xs font-medium mt-1">
                      Fee: {parseFloat(feeEstimates.fast.protocolFees).toFixed(4)} USDC
                      {feeEstimates.isTestnet && parseFloat(feeEstimates.fast.protocolFees) === 0 && (
                        <span className="ml-1 text-muted-foreground">(Testnet)</span>
                      )}
                    </div>
                  )}
                </ToggleGroupItem>
              </ToggleGroup>
              {feeEstimates.isTestnet && (
                <p className="text-xs text-muted-foreground bg-muted p-2 rounded">
                  ℹ️ Testnet transfers may have reduced or zero fees. Mainnet fees will apply in production.
                </p>
              )}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {transferSpeed === "FAST" 
                    ? "Fast transfers use Circle's fast burn for quicker confirmation" 
                    : "Standard transfers are cost-effective and reliable"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Minimum amount: <span className="font-medium">{transferSpeed === "FAST" ? "5.0" : "2.0"} USDC</span>
                </p>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Action Button */}
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
