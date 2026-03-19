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

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { circleDeveloperSdk } from "@/lib/circle/developer-controlled-wallets-client";
import { 
  signAndSubmitGatewayBurnIntent,
  executeGatewayMint,
  transferUnifiedBalanceCircle,
  CIRCLE_CHAIN_NAMES,
  type SupportedChain,
  getUsdcBalance,
  fetchGatewayBalance,
  GATEWAY_MINTER_ADDRESS,
  submitBurnIntent,
  DOMAIN_IDS,
  USDC_ADDRESSES,
  GATEWAY_WALLET_ADDRESS,
} from "@/lib/circle/gateway-sdk";
import { CHAIN_TO_USDC_ADDRESS } from "@/lib/constants/usdc-addresses";
import type { Address, Hash } from "viem";
import { randomBytes } from "crypto";
import { maxUint256, zeroAddress, pad } from "viem";

const BLOCKCHAIN_TO_CHAIN: Record<string, SupportedChain> = {
  "ETH-SEPOLIA": "ethSepolia",
  "BASE-SEPOLIA": "baseSepolia",
  "AVAX-FUJI": "avalancheFuji",
  "ARC-TESTNET": "arcTestnet",
};

const CHAIN_TO_BLOCKCHAIN: Record<SupportedChain, string> = {
  "ethSepolia": "ETH-SEPOLIA",
  "baseSepolia": "BASE-SEPOLIA",
  "avalancheFuji": "AVAX-FUJI",
  "arcTestnet": "ARC-TESTNET",
};

const CHAIN_LABELS: Record<SupportedChain, string> = {
  "ethSepolia": "Ethereum Sepolia",
  "baseSepolia": "Base Sepolia",
  "avalancheFuji": "Avalanche Fuji",
  "arcTestnet": "Arc Testnet",
};

// Gateway fee estimates per chain (in USDC)
// Based on https://developers.circle.com/gateway/references/fees
const GATEWAY_FEES: Record<SupportedChain, number> = {
  "ethSepolia": 2.01,     // Ethereum: ~$2.01
  "baseSepolia": 0.01,    // Base: ~$0.01
  "avalancheFuji": 0.50,  // Avalanche: ~$0.50
  "arcTestnet": 0.01,     // Arc: ~$0.01 (estimate, similar to Base)
};

function convertToSmallestUnit(amount: string): string {
  const val = parseFloat(amount);
  if (isNaN(val)) return "0";
  return BigInt(Math.floor(val * 1_000_000)).toString();
}

function addressToBytes32(address: Address): `0x${string}` {
  return pad(address.toLowerCase() as Address, { size: 32 });
}

const EIP712Domain = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
] as const;

const TransferSpec = [
  { name: "version", type: "uint32" },
  { name: "sourceDomain", type: "uint32" },
  { name: "destinationDomain", type: "uint32" },
  { name: "sourceContract", type: "bytes32" },
  { name: "destinationContract", type: "bytes32" },
  { name: "sourceToken", type: "bytes32" },
  { name: "destinationToken", type: "bytes32" },
  { name: "sourceDepositor", type: "bytes32" },
  { name: "destinationRecipient", type: "bytes32" },
  { name: "sourceSigner", type: "bytes32" },
  { name: "destinationCaller", type: "bytes32" },
  { name: "value", type: "uint256" },
  { name: "salt", type: "bytes32" },
  { name: "hookData", type: "bytes" },
] as const;

const BurnIntent = [
  { name: "maxBlockHeight", type: "uint256" },
  { name: "maxFee", type: "uint256" },
  { name: "spec", type: "TransferSpec" },
] as const;

interface BurnIntentSpec {
  version: number;
  sourceDomain: number;
  destinationDomain: number;
  sourceContract: Address;
  destinationContract: Address;
  sourceToken: Address;
  destinationToken: Address;
  sourceDepositor: Address;
  destinationRecipient: Address;
  sourceSigner: Address;
  destinationCaller: Address;
  value: bigint;
  salt: `0x${string}`;
  hookData: `0x${string}`;
}

interface BurnIntentData {
  maxBlockHeight: bigint;
  maxFee: bigint;
  spec: BurnIntentSpec;
}

