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

/**
 * Creates EOA (Externally Owned Account) wallets for Gateway signing across all chains using Circle Wallets SDK
 * The same wallet ID will be used across all EVM chains (since Circle wallets derive to same address)
 * These wallets will be used to sign Gateway burn intents and must deposit funds to Gateway
 */

import { createClient } from "@/lib/supabase/server";
import { circleDeveloperSdk } from "@/lib/circle/developer-controlled-wallets-client";

export interface GatewayEOAWallet {
  chain: string;
  address: string;
  walletId: string;
  name: string;
}

/**
 * Create EOA wallets using Circle Wallets SDK
 * Creates wallets on all supported chains
 * Circle SDK automatically derives the same address across EVM chains
 */
export async function generateGatewayEOAWallets(walletSetId: string): Promise<GatewayEOAWallet[]> {
  const chains = [
    { id: "ETH-SEPOLIA", name: "Ethereum Sepolia Gateway Signer" },
    { id: "BASE-SEPOLIA", name: "Base Sepolia Gateway Signer" },
    { id: "AVAX-FUJI", name: "Avalanche Fuji Gateway Signer" },
    { id: "ARC-TESTNET", name: "Arc Testnet Gateway Signer" },
  ];

  // Create EOA wallets using Circle SDK - one wallet per chain
  const response = await circleDeveloperSdk.createWallets({
    walletSetId,
    accountType: "EOA", // Explicitly specify EOA type
    blockchains: chains.map(c => c.id) as any[],
    count: 1, // 1 wallet per blockchain
  });

  if (!response.data?.wallets) {
    throw new Error("Failed to create Gateway EOA wallets via Circle SDK");
  }

  const wallets = response.data.wallets;
  console.log(`Created ${wallets.length} Gateway EOA wallets via Circle SDK`);

  // Map Circle SDK wallets to our format
  return wallets.map((wallet) => ({
    chain: wallet.blockchain,
    address: wallet.address,
    walletId: wallet.id, // Use Circle wallet ID instead of private key
    name: wallet.name || `Gateway Signer - ${wallet.blockchain}`,
  }));
}

/**
 * Create wallet set and Gateway EOA wallets for a user
 * First creates a wallet set, then creates EOA wallets within that set
 */
export async function storeGatewayEOAWalletsForUser(userId: string) {
  const supabase = await createClient();

  // Step 1: Create a wallet set for this user
  const walletSetResponse = await circleDeveloperSdk.createWalletSet({
    name: `Gateway Signers - User ${userId.substring(0, 8)}`,
  });

  if (!walletSetResponse.data?.walletSet) {
    throw new Error("Failed to create wallet set via Circle SDK");
  }

  const walletSetId = walletSetResponse.data.walletSet.id;
  console.log(`Created wallet set ${walletSetId} for user ${userId}`);

  // Step 2: Create EOA wallets in the wallet set
  const wallets = await generateGatewayEOAWallets(walletSetId);

  // Step 3: Store wallet information in database
  // Store Circle wallet ID in the circle_wallet_id column
  const insertData = wallets.map((wallet) => ({
    user_id: userId,
    name: wallet.name,
    address: wallet.address,
    blockchain: wallet.chain,
    type: "gateway_signer", // Special type for Gateway EOA wallets
    circle_wallet_id: wallet.walletId, // Store Circle's wallet ID, not private key
  }));

  const { data, error } = await supabase
    .from("wallets")
    .insert(insertData)
    .select();

  if (error) {
    console.error("Error storing Gateway EOA wallets:", error);
    throw error;
  }

  console.log(
    `Stored ${wallets.length} Gateway EOA wallets for user ${userId} with shared address ${wallets[0].address}`
  );
  return data;
}

/**
 * Get Gateway EOA wallet ID for a user on a specific blockchain
 * Returns the Circle wallet ID which can be used with Circle SDK for transactions
 */
export async function getGatewayEOAWalletId(
  userId: string,
  blockchain: string
): Promise<{ walletId: string; address: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("wallets")
    .select("circle_wallet_id, address")
    .eq("user_id", userId)
    .eq("blockchain", blockchain)
    .eq("type", "gateway_signer")
    .single();

  if (error || !data) {
    throw new Error(`Gateway EOA wallet not found for user ${userId} on ${blockchain}`);
  }

  return {
    walletId: data.circle_wallet_id,
    address: data.address,
  };
}
