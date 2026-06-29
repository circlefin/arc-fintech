/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppKit, type BridgeStep, type SendParams } from "@circle-fin/app-kit";
import {
  createCircleWalletsAdapter,
  type CircleWalletsAdapter,
} from "@circle-fin/adapter-circle-wallets";
import { APP_KIT_CHAIN_BY_BLOCKCHAIN, type AppKitChain } from "@/lib/constants/chains";

const NETWORK_TIMEOUT = 3002;
const BALANCE_INSUFFICIENT_TOKEN = 9001;
const BALANCE_INSUFFICIENT_GAS = 9002;

interface SendKitLike {
  estimateSend(params: SendParams): Promise<{ fee: string }>;
  send(params: SendParams): Promise<BridgeStep>;
}

interface SendDependencies {
  getKit: () => SendKitLike;
  createAdapter: () => CircleWalletsAdapter;
}

let cachedAppKit: AppKit | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getDefaultAppKit(): AppKit {
  if (!cachedAppKit) {
    cachedAppKit = new AppKit();
  }
  return cachedAppKit;
}

function createDefaultAdapter(): CircleWalletsAdapter {
  return createCircleWalletsAdapter({
    apiKey: requireEnv("CIRCLE_API_KEY"),
    entitySecret: requireEnv("CIRCLE_ENTITY_SECRET"),
  });
}

const defaultDependencies: SendDependencies = {
  getKit: () => getDefaultAppKit(),
  createAdapter: createDefaultAdapter,
};

export interface AppKitSendInput {
  sourceBlockchain: string;
  sourceWalletAddress: string;
  recipientAddress: string;
  amount: string;
}

export interface AppKitSendResult {
  txId: string;
  txHash?: string;
  estimatedFee?: string;
}

export interface AppKitSendErrorResult {
  status: number;
  error: string;
  userMessage: string;
}

export function buildAppKitSendParams(
  input: AppKitSendInput,
  adapter: CircleWalletsAdapter
): SendParams {
  const appKitChain = APP_KIT_CHAIN_BY_BLOCKCHAIN[input.sourceBlockchain];
  if (!appKitChain) {
    throw new Error(`Unsupported source blockchain: ${input.sourceBlockchain}`);
  }

  const sourceWalletAddress = input.sourceWalletAddress.trim();
  if (!sourceWalletAddress) {
    throw new Error("Missing source wallet address.");
  }

  return {
    from: {
      adapter,
      chain: appKitChain,
      address: sourceWalletAddress,
    },
    to: input.recipientAddress,
    amount: input.amount,
    token: "USDC",
  };
}

function withResolvedAddress(
  adapter: CircleWalletsAdapter,
  sourceWalletAddress: string
): CircleWalletsAdapter {
  const resolvedAddress = sourceWalletAddress.trim();
  if (!resolvedAddress) {
    throw new Error("Missing source wallet address.");
  }

  // App Kit send/estimateSend currently call adapter.getAddress() before
  // operation execution. For developer-controlled adapters, getAddress throws
  // unless an explicit operation-context address is used. We bridge that
  // behavior by returning a proxy that resolves getAddress from the source
  // wallet selected by the caller.
  return new Proxy(adapter as object, {
    get(target, property) {
      if (property === "getAddress") {
        return async () => resolvedAddress;
      }

      const value = Reflect.get(target, property, target);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  }) as CircleWalletsAdapter;
}

export function normalizeAppKitSendResult(step: BridgeStep): {
  txId: string;
  txHash?: string;
} {
  if (step.state === "error") {
    throw new Error(step.errorMessage || "App Kit send failed.");
  }

  const txHash =
    typeof step.txHash === "string" && step.txHash.length > 0
      ? step.txHash
      : undefined;
  const batchId =
    typeof step.batchId === "string" && step.batchId.length > 0
      ? step.batchId
      : undefined;
  const txId = batchId ?? txHash;

  if (!txId) {
    throw new Error("App Kit send returned no transaction identifier.");
  }

  return {
    txId,
    txHash,
  };
}

export async function sendUsdcOnSameChainWithAppKit(
  input: AppKitSendInput,
  dependencies: SendDependencies = defaultDependencies
): Promise<AppKitSendResult> {
  const adapter = withResolvedAddress(
    dependencies.createAdapter(),
    input.sourceWalletAddress
  );
  const params = buildAppKitSendParams(input, adapter);
  const estimate = await dependencies.getKit().estimateSend(params);
  const sendResult = await dependencies.getKit().send(params);
  const normalized = normalizeAppKitSendResult(sendResult);

  return {
    txId: normalized.txId,
    txHash: normalized.txHash,
    estimatedFee: estimate.fee,
  };
}

export function getAppKitSendError(error: unknown): AppKitSendErrorResult {
  const code =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null
        ? String((error as { message?: unknown }).message ?? "")
        : "";

  if (message.includes("Unsupported source blockchain")) {
    return {
      status: 400,
      error: "Unsupported source chain",
      userMessage: message,
    };
  }

  if (code === BALANCE_INSUFFICIENT_TOKEN) {
    return {
      status: 400,
      error: "Insufficient balance",
      userMessage: message || "Not enough USDC to complete this transfer.",
    };
  }

  if (
    code === BALANCE_INSUFFICIENT_GAS ||
    message.toLowerCase().includes("insufficient native token")
  ) {
    return {
      status: 400,
      error: "Insufficient gas",
      userMessage:
        message ||
        "The source wallet needs native tokens for gas to complete this transfer.",
    };
  }

  if (code === NETWORK_TIMEOUT) {
    return {
      status: 503,
      error: "Transfer timed out",
      userMessage:
        "Transfer is taking longer than expected. Please refresh the activity feed shortly.",
    };
  }

  return {
    status: 502,
    error: "Transfer failed",
    userMessage: message || "Transfer failed. Please try again.",
  };
}

export function toAppKitChainForBlockchain(
  blockchain: string
): AppKitChain | undefined {
  return APP_KIT_CHAIN_BY_BLOCKCHAIN[blockchain];
}
