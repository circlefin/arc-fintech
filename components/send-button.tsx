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
import { IconChevronDown, IconSend, IconLoader2, IconClock, IconCoin } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ComplianceStatusBadge } from "@/components/compliance-status-badge";
import { ComplianceDetailsDialog } from "@/components/compliance-details-dialog";
import { ComplianceCheckResponse } from "@/types/compliance";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { isValidAddress } from "@/lib/compliance/utils";
import { createClient } from "@/lib/supabase/client";
import { Separator } from "@/components/ui/separator";
import { WalletSelect, WalletOption } from "@/components/wallet-select";
import { useBalanceContext } from "@/lib/contexts/balance-context";

const SUPPORTED_CHAINS = [
  { value: "arcTestnet", label: "Arc Testnet" },
  { value: "ethSepolia", label: "Ethereum Sepolia" },
  { value: "baseSepolia", label: "Base Sepolia" },
  { value: "avalancheFuji", label: "Avalanche Fuji" },
];

const BLOCKCHAIN_MAP: Record<string, string> = {
  arcTestnet: "ARC-TESTNET",
  ethSepolia: "ETH-SEPOLIA",
  baseSepolia: "BASE-SEPOLIA",
  avalancheFuji: "AVAX-FUJI",
};

interface SettlementInfo {
  estimatedTimeSeconds: number;
  estimatedTimeFriendly: string;
  estimatedFeeUSDC: number;
  guaranteed: boolean;
}

interface RoutingInfo {
  strategy: string;
  sourceChain: string;
  destinationChain: string;
  automaticallySelected: boolean;
}

