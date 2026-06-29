/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it, vi } from "vitest";
import type { BridgeStep } from "@circle-fin/app-kit";
import type { CircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import {
  buildAppKitSendParams,
  getAppKitSendError,
  normalizeAppKitSendResult,
  sendUsdcOnSameChainWithAppKit,
} from "@/lib/circle/app-kit-send";

const adapter = {} as CircleWalletsAdapter;

describe("buildAppKitSendParams", () => {
  it("maps source blockchain to App Kit chain and builds USDC send params", () => {
    const params = buildAppKitSendParams(
      {
        sourceBlockchain: "ARC-TESTNET",
        sourceWalletAddress: "0xabc",
        recipientAddress: "0xdef",
        amount: "1.25",
      },
      adapter
    );

    expect(params).toEqual({
      from: {
        adapter,
        chain: "Arc_Testnet",
        address: "0xabc",
      },
      to: "0xdef",
      amount: "1.25",
      token: "USDC",
    });
  });

  it("throws for unsupported source blockchain values", () => {
    expect(() =>
      buildAppKitSendParams(
        {
          sourceBlockchain: "UNKNOWN-CHAIN",
          sourceWalletAddress: "0xabc",
          recipientAddress: "0xdef",
          amount: "1.25",
        },
        adapter
      )
    ).toThrow("Unsupported source blockchain: UNKNOWN-CHAIN");
  });
});

describe("normalizeAppKitSendResult", () => {
  it("prefers batchId as txId when available", () => {
    const normalized = normalizeAppKitSendResult({
      name: "send",
      state: "success",
      txHash: "0xhash",
      batchId: "bundle-1",
    } as BridgeStep);

    expect(normalized).toEqual({
      txId: "bundle-1",
      txHash: "0xhash",
    });
  });

  it("falls back to txHash as txId when batchId is not present", () => {
    const normalized = normalizeAppKitSendResult({
      name: "send",
      state: "success",
      txHash: "0xhash",
    } as BridgeStep);

    expect(normalized).toEqual({
      txId: "0xhash",
      txHash: "0xhash",
    });
  });

  it("throws when send returns no txHash or batchId", () => {
    expect(() =>
      normalizeAppKitSendResult({
        name: "send",
        state: "success",
      } as BridgeStep)
    ).toThrow("App Kit send returned no transaction identifier.");
  });
});

describe("sendUsdcOnSameChainWithAppKit", () => {
  it("calls estimateSend and send with constructed params", async () => {
    const estimateSend = vi.fn().mockResolvedValue({
      gas: BigInt(21000),
      gasPrice: BigInt(100),
      fee: "0.00042",
    });
    const send = vi.fn().mockResolvedValue({
      name: "send",
      state: "success",
      txHash: "0xsendhash",
      batchId: "bundle-42",
    } as BridgeStep);
    const createAdapter = vi.fn(() => adapter);
    const getKit = vi.fn(() => ({
      estimateSend,
      send,
    }));

    const result = await sendUsdcOnSameChainWithAppKit(
      {
        sourceBlockchain: "BASE-SEPOLIA",
        sourceWalletAddress: "0xsource",
        recipientAddress: "0xrecipient",
        amount: "2.5",
      },
      {
        getKit,
        createAdapter,
      }
    );

    expect(createAdapter).toHaveBeenCalledTimes(1);
    expect(getKit).toHaveBeenCalledTimes(2);
    expect(estimateSend).toHaveBeenCalledWith({
      from: {
        adapter,
        chain: "Base_Sepolia",
        address: "0xsource",
      },
      to: "0xrecipient",
      amount: "2.5",
      token: "USDC",
    });
    expect(send).toHaveBeenCalledWith({
      from: {
        adapter,
        chain: "Base_Sepolia",
        address: "0xsource",
      },
      to: "0xrecipient",
      amount: "2.5",
      token: "USDC",
    });
    expect(result).toEqual({
      txId: "bundle-42",
      txHash: "0xsendhash",
      estimatedFee: "0.00042",
    });
  });

  it("uses sourceWalletAddress as adapter.getAddress context for developer-controlled adapters", async () => {
    const rawAdapter = {
      getAddress: vi.fn().mockRejectedValue(new Error("should not be called")),
    } as unknown as CircleWalletsAdapter;

    const estimateSend = vi.fn().mockImplementation(async (params) => {
      const resolved = await (
        params.from.adapter as unknown as { getAddress: (chain: string) => Promise<string> }
      ).getAddress("Arc_Testnet");
      expect(resolved).toBe("0xresolved");
      return {
        gas: BigInt(21000),
        gasPrice: BigInt(100),
        fee: "0.00001",
      };
    });
    const send = vi.fn().mockImplementation(async (params) => {
      const resolved = await (
        params.from.adapter as unknown as { getAddress: (chain: string) => Promise<string> }
      ).getAddress("Arc_Testnet");
      expect(resolved).toBe("0xresolved");
      return {
        name: "send",
        state: "success",
        txHash: "0xabc",
      } as BridgeStep;
    });

    const result = await sendUsdcOnSameChainWithAppKit(
      {
        sourceBlockchain: "ARC-TESTNET",
        sourceWalletAddress: "0xresolved",
        recipientAddress: "0xrecipient",
        amount: "1.0",
      },
      {
        createAdapter: () => rawAdapter,
        getKit: () => ({
          estimateSend,
          send,
        }),
      }
    );

    expect(rawAdapter.getAddress).not.toHaveBeenCalled();
    expect(result.txId).toBe("0xabc");
  });
});

describe("getAppKitSendError", () => {
  it("maps known insufficient-balance error code", () => {
    expect(
      getAppKitSendError({
        code: 9001,
        message: "Insufficient USDC balance",
      })
    ).toEqual({
      status: 400,
      error: "Insufficient balance",
      userMessage: "Insufficient USDC balance",
    });
  });

  it("maps insufficient native token messages to gas errors", () => {
    expect(
      getAppKitSendError(
        new Error("Insufficient native token on Arc to pay gas")
      )
    ).toEqual({
      status: 400,
      error: "Insufficient gas",
      userMessage: "Insufficient native token on Arc to pay gas",
    });
  });

  it("returns generic transfer failed shape for unknown errors", () => {
    expect(getAppKitSendError(new Error("Boom"))).toEqual({
      status: 502,
      error: "Transfer failed",
      userMessage: "Boom",
    });
  });
});
