/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import type { SupportedChain } from "@/lib/circle/gateway-sdk";
import type { CircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import type { SpendResult } from "@circle-fin/app-kit";
import {
  BLOCKCHAIN_BY_APP_KIT_CHAIN,
  SDK_CHAIN_BY_BLOCKCHAIN,
  type AppKitChain,
} from "@/lib/constants/chains";

export interface PayoutWalletBalance {
  walletId: string;
  address: string;
  blockchain: string;
  chain: SupportedChain;
  balance: bigint;
}

export interface GatewayPayoutErrorResult {
  status: number;
  error: string;
  userMessage: string;
}

export interface UnifiedBalanceGatewaySource {
  adapter: CircleWalletsAdapter;
  address: string;
  sourceAccount?: string;
}

export interface UnifiedBalanceGatewaySpendAllocation {
  sourceAccount: string;
  chain: AppKitChain;
  amount: string;
}

export interface UnifiedBalanceGatewayAllocatedSource
  extends UnifiedBalanceGatewaySource {
  sourceAccount: string;
  allocations: Array<{
    chain: AppKitChain;
    amount: string;
  }>;
}

export interface UnifiedBalanceBreakdownEntry {
  depositor: string;
  breakdown: Array<{
    chain: unknown;
    confirmedBalance: string;
  }>;
}

export interface UnifiedBalanceGatewayAllocationPlan {
  isSufficient: boolean;
  allocations: UnifiedBalanceGatewaySpendAllocation[];
  requiredAmount: string;
  availableAmount: string;
  shortfallAmount: string;
}

type CircleWalletsAdapterProvider =
  | CircleWalletsAdapter
  | (() => CircleWalletsAdapter);

const ZERO_BIGINT = BigInt(0);
const USDC_ATOMIC_MULTIPLIER = BigInt(1_000_000);
const USDC_AMOUNT_PATTERN = /^\d+(?:\.\d{1,6})?$/;

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function parseUsdcAmountToAtomicUnits(value: string): bigint {
  const normalized = value.trim();
  if (!USDC_AMOUNT_PATTERN.test(normalized)) {
    throw new Error(`Invalid USDC amount: ${value}`);
  }

  const [whole, fraction = ""] = normalized.split(".");
  const paddedFraction = `${fraction}000000`.slice(0, 6);
  return BigInt(whole) * USDC_ATOMIC_MULTIPLIER + BigInt(paddedFraction);
}

function formatUsdcAtomicUnits(value: bigint): string {
  const whole = value / USDC_ATOMIC_MULTIPLIER;
  const fraction = value % USDC_ATOMIC_MULTIPLIER;

  if (fraction === ZERO_BIGINT) {
    return whole.toString();
  }

  const fractionDigits = fraction.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractionDigits}`;
}

function toAppKitChainIdentifier(
  chainIdentifier: unknown
): AppKitChain | undefined {
  const rawChain =
    typeof chainIdentifier === "string"
      ? chainIdentifier
      : typeof chainIdentifier === "object" &&
          chainIdentifier !== null &&
          "chain" in chainIdentifier &&
          typeof (chainIdentifier as { chain?: unknown }).chain === "string"
        ? (chainIdentifier as { chain: string }).chain
        : undefined;

  if (!rawChain) return undefined;

  const normalizedCandidates = [
    rawChain,
    rawChain.replace(/[\s-]+/g, "_"),
  ] as AppKitChain[];

  for (const candidate of normalizedCandidates) {
    if (candidate in BLOCKCHAIN_BY_APP_KIT_CHAIN) {
      return candidate;
    }
  }

  return undefined;
}

export interface NormalizedUnifiedBalanceGatewaySpendResult {
  txId: string;
  txHash: string;
  sourceChain: SupportedChain;
  senderAddress?: string;
  estimatedFeeUSDC: number;
}

export function buildUnifiedBalanceGatewaySources(
  addresses: string[],
  adapterProvider: CircleWalletsAdapterProvider,
  signerAddress?: string
): UnifiedBalanceGatewaySource[] {
  const uniqueAddresses = Array.from(
    new Set(
      addresses
        .map((address) => address.trim().toLowerCase())
        .filter((address) => address.length > 0)
    )
  );

  const normalizedSignerAddress =
    typeof signerAddress === "string" ? signerAddress.trim().toLowerCase() : "";

  return uniqueAddresses.map((address) => {
    const adapter =
      typeof adapterProvider === "function"
        ? adapterProvider()
        : adapterProvider;

    if (normalizedSignerAddress.length > 0) {
      return {
        adapter,
        address: normalizedSignerAddress,
        sourceAccount: address,
      };
    }

    return {
      adapter,
      address,
    };
  });
}

export function planUnifiedBalanceGatewayAllocations(
  breakdown: UnifiedBalanceBreakdownEntry[],
  sourceAccounts: string[],
  amount: string
): UnifiedBalanceGatewayAllocationPlan {
  const requiredAtomicUnits = parseUsdcAmountToAtomicUnits(amount);
  const eligibleSourceAccounts = new Set(
    sourceAccounts
      .map((sourceAccount) => normalizeAddress(sourceAccount))
      .filter((sourceAccount) => sourceAccount.length > 0)
  );

  type AllocationCandidate = {
    sourceAccount: string;
    chain: AppKitChain;
    confirmedAtomicUnits: bigint;
  };

  const candidates: AllocationCandidate[] = [];
  let availableAtomicUnits = ZERO_BIGINT;

  for (const sourceBreakdown of breakdown) {
    const sourceAccount = normalizeAddress(sourceBreakdown.depositor);
    if (
      sourceAccount.length === 0 ||
      !eligibleSourceAccounts.has(sourceAccount)
    ) {
      continue;
    }

    for (const chainBreakdown of sourceBreakdown.breakdown ?? []) {
      const chain = toAppKitChainIdentifier(chainBreakdown.chain);
      if (!chain) continue;

      const confirmedBalance = chainBreakdown.confirmedBalance?.trim();
      if (!confirmedBalance || !USDC_AMOUNT_PATTERN.test(confirmedBalance)) {
        continue;
      }

      const confirmedAtomicUnits =
        parseUsdcAmountToAtomicUnits(confirmedBalance);
      if (confirmedAtomicUnits <= ZERO_BIGINT) {
        continue;
      }

      candidates.push({
        sourceAccount,
        chain,
        confirmedAtomicUnits,
      });
      availableAtomicUnits += confirmedAtomicUnits;
    }
  }

  candidates.sort((left, right) => {
    if (left.confirmedAtomicUnits !== right.confirmedAtomicUnits) {
      return left.confirmedAtomicUnits > right.confirmedAtomicUnits ? -1 : 1;
    }

    const sourceAccountCompare = left.sourceAccount.localeCompare(
      right.sourceAccount
    );
    if (sourceAccountCompare !== 0) {
      return sourceAccountCompare;
    }

    return left.chain.localeCompare(right.chain);
  });

  const plannedAllocations: UnifiedBalanceGatewaySpendAllocation[] = [];
  let remainingAtomicUnits = requiredAtomicUnits;

  for (const candidate of candidates) {
    if (remainingAtomicUnits <= ZERO_BIGINT) {
      break;
    }

    const allocationAtomicUnits =
      candidate.confirmedAtomicUnits < remainingAtomicUnits
        ? candidate.confirmedAtomicUnits
        : remainingAtomicUnits;
    if (allocationAtomicUnits <= ZERO_BIGINT) {
      continue;
    }

    plannedAllocations.push({
      sourceAccount: candidate.sourceAccount,
      chain: candidate.chain,
      amount: formatUsdcAtomicUnits(allocationAtomicUnits),
    });

    remainingAtomicUnits -= allocationAtomicUnits;
  }

  return {
    isSufficient: remainingAtomicUnits === ZERO_BIGINT,
    allocations: plannedAllocations,
    requiredAmount: formatUsdcAtomicUnits(requiredAtomicUnits),
    availableAmount: formatUsdcAtomicUnits(availableAtomicUnits),
    shortfallAmount: formatUsdcAtomicUnits(
      remainingAtomicUnits > ZERO_BIGINT ? remainingAtomicUnits : ZERO_BIGINT
    ),
  };
}

export function buildUnifiedBalanceGatewayAllocatedSources(
  allocations: UnifiedBalanceGatewaySpendAllocation[],
  adapterProvider: CircleWalletsAdapterProvider,
  signerAddress: string
): UnifiedBalanceGatewayAllocatedSource[] {
  const normalizedSignerAddress = normalizeAddress(signerAddress);
  if (normalizedSignerAddress.length === 0) {
    return [];
  }

  const groupedSources = new Map<string, UnifiedBalanceGatewayAllocatedSource>();

  for (const allocation of allocations) {
    const sourceAccount = normalizeAddress(allocation.sourceAccount);
    const chain = toAppKitChainIdentifier(allocation.chain);

    if (sourceAccount.length === 0 || !chain) {
      continue;
    }

    const allocationAtomicUnits = parseUsdcAmountToAtomicUnits(allocation.amount);
    if (allocationAtomicUnits <= ZERO_BIGINT) {
      continue;
    }

    const normalizedAmount = formatUsdcAtomicUnits(allocationAtomicUnits);

    let source = groupedSources.get(sourceAccount);
    if (!source) {
      const adapter =
        typeof adapterProvider === "function"
          ? adapterProvider()
          : adapterProvider;
      source = {
        adapter,
        address: normalizedSignerAddress,
        sourceAccount,
        allocations: [],
      };
      groupedSources.set(sourceAccount, source);
    }

    source.allocations.push({
      chain,
      amount: normalizedAmount,
    });
  }

  return Array.from(groupedSources.values());
}

function mapAppKitChainToSupportedChain(
  chainIdentifier: unknown
): SupportedChain | undefined {
  const appKitChain = toAppKitChainIdentifier(chainIdentifier);
  if (!appKitChain) return undefined;

  const blockchain = BLOCKCHAIN_BY_APP_KIT_CHAIN[appKitChain];
  return SDK_CHAIN_BY_BLOCKCHAIN[blockchain];
}

export function normalizeUnifiedBalanceGatewaySpendResult(
  result: SpendResult,
  fallbackSourceChain: SupportedChain
): NormalizedUnifiedBalanceGatewaySpendResult {
  const normalizedAllocations = (result.allocations ?? []).map((allocation) => {
    const parsedAmount =
      typeof allocation.amount === "string" &&
      USDC_AMOUNT_PATTERN.test(allocation.amount)
        ? parseUsdcAmountToAtomicUnits(allocation.amount)
        : ZERO_BIGINT;

    const sourceAccount =
      typeof allocation.sourceAccount === "string"
        ? normalizeAddress(allocation.sourceAccount)
        : undefined;

    return {
      chain: allocation.chain,
      sourceAccount,
      parsedAmount,
    };
  });

  const primaryAllocation = [...normalizedAllocations].sort((left, right) => {
    if (left.parsedAmount !== right.parsedAmount) {
      return left.parsedAmount > right.parsedAmount ? -1 : 1;
    }

    const sourceCompare = (left.sourceAccount ?? "").localeCompare(
      right.sourceAccount ?? ""
    );
    if (sourceCompare !== 0) {
      return sourceCompare;
    }

    return (toAppKitChainIdentifier(left.chain) ?? "").localeCompare(
      toAppKitChainIdentifier(right.chain) ?? ""
    );
  })[0];

  const sourceChainFromAllocation = mapAppKitChainToSupportedChain(
    primaryAllocation?.chain
  );
  const senderAddress =
    primaryAllocation?.sourceAccount ??
    normalizedAllocations.find((allocation) => allocation.sourceAccount)
      ?.sourceAccount;
  const estimatedFeeUSDC = (result.fees ?? []).reduce((total, fee) => {
    const parsed = Number.parseFloat(fee.amount);
    return Number.isFinite(parsed) ? total + parsed : total;
  }, 0);

  return {
    txId: result.transferId ?? result.txHash,
    txHash: result.txHash,
    sourceChain: sourceChainFromAllocation ?? fallbackSourceChain,
    senderAddress,
    estimatedFeeUSDC,
  };
}

export function shouldUseAutoGatewayFallback(
  walletBalances: PayoutWalletBalance[],
  destinationChain: SupportedChain,
  amountInAtomicUnits: bigint
): boolean {
  return !walletBalances.some(
    (wallet) =>
      wallet.chain === destinationChain && wallet.balance >= amountInAtomicUnits
  );
}

// Error mapper for App Kit `unifiedBalance` failures bubbling out of
// `kit.unifiedBalance.spend`. We dispatch on App Kit's structured `code`
// rather than string-matching the message — earlier versions matched on
// `"insufficient"`, which silently re-classified gas/allowance errors
// (`Insufficient native token on …`, `Insufficient allowance …`) as "no
// Gateway balance", hiding the real cause from the user. App Kit codes:
//   9001  BALANCE_INSUFFICIENT_TOKEN     (USDC)
//   9002  BALANCE_INSUFFICIENT_GAS       (native token for gas)
//   9003  BALANCE_INSUFFICIENT_ALLOWANCE (ERC-20 allowance)
//   3002  network timeout
const BALANCE_INSUFFICIENT_TOKEN = 9001;
const BALANCE_INSUFFICIENT_GAS = 9002;
const BALANCE_INSUFFICIENT_ALLOWANCE = 9003;
const NETWORK_TIMEOUT = 3002;

export function getUnifiedBalancePayoutError(
  error: unknown
): GatewayPayoutErrorResult {
  const code = typeof error === "object" && error !== null
    ? (error as { code?: unknown }).code
    : undefined;
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null
      ? String((error as { message?: unknown }).message ?? "")
      : "";

  if (code === BALANCE_INSUFFICIENT_TOKEN) {
    return {
      status: 400,
      error: "Insufficient Gateway balance",
      userMessage:
        message ||
        "Not enough confirmed Gateway Balance to complete this payout.",
    };
  }

  if (code === BALANCE_INSUFFICIENT_GAS) {
    return {
      status: 400,
      error: "Insufficient gas",
      userMessage:
        message ||
        "The destination wallet needs native tokens (gas) to complete the transfer.",
    };
  }

  if (code === BALANCE_INSUFFICIENT_ALLOWANCE) {
    return {
      status: 400,
      error: "Insufficient allowance",
      userMessage:
        message ||
        "The Gateway contract doesn't have enough USDC allowance from your wallet.",
    };
  }

  if (code === NETWORK_TIMEOUT) {
    return {
      status: 503,
      error: "Gateway payout timed out",
      userMessage:
        "Gateway payout is taking longer than expected. Refresh balances shortly.",
    };
  }

  return {
    status: 502,
    error: "Gateway payout failed",
    userMessage: message || "Gateway payout failed. Please try again.",
  };
}
