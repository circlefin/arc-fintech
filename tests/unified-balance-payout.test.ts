/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from "vitest";
import type { CircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import {
  buildUnifiedBalanceGatewayAllocatedSources,
  buildUnifiedBalanceGatewaySources,
  getUnifiedBalancePayoutError,
  normalizeUnifiedBalanceGatewaySpendResult,
  planUnifiedBalanceGatewayAllocations,
  shouldUseAutoGatewayFallback,
  type PayoutWalletBalance,
} from "@/lib/circle/unified-balance-payout";

const walletA = "0x1111111111111111111111111111111111111111";
const adapter = {} as CircleWalletsAdapter;

describe("buildUnifiedBalanceGatewaySources", () => {
  it("normalizes, deduplicates, and filters gateway source addresses", () => {
    expect(
      buildUnifiedBalanceGatewaySources(
        [" 0xAbC ", "0xabc", "", "0xdef", "   "],
        adapter
      )
    ).toEqual([
      { adapter, address: "0xabc" },
      { adapter, address: "0xdef" },
    ]);
  });

  it("supports adapter factories so each source can use a distinct adapter instance", () => {
    let calls = 0;
    const sources = buildUnifiedBalanceGatewaySources(
      ["0xabc", "0xdef"],
      () => ({ id: ++calls } as unknown as CircleWalletsAdapter)
    );

    expect(calls).toBe(2);
    expect(sources).toHaveLength(2);
    expect(sources[0].adapter).not.toBe(sources[1].adapter);
  });

  it("uses a signer address and maps each depositor to sourceAccount", () => {
    const sources = buildUnifiedBalanceGatewaySources(
      ["0xAbC", "0xDef"],
      adapter,
      " 0xSigner "
    );

    expect(sources).toEqual([
      {
        adapter,
        address: "0xsigner",
        sourceAccount: "0xabc",
      },
      {
        adapter,
        address: "0xsigner",
        sourceAccount: "0xdef",
      },
    ]);
  });
});

describe("planUnifiedBalanceGatewayAllocations", () => {
  it("deterministically allocates from the largest confirmed balances first", () => {
    const plan = planUnifiedBalanceGatewayAllocations(
      [
        {
          depositor: "0xAaA",
          breakdown: [
            { chain: "Arc_Testnet", confirmedBalance: "2.5" },
            { chain: "Base_Sepolia", confirmedBalance: "0.25" },
          ],
        },
        {
          depositor: "0xBbb",
          breakdown: [{ chain: "Base_Sepolia", confirmedBalance: "1.0" }],
        },
      ],
      ["0xaaa", "0xbbb"],
      "3"
    );

    expect(plan).toEqual({
      isSufficient: true,
      allocations: [
        {
          sourceAccount: "0xaaa",
          chain: "Arc_Testnet",
          amount: "2.5",
        },
        {
          sourceAccount: "0xbbb",
          chain: "Base_Sepolia",
          amount: "0.5",
        },
      ],
      requiredAmount: "3",
      availableAmount: "3.75",
      shortfallAmount: "0",
    });
  });

  it("returns an insufficient result with shortfall details when confirmed balance is too low", () => {
    const plan = planUnifiedBalanceGatewayAllocations(
      [
        {
          depositor: "0xAaA",
          breakdown: [{ chain: "Arc_Testnet", confirmedBalance: "1.2" }],
        },
        {
          depositor: "0xBbb",
          breakdown: [{ chain: "Base_Sepolia", confirmedBalance: "0.8" }],
        },
      ],
      ["0xaaa", "0xbbb"],
      "3"
    );

    expect(plan).toEqual({
      isSufficient: false,
      allocations: [
        {
          sourceAccount: "0xaaa",
          chain: "Arc_Testnet",
          amount: "1.2",
        },
        {
          sourceAccount: "0xbbb",
          chain: "Base_Sepolia",
          amount: "0.8",
        },
      ],
      requiredAmount: "3",
      availableAmount: "2",
      shortfallAmount: "1",
    });
  });
});

describe("buildUnifiedBalanceGatewayAllocatedSources", () => {
  it("groups allocations by source account and sets the signer as from.address", () => {
    let adapterCalls = 0;
    const sources = buildUnifiedBalanceGatewayAllocatedSources(
      [
        {
          sourceAccount: "0xAaA",
          chain: "Arc_Testnet",
          amount: "1.0",
        },
        {
          sourceAccount: "0xaaa",
          chain: "Base_Sepolia",
          amount: "0.5",
        },
        {
          sourceAccount: "0xbbb",
          chain: "Base_Sepolia",
          amount: "0.25",
        },
      ],
      () => ({ id: ++adapterCalls } as unknown as CircleWalletsAdapter),
      "0xSigner"
    );

    expect(adapterCalls).toBe(2);
    expect(sources).toEqual([
      {
        adapter: { id: 1 },
        address: "0xsigner",
        sourceAccount: "0xaaa",
        allocations: [
          { chain: "Arc_Testnet", amount: "1" },
          { chain: "Base_Sepolia", amount: "0.5" },
        ],
      },
      {
        adapter: { id: 2 },
        address: "0xsigner",
        sourceAccount: "0xbbb",
        allocations: [{ chain: "Base_Sepolia", amount: "0.25" }],
      },
    ]);
  });
});

describe("shouldUseAutoGatewayFallback", () => {
  it("does not fall back to Gateway when Auto finds a sufficient same-chain wallet", () => {
    const wallets: PayoutWalletBalance[] = [
      {
        walletId: "wallet-1",
        address: walletA,
        blockchain: "ARC-TESTNET",
        chain: "arcTestnet",
        balance: BigInt(5_000_000),
      },
    ];

    expect(shouldUseAutoGatewayFallback(wallets, "arcTestnet", BigInt(1_000_000))).toBe(false);
  });

  it("falls back to Gateway when Auto has no sufficient same-chain wallet", () => {
    const wallets: PayoutWalletBalance[] = [
      {
        walletId: "wallet-1",
        address: walletA,
        blockchain: "ETH-SEPOLIA",
        chain: "ethSepolia",
        balance: BigInt(5_000_000),
      },
    ];

    expect(shouldUseAutoGatewayFallback(wallets, "arcTestnet", BigInt(1_000_000))).toBe(true);
  });
});

describe("getUnifiedBalancePayoutError", () => {
  it("maps App Kit code 9001 (insufficient token) to a 400 with App Kit's chain-specific message", () => {
    expect(
      getUnifiedBalancePayoutError({
        code: 9001,
        message: "Insufficient USDC balance on Ethereum",
      })
    ).toEqual({
      status: 400,
      error: "Insufficient Gateway balance",
      userMessage: "Insufficient USDC balance on Ethereum",
    });
  });

  it("maps App Kit code 9002 (insufficient gas) to a distinct gas message instead of swallowing it as a balance error", () => {
    expect(
      getUnifiedBalancePayoutError({
        code: 9002,
        message: "Insufficient native token on Ethereum to cover gas fees",
      })
    ).toEqual({
      status: 400,
      error: "Insufficient gas",
      userMessage: "Insufficient native token on Ethereum to cover gas fees",
    });
  });

  it("maps App Kit code 9003 (insufficient allowance) to a distinct allowance message", () => {
    expect(
      getUnifiedBalancePayoutError({
        code: 9003,
        message: "Insufficient allowance for token transfer",
      })
    ).toEqual({
      status: 400,
      error: "Insufficient allowance",
      userMessage: "Insufficient allowance for token transfer",
    });
  });

  it("does not pattern-match `insufficient` in arbitrary App Kit messages without a known code", () => {
    const result = getUnifiedBalancePayoutError({
      message: "Some unrelated error mentioning insufficient context",
    });
    expect(result.status).toBe(502);
    expect(result.error).toBe("Gateway payout failed");
  });

  it("falls back to the generic gateway-payout-failed shape for unmapped errors", () => {
    expect(
      getUnifiedBalancePayoutError(new Error("Boom"))
    ).toEqual({
      status: 502,
      error: "Gateway payout failed",
      userMessage: "Boom",
    });
  });
});

describe("normalizeUnifiedBalanceGatewaySpendResult", () => {
  it("uses transferId as txId, maps source chain, and sums fee entries", () => {
    const result = normalizeUnifiedBalanceGatewaySpendResult(
      {
        txHash: "0xmint",
        transferId: "transfer-123",
        allocations: [
          {
            amount: "1.00",
            chain: "Base_Sepolia",
            sourceAccount: walletA,
          },
        ],
        fees: [
          { type: "provider", token: "USDC", amount: "0.10" },
          { type: "forwarder", token: "USDC", amount: "0.01" },
        ],
      } as any,
      "arcTestnet"
    );

    expect(result).toEqual({
      txId: "transfer-123",
      txHash: "0xmint",
      sourceChain: "baseSepolia",
      senderAddress: walletA,
      estimatedFeeUSDC: 0.11,
    });
  });

  it("falls back to txHash and fallback chain when allocation chain cannot be mapped", () => {
    const result = normalizeUnifiedBalanceGatewaySpendResult(
      {
        txHash: "0xmint",
        allocations: [{ amount: "1.00", chain: "Unknown_Chain" }],
        fees: [{ type: "provider", token: "USDC", amount: "not-a-number" }],
      } as any,
      "arcTestnet"
    );

    expect(result).toEqual({
      txId: "0xmint",
      txHash: "0xmint",
      sourceChain: "arcTestnet",
      senderAddress: undefined,
      estimatedFeeUSDC: 0,
    });
  });

  it("uses the largest allocation as the canonical source when multiple allocations exist", () => {
    const result = normalizeUnifiedBalanceGatewaySpendResult(
      {
        txHash: "0xmint",
        transferId: "transfer-789",
        allocations: [
          {
            amount: "0.3",
            chain: "Base_Sepolia",
            sourceAccount: "0x1111111111111111111111111111111111111111",
          },
          {
            amount: "1.25",
            chain: "Arc_Testnet",
            sourceAccount: "0x2222222222222222222222222222222222222222",
          },
        ],
        fees: [{ type: "provider", token: "USDC", amount: "0.03" }],
      } as any,
      "ethSepolia"
    );

    expect(result).toEqual({
      txId: "transfer-789",
      txHash: "0xmint",
      sourceChain: "arcTestnet",
      senderAddress: "0x2222222222222222222222222222222222222222",
      estimatedFeeUSDC: 0.03,
    });
  });
});
