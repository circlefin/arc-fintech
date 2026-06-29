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

/**
 * App Kit's `UnifiedBalanceChain` identifier strings for the chains we use.
 * Kept as a string-literal union local to this module so consumers don't
 * need to import the SDK to reference the type — and the constants module
 * stays free of any server-only imports.
 *
 * The values are the exact enum values from
 * `@circle-fin/app-kit`'s `UnifiedBalanceChain` enum.
 */
export type AppKitChain =
  | "Ethereum_Sepolia"
  | "Avalanche_Fuji"
  | "Base_Sepolia"
  | "Arc_Testnet";

/**
 * The set of blockchain identifiers used in the database/API. This is the
 * canonical "DB form" used in `wallets.blockchain`, `transactions.blockchain`,
 * Circle SDK requests for wallet creation, and the chain query param.
 */
export const SUPPORTED_BLOCKCHAINS = [
  "ETH-SEPOLIA",
  "AVAX-FUJI",
  "BASE-SEPOLIA",
  "ARC-TESTNET",
] as const;

export type SupportedBlockchain = (typeof SUPPORTED_BLOCKCHAINS)[number];

/** Gateway SDK's chain enum, keyed by DB blockchain string. */
export const SDK_CHAIN_BY_BLOCKCHAIN: Record<string, SupportedChain> = {
  "ETH-SEPOLIA": "ethSepolia",
  "AVAX-FUJI": "avalancheFuji",
  "BASE-SEPOLIA": "baseSepolia",
  "ARC-TESTNET": "arcTestnet",
};

/** Reverse of `SDK_CHAIN_BY_BLOCKCHAIN`. */
export const BLOCKCHAIN_BY_SDK_CHAIN: Record<SupportedChain, SupportedBlockchain> = {
  ethSepolia: "ETH-SEPOLIA",
  avalancheFuji: "AVAX-FUJI",
  baseSepolia: "BASE-SEPOLIA",
  arcTestnet: "ARC-TESTNET",
};

/** Human-friendly chain labels keyed by Gateway SDK chain name. */
export const CHAIN_LABEL_BY_SDK_CHAIN: Record<SupportedChain, string> = {
  ethSepolia: "Ethereum Sepolia",
  avalancheFuji: "Avalanche Fuji",
  baseSepolia: "Base Sepolia",
  arcTestnet: "Arc Testnet",
};

export const CHAIN_LABEL_BY_BLOCKCHAIN: Record<string, string> = {
  "ETH-SEPOLIA": "Ethereum Sepolia",
  "AVAX-FUJI": "Avalanche Fuji",
  "BASE-SEPOLIA": "Base Sepolia",
  "ARC-TESTNET": "Arc Testnet",
};

/**
 * App Kit chain identifier keyed by DB blockchain string. Used by the
 * Add Funds deposit route, the Gateway balance route, and the bridge
 * routes when calling `kit.unifiedBalance.*` and `kit.bridge` /
 * `kit.estimateBridge`.
 *
 * Typed with `string` keys (rather than `SupportedBlockchain`) so route
 * handlers that read `wallet.blockchain` from Supabase — which TS surfaces
 * as `string` — can index it directly. Zod schemas in `lib/api/validate.ts`
 * enforce the actual subset at request time.
 */
export const APP_KIT_CHAIN_BY_BLOCKCHAIN: Record<string, AppKitChain> = {
  "ETH-SEPOLIA": "Ethereum_Sepolia",
  "AVAX-FUJI": "Avalanche_Fuji",
  "BASE-SEPOLIA": "Base_Sepolia",
  "ARC-TESTNET": "Arc_Testnet",
};

/**
 * Reverse of `APP_KIT_CHAIN_BY_BLOCKCHAIN`. App Kit's `getBalances`
 * response identifies each chain by the SDK enum value — this map is how
 * we translate those rows back into our DB blockchain key for the per-chain
 * balance breakdown returned to the client.
 */
export const BLOCKCHAIN_BY_APP_KIT_CHAIN: Record<AppKitChain, SupportedBlockchain> = {
  Ethereum_Sepolia: "ETH-SEPOLIA",
  Avalanche_Fuji: "AVAX-FUJI",
  Base_Sepolia: "BASE-SEPOLIA",
  Arc_Testnet: "ARC-TESTNET",
};

/**
 * Circle's Gateway wallet contract address. Deposits "to Gateway" actually
 * land at this address; the dashboard distinguishes a "deposit" from a normal
 * outbound transfer by comparing tx.recipient_address to this constant.
 *
 * The same address is also exported from `lib/circle/gateway-sdk.ts` as
 * `GATEWAY_WALLET_ADDRESS`. Kept here so UI code does not have to import a
 * server-only module path.
 */
export const GATEWAY_WALLET_ADDRESS_LOWER =
  "0x0077777d7eba4688bdef3e311b846f25870a19b9";

export function isGatewayDepositRecipient(
  recipient: string | null | undefined
): boolean {
  return (
    typeof recipient === "string" &&
    recipient.toLowerCase() === GATEWAY_WALLET_ADDRESS_LOWER
  );
}