function burnIntentTypedData(burnIntent: BurnIntentData) {
  const domain = {
    name: "GatewayWallet",
    version: "1",
  };
  return {
    types: { EIP712Domain, TransferSpec, BurnIntent },
    domain,
    primaryType: "BurnIntent" as const,
    message: {
      ...burnIntent,
      spec: {
        ...burnIntent.spec,
        sourceContract: addressToBytes32(burnIntent.spec.sourceContract),
        destinationContract: addressToBytes32(burnIntent.spec.destinationContract),
        sourceToken: addressToBytes32(burnIntent.spec.sourceToken),
        destinationToken: addressToBytes32(burnIntent.spec.destinationToken),
        sourceDepositor: addressToBytes32(burnIntent.spec.sourceDepositor),
        destinationRecipient: addressToBytes32(burnIntent.spec.destinationRecipient),
        sourceSigner: addressToBytes32(burnIntent.spec.sourceSigner),
        destinationCaller: addressToBytes32(burnIntent.spec.destinationCaller),
      },
    },
  };
}

async function getCircleWalletAddress(walletId: string): Promise<Address> {
  const response = await circleDeveloperSdk.getWallet({ id: walletId });
  if (!response.data?.wallet?.address) {
    throw new Error(`Could not fetch address for wallet ID: ${walletId}`);
  }
  return response.data.wallet.address as Address;
}

async function signBurnIntentCircle(
  walletId: string,
  burnIntentData: BurnIntentData
): Promise<`0x${string}`> {
  const typedData = burnIntentTypedData(burnIntentData);

  // Serialize bigints to strings first
  const serializedData = JSON.stringify(typedData, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  );

  // Parse and convert all numeric fields in message.spec to strings
  const parsed = JSON.parse(serializedData);
  if (parsed.message?.spec) {
    parsed.message.spec.version = String(parsed.message.spec.version);
    parsed.message.spec.sourceDomain = String(parsed.message.spec.sourceDomain);
    parsed.message.spec.destinationDomain = String(parsed.message.spec.destinationDomain);
  }

  const finalData = JSON.stringify(parsed);
  console.log("Final typed data being sent to Circle:", finalData);

  try {
    const response = await circleDeveloperSdk.signTypedData({
      walletId,
      data: finalData,
    });

    const signature = response.data?.signature;

    if (!signature) {
      throw new Error("Failed to retrieve signature from Circle API.");
    }

    return signature as `0x${string}`;
  } catch (error: any) {
    console.error("Circle signTypedData error:", error?.response?.data || error);
    console.error("Data that failed:", finalData);
    throw error;
  }
}

interface ChallengeResponse {
  id: string;
}