export function SendButton() {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("1");
  const [destinationChain, setDestinationChain] = useState("arcTestnet");
  const [sourceType, setSourceType] = useState<"auto" | "gateway" | "wallet">("auto");
  const [selectedWalletId, setSelectedWalletId] = useState<string>("");
  const [selectedWallet, setSelectedWallet] = useState<WalletOption | null>(null);
  const [walletSelectValue, setWalletSelectValue] = useState("");
  
  const [complianceData, setComplianceData] = useState<ComplianceCheckResponse | null>(null);
  const [isCheckingCompliance, setIsCheckingCompliance] = useState(false);
  const [showComplianceDetails, setShowComplianceDetails] = useState(false);
  const [showReviewWarning, setShowReviewWarning] = useState(false);
  const [addressError, setAddressError] = useState<string>("");
  const [isInternalWallet, setIsInternalWallet] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [settlementInfo, setSettlementInfo] = useState<SettlementInfo | null>(null);
  const [routingInfo, setRoutingInfo] = useState<RoutingInfo | null>(null);
  const [isValidatingAddress, setIsValidatingAddress] = useState(false);
  const [canReceiveUSDC, setCanReceiveUSDC] = useState<boolean | null>(null);

  const supabase = createClient();
  const { gatewayTotal, refreshGatewayBalance, refreshWalletBalance } = useBalanceContext();

  // Debounced compliance check, internal wallet check, and address validation
  useEffect(() => {
    // Reset validation state on change
    setAddressError("");
    setComplianceData(null);
    setIsInternalWallet(false);
    setCanReceiveUSDC(null);

    if (!address) return;

    // Show validation error for any non-empty input that's invalid
    if (address.length > 0 && !isValidAddress(address)) {
      setComplianceData(null);
      setAddressError("Invalid blockchain address format");
      return;
    }

    // Only run checks if address is long enough and valid
    if (address.length < 10) {
      setComplianceData(null);
      return;
    }

    const timer = setTimeout(async () => {
      await checkIfInternalWallet();
      await validateAddress();
      await checkCompliance();
    }, 500);

    return () => clearTimeout(timer);
  }, [address]);

  const checkIfInternalWallet = async () => {
    try {
      // Check if address exists in our wallets table
      const { data, error } = await supabase
        .from("wallets")
        .select("id")
        .eq("address", address)
        .maybeSingle();

      if (error) {
        console.error("Error checking wallet:", error);
        return;
      }

      if (data) {
        setIsInternalWallet(true);
        setAddressError("Cannot send to internal wallets. Use Transfer instead.");
      }
    } catch (error) {
      console.error("Check failed:", error);
    }
  };

  const validateAddress = async () => {
    if (!address || address.length < 10) return;

    if (!isValidAddress(address)) {
      return;
    }

    const blockchain = BLOCKCHAIN_MAP[destinationChain] || "ARC-TESTNET";

    setIsValidatingAddress(true);
    try {
      const response = await fetch("/api/wallet/validate-address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: address,
          blockchain: blockchain,
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
    if (!address || address.length < 10) return;

    // Validate address format
    if (!isValidAddress(address)) {
      toast.error("Invalid Address", {
        description: "Please enter a valid blockchain address.",
      });
      return;
    }

    const blockchain = BLOCKCHAIN_MAP[destinationChain] || "ETH-SEPOLIA";

    setIsCheckingCompliance(true);
    try {
      const response = await fetch("/api/compliance/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: address,
          chain: blockchain,
        }),
      });

      const data: ComplianceCheckResponse = await response.json();
      setComplianceData(data);

      // Don't show toast notifications - let the user see the badge and details
    } catch (error) {
      console.error("Compliance check failed:", error);
      toast.error("Compliance check failed", {
        description: "Unable to verify address. Please try again.",
      });
    } finally {
      setIsCheckingCompliance(false);
    }
  };

  const handleSend = async () => {
    if (isInternalWallet) {
      toast.error("Invalid Destination", {
        description: "Please use the Transfer feature for internal wallets.",
      });
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

    // Validate source selection
    if (sourceType === "wallet" && !selectedWalletId) {
      toast.error("No Wallet Selected", {
        description: "Please select a wallet to use as payment source.",
      });
      return;
    }

    setIsSending(true);

    try {
      const requestBody: any = {
        recipientAddress: address,
        amount,
        destinationChain,
        sourceType,
      };

      // Add wallet ID if specific wallet is selected
      if (sourceType === "wallet" && selectedWalletId) {
        requestBody.sourceWalletId = selectedWalletId;
      }

      const response = await fetch("/api/payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      // Handle 202 (partial success - needs gas)
      if (response.status === 202 && data.partialSuccess) {
        // Store routing and settlement info for display
        setRoutingInfo(data.routing);
        setSettlementInfo(data.settlement);

        toast.warning("Action Required: Fund Wallet", {
          description: data.userMessage,
          duration: 10000, // Show for 10 seconds
        });

        setOpen(false);
        resetForm();
        // Refresh balances to show updated state if any
        refreshWalletBalance();
        return;
      }

      if (!response.ok) {
        // Use userMessage if available for better UX
        throw new Error(data.userMessage || data.error || "Payout failed");
      }

      // Store routing and settlement info for display
      setRoutingInfo(data.routing);
      setSettlementInfo(data.settlement);

      const sourceDescription = 
        sourceType === "gateway" ? "Gateway balance" :
        sourceType === "wallet" ? "Selected wallet" :
        "Auto-selected source";

      toast.success("Payout initiated successfully!", {
        description: `${sourceDescription} • ${data.routing.strategy === "same-chain" ? "Direct transfer" : "Cross-chain via Gateway"} • Est. ${data.settlement.estimatedTimeFriendly}`,
      });

      // Refresh balances
      refreshGatewayBalance();
      refreshWalletBalance();

      setOpen(false);
      resetForm();
    } catch (error) {
      console.error("Payout error:", error);
      toast.error("Payout Failed", {
        description: error instanceof Error ? error.message : "An unknown error occurred",
      });
    } finally {
      setIsSending(false);
    }
  };

  const resetForm = () => {
    setAddress("");
    setAmount("1");
    setComplianceData(null);
    setShowReviewWarning(false);
    setAddressError("");
    setIsInternalWallet(false);
    setShowComplianceDetails(false);
    setCanReceiveUSDC(null);
    // Don't reset selectedWalletId to keep user preference if they open again?
    // But original code reset inputs on open=false.
    // Let's reset selection too if needed, but original resetForm didn't reset source type or wallet.
  };

  const isBlocked = complianceData?.result === "FAIL";
  const needsReview = complianceData?.result === "REVIEW";

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(isOpen) => {
          // Don't close if we're opening the compliance details dialog
          if (!isOpen && showComplianceDetails) {
            return;
          }
          setOpen(isOpen);
          if (!isOpen) {
            resetForm();
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline">
            <IconSend />
            Payout
            <IconChevronDown />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="grid gap-4">
            <div className="space-y-2">
              <h4 className="leading-none font-medium">Send USDC to external wallet</h4>
            </div>
            <div className="grid gap-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  placeholder="0x..."
                  value={address}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    setAddressError("");
                  }}
                  className={`col-span-2 h-8 font-mono text-sm ${addressError ? "border-red-500" : ""}`}
                />
                {addressError && (
                  <p className="text-xs text-red-500">{addressError}</p>
                )}
                {(isCheckingCompliance || isValidatingAddress) && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <IconLoader2 className="size-3 animate-spin" />
                    {isValidatingAddress ? "Validating address..." : "Checking compliance..."}
                  </div>
                )}
                {complianceData && !isCheckingCompliance && !isInternalWallet && (
                  <div className="flex items-center justify-between">
                    <ComplianceStatusBadge result={complianceData.result} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowComplianceDetails(true);
                      }}
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
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="destination-chain">Destination Chain</Label>
                <Select value={destinationChain} onValueChange={(val) => {
                  setDestinationChain(val);
                  // Clear selection if chain changes because options are filtered
                  // if we want to enforce strict matching.
                  // But if user has selected a wallet, it might disappear from list.
                  // It's better to clear it to avoid confusion or invalid state.
                  if (sourceType === "wallet") {
                     setSelectedWalletId("");
                     setSelectedWallet(null);
                     setWalletSelectValue("");
                  }
                }}>
                  <SelectTrigger id="destination-chain" className="w-full">
                    <SelectValue placeholder="Select chain" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CHAINS.map((chain) => (
                      <SelectItem key={chain.value} value={chain.value}>
                        {chain.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="source-type">Payment Source</Label>
                <Select value={sourceType} onValueChange={(value: "auto" | "gateway" | "wallet") => {
                  setSourceType(value);
                  if (value !== "wallet") {
                    setSelectedWalletId("");
                    setSelectedWallet(null);
                    setWalletSelectValue("");
                  }
                }}>
                  <SelectTrigger id="source-type" className="w-full">
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (Recommended)</SelectItem>
                    <SelectItem value="gateway">
                      Gateway Balance ({gatewayTotal.toFixed(2)} USDC)
                    </SelectItem>
                    <SelectItem value="wallet">Specific Wallet</SelectItem>
                  </SelectContent>
                </Select>
                {sourceType === "auto" && (
                  <p className="text-xs text-muted-foreground">
                    System will automatically select the optimal source
                  </p>
                )}
                {sourceType === "gateway" && (
                  <p className="text-xs text-muted-foreground">
                    Use unified Gateway balance across all chains
                  </p>
                )}
              </div>

              {sourceType === "wallet" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="wallet-select">Select Wallet</Label>
                  <WalletSelect
                    value={walletSelectValue}
                    onValueChange={setWalletSelectValue}
                    onSelectWallet={(wallet) => {
                      setSelectedWallet(wallet);
                      setSelectedWalletId(wallet.circle_wallet_id);
                    }}
                    excludeGatewaySigner
                    minBalance={0}
                    chainFilter={BLOCKCHAIN_MAP[destinationChain]}
                  />
                  {selectedWalletId && selectedWallet && (
                    <p className="text-xs text-muted-foreground">
                      {selectedWallet.blockchain === BLOCKCHAIN_MAP[destinationChain]
                        ? "✓ Same-chain transfer (lower fees)" 
                        : "Cross-chain transfer via Gateway"}
                    </p>
                  )}
                </div>
              )}

              {/* Settlement Guarantees */}
              {address && amount && parseFloat(amount) > 0 && !addressError && !isInternalWallet && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-xs font-medium">Settlement Information</p>
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <IconClock className="size-3" />
                          <span>Estimated Time</span>
                        </div>
                        <span className="font-medium">~30-60 seconds</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <IconCoin className="size-3" />
                          <span>Estimated Fee</span>
                        </div>
                        <span className="font-medium">~$0.50-2.01 USDC</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <CheckCircle2 className="size-3" />
                          <span>Routing</span>
                        </div>
                        <span className="font-medium">Auto-selected</span>
                      </div>
                    </div>
                    <Alert className="text-xs py-2">
                      <Info className="h-3 w-3" />
                      <AlertDescription className="text-xs">
                        System will automatically use a wallet on {SUPPORTED_CHAINS.find(c => c.value === destinationChain)?.label || destinationChain} if available, or Gateway balance for cross-chain transfers.
                      </AlertDescription>
                    </Alert>
                  </div>
                </>
              )}

              {/* Blocked Alert */}
              {isBlocked && (
                <Alert variant="destructive" className="text-xs py-2">
                  <AlertTriangle className="h-3 w-3" />
                  <AlertDescription className="text-xs">
                    Address blocked due to compliance violations.
                  </AlertDescription>
                </Alert>
              )}

              {/* Review Warning */}
              {needsReview && showReviewWarning && (
                <Alert className="text-xs py-2">
                  <Info className="h-3 w-3" />
                  <AlertDescription className="text-xs">
                    This address requires review. Proceed with caution.
                  </AlertDescription>
                </Alert>
              )}
            </div>
            <Button
              size="sm"
              className="w-fit"
              onClick={handleSend}
              disabled={
                isBlocked ||
                !address ||
                !!addressError ||
                isCheckingCompliance ||
                isValidatingAddress ||
                isInternalWallet ||
                isSending ||
                canReceiveUSDC === false ||
                parseFloat(amount) <= 0
              }
            >
              {isSending ? (
                <>
                  <IconLoader2 className="size-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <IconSend />
                  {needsReview && !showReviewWarning ? "Review & Send" : "Send"}
                </>
              )}
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Compliance Details Dialog */}
      <ComplianceDetailsDialog
        open={showComplianceDetails}
        onOpenChange={(isOpen) => {
          setShowComplianceDetails(isOpen);
          // Don't affect the popover state
        }}
        complianceData={complianceData}
        address={address}
      />
    </>
  );
}