async function waitForTransactionConfirmation(challengeId: string) {
  while (true) {
    const response = await circleDeveloperSdk.getTransaction({ id: challengeId });
    const tx = response.data?.transaction;

    if (tx?.state === "CONFIRMED" || tx?.state === "COMPLETE") {
      console.log(`Transaction ${challengeId} reached terminal state '${tx.state}' with hash: ${tx.txHash}`);
      if (!tx.txHash) {
        throw new Error(`Transaction ${challengeId} is ${tx.state} but txHash is missing.`);
      }
      return tx;
    } else if (tx?.state === "FAILED") {
      console.error("Circle API Error:", tx);
      throw new Error(`Transaction ${challengeId} failed with reason: ${tx.errorReason}`);
    }

    console.log(`Transaction ${challengeId} state: ${tx?.state}. Polling again in 2s...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

interface WalletBalance {
  walletId: string;
  address: string;
  blockchain: string;
  chain: SupportedChain;
  balance: bigint;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { 
      recipientAddress, 
      amount, 
      destinationChain: requestedChain,
      sourceType = "auto",
      sourceWalletId 
    } = body;

    if (!recipientAddress || !amount) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const amountInAtomicUnits = BigInt(convertToSmallestUnit(amount));
    const destinationChain: SupportedChain = requestedChain || "arcTestnet";

    // Fetch user's wallets
    const { data: wallets, error: walletsError } = await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", user.id);

    if (walletsError || !wallets || wallets.length === 0) {
      return NextResponse.json(
        { error: "No wallets found" },
        { status: 404 }
      );
    }

    // Get wallet balances
    const walletBalances: WalletBalance[] = [];
    for (const wallet of wallets) {
      const chain = BLOCKCHAIN_TO_CHAIN[wallet.blockchain];
      if (!chain) continue;

      try {
        const balance = await getUsdcBalance(wallet.address as Address, chain);
        walletBalances.push({
          walletId: wallet.circle_wallet_id,
          address: wallet.address,
          blockchain: wallet.blockchain,
          chain,
          balance,
        });
      } catch (error) {
        console.error(`Error fetching balance for wallet ${wallet.id}:`, error);
      }
    }

    // Routing logic based on source type
    let sourceWallet: WalletBalance | undefined;
    let depositorWallet: typeof wallets[0] | undefined; // Wallet that has the Gateway balance
    let strategy: "same-chain" | "gateway" = "same-chain";
    let estimatedFee = 0.50;
    let estimatedTime = 30;
    let useGateway = false;

    if (sourceType === "wallet" && sourceWalletId) {
      // User selected a specific wallet
      const selectedWallet = walletBalances.find(w => w.walletId === sourceWalletId);
      
      if (!selectedWallet) {
        return NextResponse.json(
          { error: "Selected wallet not found" },
          { status: 404 }
        );
      }

      if (selectedWallet.balance < amountInAtomicUnits) {
        return NextResponse.json(
          { 
            error: "Insufficient balance",
            userMessage: `Selected wallet has insufficient USDC balance. Available: ${Number(selectedWallet.balance) / 1_000_000} USDC, Required: ${amountNum} USDC.`
          },
          { status: 400 }
        );
      }

      sourceWallet = selectedWallet;

      // Check if it's same-chain or cross-chain
      if (selectedWallet.chain === destinationChain) {
        strategy = "same-chain";
        estimatedFee = 0.50;
        estimatedTime = 30;
        useGateway = false;
      } else {
        strategy = "gateway";
        estimatedFee = 2.01;
        estimatedTime = 60;
        useGateway = true;
      }

      console.log(`User selected wallet: ${sourceWallet.walletId} on ${sourceWallet.chain}`);
    } else if (sourceType === "gateway") {
      // User wants to use Gateway balance specifically
      // Check Gateway balance for ALL wallet addresses (both SCA and EOA)
      // Any wallet can deposit to Gateway, but we need an EOA to sign the burn intent
      
      // First, ensure we have an EOA signer for signing burn intents
      const { data: eoaWallets, error: eoaError } = await supabase
        .from("wallets")
        .select("*")
        .eq("user_id", user.id)
        .eq("type", "gateway_signer");

      if (eoaError || !eoaWallets || eoaWallets.length === 0) {
        return NextResponse.json(
          { error: "No Gateway EOA signers found. Please create Gateway signer wallets first." },
          { status: 404 }
        );
      }

      // Check Gateway balance for ALL user wallet addresses (SCA wallets can deposit too!)
      // We'll check all wallets to find which has deposited to Gateway
      
      let bestSourceChain: SupportedChain | undefined;
      let maxBalanceOnSingleChain = BigInt(0);
      let selectedChainFee = 0;

      // Get unique wallet addresses from ALL wallets (not just EOAs)
      const uniqueAddresses = Array.from(new Set(wallets.map(w => w.address.toLowerCase())));
      console.log(`Checking Gateway balance for ${uniqueAddresses.length} unique wallet address(es)`);
      
      // Check each unique address's Gateway balance
      for (const addressStr of uniqueAddresses) {
        const walletAddress = addressStr as Address;
        
        try {
          console.log(`Checking Gateway balance for wallet ${walletAddress}`);
          const gatewayBalance = await fetchGatewayBalance(walletAddress);
          
          if (gatewayBalance.balances && Array.isArray(gatewayBalance.balances)) {
            // Check each domain for this EOA
            for (const bal of gatewayBalance.balances) {
              const balanceNum = parseFloat(bal.balance);
              const balanceInAtomicUnits = BigInt(Math.floor(balanceNum * 1_000_000));
              
              // Map domain to chain
              const { CHAIN_BY_DOMAIN } = await import("@/lib/circle/gateway-sdk");
              const chainName = CHAIN_BY_DOMAIN[bal.domain];
              const chain = chainName as SupportedChain;
              
              const chainFee = GATEWAY_FEES[chain] || 2.01;
              const requiredWithFee = amountInAtomicUnits + BigInt(Math.floor(chainFee * 1_000_000));
              
              console.log(`  Gateway balance on ${chain}: ${balanceNum} USDC (fee: $${chainFee}, required: $${Number(requiredWithFee) / 1_000_000})`);
              
              // Prefer chain with sufficient balance, or track the one with most balance
              if (balanceInAtomicUnits >= requiredWithFee && balanceInAtomicUnits > maxBalanceOnSingleChain) {
                maxBalanceOnSingleChain = balanceInAtomicUnits;
                bestSourceChain = chain;
                selectedChainFee = chainFee;
                depositorWallet = wallets.find(w => 
                  w.address.toLowerCase() === walletAddress.toLowerCase()
                );
              } else if (!bestSourceChain && balanceInAtomicUnits > maxBalanceOnSingleChain) {
                // Track chain with most balance even if insufficient
                maxBalanceOnSingleChain = balanceInAtomicUnits;
                bestSourceChain = chain;
                selectedChainFee = chainFee;
                depositorWallet = wallets.find(w => 
                  w.address.toLowerCase() === walletAddress.toLowerCase()
                );
              }
            }
          }
        } catch (error) {
          console.error(`  Error checking Gateway balance for ${walletAddress}:`, error);
        }
      }

      if (!depositorWallet || !bestSourceChain) {
        return NextResponse.json(
          { 
            error: "No Gateway balance found",
            userMessage: `No Gateway balance available across your wallets. Please deposit USDC to Gateway from any of your wallets first.`
          },
          { status: 400 }
        );
      }

      const requiredWithFee = amountInAtomicUnits + BigInt(Math.floor(selectedChainFee * 1_000_000));
      if (maxBalanceOnSingleChain < requiredWithFee) {
        const totalAvailable = Number(maxBalanceOnSingleChain) / 1_000_000;
        const totalRequired = Number(requiredWithFee) / 1_000_000;
        return NextResponse.json(
          { 
            error: "Insufficient Gateway balance on single chain",
            userMessage: `Need ${totalRequired.toFixed(2)} USDC on ${CHAIN_LABELS[bestSourceChain]} (${amountNum} + $${selectedChainFee} fee). Available: ${totalAvailable.toFixed(2)} USDC. Gateway balances are per-chain and cannot be combined.`
          },
          { status: 400 }
        );
      }

      // Use any Circle wallet for minting (doesn't need balance), but EOA will sign
      sourceWallet = walletBalances.length > 0 ? walletBalances[0] : undefined;
      
      if (!sourceWallet) {
        return NextResponse.json(
          { error: "No wallets found" },
          { status: 404 }
        );
      }

      // Set the source chain to where the Gateway balance actually is
      sourceWallet.chain = bestSourceChain;

      useGateway = true;
      strategy = "gateway";
      estimatedFee = selectedChainFee; // Use actual chain fee
      estimatedTime = 60;
      console.log(`User selected Gateway balance. Total: ${Number(maxBalanceOnSingleChain) / 1_000_000} USDC from depositor ${depositorWallet.address} on ${bestSourceChain}`);
    } else {
      // Auto mode: Try same-chain first (optimal)
      sourceWallet = walletBalances.find(
        (w) => w.chain === destinationChain && w.balance >= amountInAtomicUnits
      );

      if (!sourceWallet) {
        // No wallet on destination chain - check Gateway balance using EOA addresses
        // Get Gateway EOA wallets to check their deposited balances
        const { data: gatewayWallets, error: gwError } = await supabase
          .from("wallets")
          .select("*")
          .eq("user_id", user.id)
          .eq("type", "gateway_signer");

        if (gwError || !gatewayWallets || gatewayWallets.length === 0) {
          return NextResponse.json(
            { 
              error: "No funds available",
              userMessage: `No USDC available on ${CHAIN_LABELS[destinationChain]} and no Gateway balance. Please add funds or use a different chain.`
            },
            { status: 400 }
          );
        }

        // Check Gateway balance for ALL unique EOA addresses
        // We need to check all unique addresses to find which has sufficient balance
        let maxGatewayBalance = BigInt(0);
        let bestSourceChain: SupportedChain | undefined;
        let eoaAddressWithBalance: Address | undefined;

        // Get unique EOA addresses
        const uniqueEOAs = Array.from(new Set(gatewayWallets.map(w => w.address.toLowerCase())));
        console.log(`Auto mode: Checking Gateway balance for ${uniqueEOAs.length} unique EOA address(es)`);

        for (const eoaAddressStr of uniqueEOAs) {
          const eoaAddress = eoaAddressStr as Address;
          
          try {
            console.log(`  Checking Gateway balance for EOA ${eoaAddress}`);
            const gatewayBalance = await fetchGatewayBalance(eoaAddress);
            
            if (gatewayBalance.balances && Array.isArray(gatewayBalance.balances)) {
              for (const bal of gatewayBalance.balances) {
                const balanceNum = parseFloat(bal.balance);
                const balanceInAtomicUnits = BigInt(Math.floor(balanceNum * 1_000_000));
                
                // Map domain to chain
                const { CHAIN_BY_DOMAIN } = await import("@/lib/circle/gateway-sdk");
                const chainName = CHAIN_BY_DOMAIN[bal.domain];
                const chain = chainName as SupportedChain;
                
                console.log(`    Balance on ${chain}: ${balanceNum} USDC`);
                
                if (balanceInAtomicUnits > maxGatewayBalance) {
                  maxGatewayBalance = balanceInAtomicUnits;
                  bestSourceChain = chain;
                  eoaAddressWithBalance = eoaAddress;
                }
              }
            }
          } catch (error) {
            console.error(`  Error checking Gateway balance for ${eoaAddress}:`, error);
          }
        }

        if (maxGatewayBalance < amountInAtomicUnits) {
          return NextResponse.json(
            { 
              error: "Insufficient funds",
              userMessage: `Not enough USDC. Gateway balance: ${Number(maxGatewayBalance) / 1_000_000} USDC, Required: ${amountNum} USDC.`
            },
            { status: 400 }
          );
        }

        // Use any Circle wallet for minting, but we'll use the best source chain for burning
        sourceWallet = walletBalances.length > 0 ? walletBalances[0] : undefined;
        
        if (!sourceWallet) {
          return NextResponse.json(
            { error: "No wallets found" },
            { status: 404 }
          );
        }

        // Override the source chain to be where the Gateway balance is
        sourceWallet.chain = bestSourceChain!;

        useGateway = true;
        strategy = "gateway";
        estimatedFee = 2.01;
        estimatedTime = 60;
        console.log(`Auto-selected Gateway from ${bestSourceChain}. Balance: ${Number(maxGatewayBalance) / 1_000_000} USDC from EOA ${eoaAddressWithBalance}`);
      }
    }

    // Execute transfer
    let txId: string;
    let txHash: string | undefined;

    if (useGateway) {
      // Use Gateway with EOA signing (no Circle wallet needed for burn, only for mint)
      console.log(`Initiating Gateway transfer from ${sourceWallet.chain} to ${destinationChain}`);
      
      // Step 1: Burn with EOA signature
      // Use the depositor wallet address (the one that has the Gateway balance)
      const { transferId, attestation, attestationSignature } = await signAndSubmitGatewayBurnIntent(
        user.id,
        amountInAtomicUnits,
        sourceWallet.chain,
        destinationChain,
        recipientAddress as Address,
        depositorWallet.address as Address // Pass the depositor address
      );
      
      console.log(`Burn intent submitted. Transfer ID: ${transferId}`);
            
      // We need a Circle wallet address on the DESTINATION chain to execute the mint
      // Find or create a Circle wallet on the destination chain
      const destinationBlockchain = CHAIN_TO_BLOCKCHAIN[destinationChain];
      
      let { data: circleWallets, error: circleWalletError } = await supabase
        .from("wallets")
        .select("*")
        .eq("user_id", user.id)
        .eq("blockchain", destinationBlockchain)
        .neq("type", "gateway_signer")
        .limit(1);

      let circleWallet = circleWallets && circleWallets.length > 0 ? circleWallets[0] : null;

      // Auto-create Circle wallet if it doesn't exist on destination chain
      if (!circleWallet) {
        console.log(`No Circle wallet found on ${destinationChain}. Auto-creating...`);
        
        try {
          // Get an existing Circle wallet to extract its wallet set ID
          const existingWallet = wallets.find(w => w.circle_wallet_id && w.type !== 'gateway_signer');
          let walletSetId: string;
          
          if (existingWallet) {
            // Fetch the wallet details to get its wallet set ID
            const walletDetails = await circleDeveloperSdk.getWallet({ id: existingWallet.circle_wallet_id });
            walletSetId = walletDetails.data?.wallet?.walletSetId || '';
            console.log(`Using existing wallet set ID: ${walletSetId}`);
          } else {
            // No existing Circle wallets - create a new wallet set first
            console.log("No existing Circle wallets found. Creating new wallet set...");
            const walletSetResponse = await circleDeveloperSdk.createWalletSet({ name: "Default Wallet Set" });
            
            if (!walletSetResponse.data?.walletSet?.id) {
              throw new Error("Failed to create wallet set");
            }
            
            walletSetId = walletSetResponse.data.walletSet.id;
            console.log(`Created new wallet set: ${walletSetId}`);
          }
          
          // Create Circle wallet using the same wallet set
          const walletResponse = await circleDeveloperSdk.createWallets({
            blockchains: [destinationBlockchain as any],
            count: 1,
            walletSetId,
          });

          if (!walletResponse.data?.wallets?.[0]) {
            throw new Error("Failed to create Circle wallet via API");
          }

          const newWallet = walletResponse.data.wallets[0];
          console.log(`Circle API created wallet: ${newWallet.id} (${newWallet.address})`);

          // Store in database
          const { data: dbWallet, error: dbError } = await supabase
            .from("wallets")
            .insert([
              {
                user_id: user.id,
                circle_wallet_id: newWallet.id,
                address: newWallet.address,
                blockchain: newWallet.blockchain,
                name: `${CHAIN_LABELS[destinationChain]} Wallet`,
                type: 'customer', // Default wallet type for auto-created wallets
              },
            ])
            .select()
            .single();

          if (dbError) {
            console.error("Database insert error:", dbError);
            throw new Error(`Failed to save wallet to database: ${dbError.message}`);
          }
          
          if (!dbWallet) {
            throw new Error("Failed to save wallet to database: No data returned");
          }

          circleWallet = dbWallet;
          console.log(`✅ Auto-created Circle wallet on ${destinationChain}: ${newWallet.address}`);
        } catch (error: any) {
          console.error("Failed to auto-create Circle wallet:", error);
          return NextResponse.json(
            { 
              error: "Failed to create wallet on destination chain",
              userMessage: `Could not automatically create a wallet on ${CHAIN_LABELS[destinationChain]}. Please try creating one manually. The burn intent has been submitted (Transfer ID: ${transferId}).`,
              details: error.message
            },
            { status: 500 }
          );
        }
      }

      const walletAddress = await getCircleWalletAddress(circleWallet.circle_wallet_id);
      
      console.log(`Executing mint on ${destinationChain} using Circle wallet ${walletAddress} (${circleWallet.circle_wallet_id})...`);
      
      // Step 2: Execute mint on destination using Circle wallet
      let mintTx;
      try {
        mintTx = await executeGatewayMint(
          walletAddress,
          destinationChain,
          attestation,
          attestationSignature
        );
      } catch (mintError: any) {
        // Check if it's a gas error
        if (mintError.message.includes('insufficient') || mintError.message.includes('native tokens')) {
          return NextResponse.json(
            { 
              success: false,
              partialSuccess: true,
              error: "Wallet needs gas to complete transfer",
              userMessage: `The burn was successful! However, the destination wallet needs native tokens (gas) to complete the mint. Please send ~0.001 ${destinationChain === 'baseSepolia' ? 'Base Sepolia ETH' : destinationChain === 'ethSepolia' ? 'Sepolia ETH' : destinationChain === 'avalancheFuji' ? 'AVAX' : 'ARC'} to ${walletAddress}, then retry the transfer to complete it. Burn ID: ${transferId}`,
              txId: transferId,
              routing: {
                strategy: "gateway",
                sourceChain: sourceWallet.chain,
                destinationChain,
                automaticallySelected: true,
              },
              settlement: {
                estimatedTimeSeconds: estimatedTime,
                estimatedTimeFriendly: estimatedTime < 60 
                  ? `~${estimatedTime} seconds`
                  : `~${Math.ceil(estimatedTime / 60)} minutes`,
                estimatedFeeUSDC: estimatedFee,
                guaranteed: false,
              },
              details: {
                transferId,
                walletAddress,
                chain: destinationChain,
                status: 'burn_complete_mint_pending',
              }
            },
            { status: 202 }
          );
        }
        throw mintError;
      }
      
      txId = transferId;
      txHash = mintTx.txHash as string;
      console.log(`Gateway transfer completed. Mint TX: ${txHash}`);
    } else {
      // Same-chain transfer using direct USDC transfer
      const usdcContractAddress = CHAIN_TO_USDC_ADDRESS[sourceWallet.blockchain];
      if (!usdcContractAddress) {
        return NextResponse.json(
          { error: `USDC contract not found for ${sourceWallet.blockchain}` },
          { status: 400 }
        );
      }

      const response = await circleDeveloperSdk.createContractExecutionTransaction({
        walletId: sourceWallet.walletId,
        contractAddress: usdcContractAddress,
        abiFunctionSignature: "transfer(address,uint256)",
        abiParameters: [recipientAddress, amountInAtomicUnits.toString()],
        fee: { type: "level", config: { feeLevel: "HIGH" } },
      });

      if (!response.data?.id) {
        throw new Error("Failed to initiate transfer");
      }
      txId = response.data.id;
    }

    // Log transaction
    await supabase.from("transactions").insert([
      {
        user_id: user.id,
        amount: amountNum,
        sender_address: sourceWallet.address,
        recipient_address: recipientAddress,
        circle_transaction_id: txId,
        blockchain: CHAIN_TO_BLOCKCHAIN[destinationChain],
        type: "OUTBOUND",
        status: "PENDING",
      },
    ]);

    return NextResponse.json({
      success: true,
      txId,
      txHash,
      routing: {
        strategy,
        sourceChain: sourceWallet.chain,
        destinationChain,
        automaticallySelected: true,
      },
      settlement: {
        estimatedTimeSeconds: estimatedTime,
        estimatedTimeFriendly: estimatedTime < 60 
          ? `~${estimatedTime} seconds`
          : `~${Math.ceil(estimatedTime / 60)} minutes`,
        estimatedFeeUSDC: estimatedFee,
        guaranteed: strategy === "same-chain",
      },
    });

  } catch (error: any) {
    console.error("Payout error:", error);
    
    let errorMessage = "Internal server error";
    let userFriendlyMessage = "";
    
    if (error.message) {
      errorMessage = error.message;
      
      // Provide user-friendly messages for common errors
      if (errorMessage.includes("Insufficient native token")) {
        userFriendlyMessage = "The source wallet needs native tokens (gas) to pay for transaction fees. Please add native tokens to your wallet.";
      } else if (errorMessage.includes("Insufficient funds")) {
        userFriendlyMessage = "Not enough USDC balance across all your wallets to complete this transfer.";
      } else if (errorMessage.includes("No wallets found")) {
        userFriendlyMessage = "You don't have any wallets yet. Please create a wallet first.";
      } else if (error?.response?.data?.message) {
        errorMessage = error.response.data.message;
      }
    }
    
    return NextResponse.json(
      { 
        error: errorMessage,
        userMessage: userFriendlyMessage || errorMessage
      },
      { status: 500 }
    );
  }
}
