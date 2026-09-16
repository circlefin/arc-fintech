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

import { NextResponse } from "next/server";
import { circleDeveloperSdk } from "@/lib/circle/developer-controlled-wallets-client";
import type { Blockchain } from "@circle-fin/developer-controlled-wallets";
import { withAuth } from "@/lib/api/with-auth";
import {
  signAndSubmitGatewayBurnIntent,
  executeGatewayMint,
  type SupportedChain,
  getUsdcBalance,
  getTokenBalance,
  fetchGatewayBalance,
  GATEWAY_WALLET_ADDRESS,
  PollingTimeoutError,
} from "@/lib/circle/gateway-sdk";
import {
  createCircleWalletsAdapterInstance,
  getAppKit,
} from "@/lib/circle/app-kit";
import {
  buildUnifiedBalanceGatewayAllocatedSources,
  getUnifiedBalancePayoutError,
  normalizeUnifiedBalanceGatewaySpendResult,
  planUnifiedBalanceGatewayAllocations,
} from "@/lib/circle/unified-balance-payout";
import {
  getAppKitSendError,
  sendUsdcOnSameChainWithAppKit,
} from "@/lib/circle/app-kit-send";
import {
  APP_KIT_CHAIN_BY_BLOCKCHAIN,
  type AppKitChain,
  SDK_CHAIN_BY_BLOCKCHAIN as BLOCKCHAIN_TO_CHAIN,
  BLOCKCHAIN_BY_SDK_CHAIN as CHAIN_TO_BLOCKCHAIN,
  CHAIN_LABEL_BY_SDK_CHAIN as CHAIN_LABELS,
} from "@/lib/constants/chains";
import { CURRENCIES, type Currency } from "@/lib/constants/currency";
import {
  formatUsdcAtomicUnits,
  parseUsdcAmountToAtomicUnits,
} from "@/lib/circle/usdc-amount";
import type { Address } from "viem";

async function getCircleWalletAddress(walletId: string): Promise<Address> {
  const response = await circleDeveloperSdk.getWallet({ id: walletId });
  if (!response.data?.wallet?.address) {
    throw new Error(`Could not fetch address for wallet ID: ${walletId}`);
  }
  return response.data.wallet.address as Address;
}

interface WalletBalance {
  walletId: string;
  address: string;
  blockchain: string;
  chain: SupportedChain;
  balance: bigint;
}

export const POST = withAuth(async (req, { user, supabase }) => {
  try {
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

    // A non-USDC payout is only satisfiable on a true same-chain wallet source
    // (the `else` branch below, which calls sendUsdcOnSameChainWithAppKit
    // directly). "auto" picks its wallet by USDC balance, and every
    // cross-chain/"gateway" path settles through Gateway's burn/mint, which is
    // USDC-only.
    //
    // Reject rather than silently downgrade: this endpoint moves money, so a
    // request asking for EURC must never quietly send USDC instead.
    const rawCurrency = body.currency ?? "USDC";
    if (!(CURRENCIES as readonly string[]).includes(rawCurrency)) {
      return NextResponse.json(
        {
          error: "Unsupported currency",
          userMessage: `Currency must be one of: ${CURRENCIES.join(", ")}.`,
        },
        { status: 400 }
      );
    }
    const requestedCurrency = rawCurrency as Currency;

    if (requestedCurrency !== "USDC" && sourceType !== "wallet") {
      return NextResponse.json(
        {
          error: "Unsupported currency for this source",
          userMessage: `${requestedCurrency} payouts require an explicit same-chain wallet source. Gateway and automatic routing settle in USDC only.`,
        },
        { status: 400 }
      );
    }

    // Parse the requested amount strictly. parseFloat would accept partially
    // numeric input like "1USDC" (-> 1) or "1.5abc" (-> 1.5) and silently move a
    // value the caller never wrote; parseUsdcAmountToAtomicUnits rejects anything
    // that is not a clean non-negative six-decimal amount.
    const amountString = typeof amount === "number" ? amount.toString() : amount;
    let amountInAtomicUnits: bigint;
    try {
      amountInAtomicUnits = parseUsdcAmountToAtomicUnits(amountString);
    } catch {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    if (amountInAtomicUnits <= BigInt(0)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    // Canonical string / number derived from the validated atomic units, so
    // every downstream SDK call and the persisted amount reflect the exact value
    // that was validated — never a re-parsed float.
    const amountDisplay = formatUsdcAtomicUnits(amountInAtomicUnits);
    const amountNum = Number(amountDisplay);
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

      const isSameChain = selectedWallet.chain === destinationChain;

      // A cross-chain wallet source routes through Gateway, which is USDC-only.
      if (requestedCurrency !== "USDC" && !isSameChain) {
        return NextResponse.json(
          {
            error: "Unsupported currency for this route",
            userMessage: `${requestedCurrency} can only be sent same-chain. The selected wallet is on ${CHAIN_LABELS[selectedWallet.chain]}, but the destination is ${CHAIN_LABELS[destinationChain]}, which settles via Gateway in USDC.`,
          },
          { status: 400 }
        );
      }

      // Validate against the balance of the token we will actually send. The
      // `walletBalances` map above is USDC-only (it drives Gateway routing), so
      // a non-USDC payout needs its own read — otherwise a wallet holding EURC
      // but no USDC would be rejected, and one holding USDC but no EURC would
      // pass here only to fail inside App Kit.
      const availableBalance =
        requestedCurrency === "USDC"
          ? selectedWallet.balance
          : await getTokenBalance(
              selectedWallet.address as Address,
              selectedWallet.chain,
              requestedCurrency
            );

      if (availableBalance < amountInAtomicUnits) {
        return NextResponse.json(
          {
            error: "Insufficient balance",
            userMessage: `Selected wallet has insufficient ${requestedCurrency} balance. Available: ${Number(availableBalance) / 1_000_000} ${requestedCurrency}, Required: ${amountNum} ${requestedCurrency}.`
          },
          { status: 400 }
        );
      }

      sourceWallet = selectedWallet;

      // Check if it's same-chain or cross-chain
      if (isSameChain) {
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
      const destinationBlockchain = CHAIN_TO_BLOCKCHAIN[destinationChain];
      const destinationAppKitChain =
        APP_KIT_CHAIN_BY_BLOCKCHAIN[destinationBlockchain];

      if (!destinationAppKitChain) {
        return NextResponse.json(
          { error: `Unsupported destination chain: ${destinationChain}` },
          { status: 400 }
        );
      }

      const nonGatewaySignerAddresses = new Set(
        wallets
          .filter((wallet) => wallet.type !== "gateway_signer")
          .map((wallet) => wallet.address?.toLowerCase())
          .filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0
          )
      );

      if (nonGatewaySignerAddresses.size === 0) {
        return NextResponse.json(
          {
            error: "No Gateway balance found",
            userMessage:
              "No eligible non-signer wallets were found for this account.",
          },
          { status: 404 }
        );
      }

      const gatewaySignerAddresses = Array.from(
        new Set(
          wallets
            .filter((wallet) => wallet.type === "gateway_signer")
            .map((wallet) => wallet.address?.toLowerCase())
            .filter(
              (value): value is string =>
                typeof value === "string" && value.length > 0
            )
        )
      );

      if (gatewaySignerAddresses.length === 0) {
        return NextResponse.json(
          {
            error: "No Gateway signer wallet found",
            userMessage:
              "Create a Gateway signer wallet before spending Gateway balance.",
          },
          { status: 404 }
        );
      }

      const { data: gatewayDeposits, error: gatewayDepositsError } =
        await supabase
          .from("transactions")
          .select("sender_address, recipient_address")
          .eq("user_id", user.id)
          .eq("type", "OUTBOUND")
          .in("recipient_address", [
            GATEWAY_WALLET_ADDRESS,
            GATEWAY_WALLET_ADDRESS.toLowerCase(),
          ]);

      if (gatewayDepositsError) {
        console.error("Failed to query Gateway deposit history:", gatewayDepositsError);
        return NextResponse.json(
          { error: "Failed to load Gateway deposit history" },
          { status: 500 }
        );
      }

      const uniqueAddresses = Array.from(
        new Set(
          (gatewayDeposits ?? [])
            .map((tx) => tx.sender_address?.toLowerCase())
            .filter(
              (value): value is string =>
                typeof value === "string" &&
                value.length > 0 &&
                nonGatewaySignerAddresses.has(value)
            )
        )
      );

      if (uniqueAddresses.length === 0) {
        return NextResponse.json(
          {
            error: "No Gateway balance found",
            userMessage:
              "No eligible wallet addresses were found for this account.",
          },
          { status: 404 }
        );
      }

      try {
        const probeSources = [
          ...uniqueAddresses.map((address) => ({ address })),
          { address: gatewaySignerAddresses[0] },
        ];
        const balanceProbe = await getAppKit().unifiedBalance.getBalances({
          token: "USDC",
          sources: probeSources,
          networkType: "testnet",
          includePending: true,
        });

        const allocationPlan = planUnifiedBalanceGatewayAllocations(
          balanceProbe.breakdown,
          uniqueAddresses,
          amountDisplay
        );

        if (!allocationPlan.isSufficient || allocationPlan.allocations.length === 0) {
          return NextResponse.json(
            {
              error: "Insufficient Gateway balance",
              userMessage:
                `Not enough confirmed Gateway balance. ` +
                `Available: ${allocationPlan.availableAmount} USDC, ` +
                `Required: ${allocationPlan.requiredAmount} USDC, ` +
                `Shortfall: ${allocationPlan.shortfallAmount} USDC.`,
            },
            { status: 400 }
          );
        }

        const fromSources = buildUnifiedBalanceGatewayAllocatedSources(
          allocationPlan.allocations,
          createCircleWalletsAdapterInstance,
          gatewaySignerAddresses[0]
        );

        if (fromSources.length === 0) {
          return NextResponse.json(
            {
              error: "Gateway allocation failed",
              userMessage:
                "Unable to build a valid Gateway spend payload with explicit allocations.",
            },
            { status: 500 }
          );
        }

        const delegateTargets = new Map<
          string,
          { sourceAccount: string; chain: AppKitChain }
        >();

        for (const allocation of allocationPlan.allocations) {
          const targetKey = `${allocation.sourceAccount}|${allocation.chain}`;
          if (!delegateTargets.has(targetKey)) {
            delegateTargets.set(targetKey, {
              sourceAccount: allocation.sourceAccount,
              chain: allocation.chain,
            });
          }
        }

        for (const target of delegateTargets.values()) {
          await getAppKit().unifiedBalance.addDelegate({
            from: {
              adapter: createCircleWalletsAdapterInstance(),
              address: target.sourceAccount,
              chain: target.chain,
            },
            delegateAddress: gatewaySignerAddresses[0],
            token: "USDC",
          });
        }

        await getAppKit().unifiedBalance.estimateSpend({
          amount: amountDisplay,
          token: "USDC",
          from: fromSources,
          to: {
            chain: destinationAppKitChain,
            recipientAddress,
            useForwarder: true,
          },
        });

        console.log(fromSources)
        console.log(destinationAppKitChain)

        const spendResult = await getAppKit().unifiedBalance.spend({
          amount: amountDisplay,
          token: "USDC",
          from: fromSources,
          to: {
            chain: destinationAppKitChain,
            recipientAddress,
            useForwarder: true,
          },
        });

        const normalized = normalizeUnifiedBalanceGatewaySpendResult(
          spendResult,
          destinationChain
        );

        await supabase.from("transactions").insert([
          {
            user_id: user.id,
            amount: amountNum,
            sender_address: normalized.senderAddress ?? uniqueAddresses[0],
            recipient_address: recipientAddress,
            tx_hash: normalized.txHash ?? null,
            circle_transaction_id: normalized.txId,
            blockchain: destinationBlockchain,
            type: "OUTBOUND",
            status: "PENDING",
          },
        ]);

        return NextResponse.json({
          success: true,
          txId: normalized.txId,
          txHash: normalized.txHash,
          routing: {
            strategy: "gateway",
            sourceChain: normalized.sourceChain,
            destinationChain,
            automaticallySelected: true,
          },
          settlement: {
            estimatedTimeSeconds: 60,
            estimatedTimeFriendly: "~1 minute",
            estimatedFeeUSDC: normalized.estimatedFeeUSDC,
            guaranteed: false,
          },
        });
      } catch (error) {
        console.error("Gateway payout via unifiedBalance.spend failed:", error);
        const mappedError = getUnifiedBalancePayoutError(error);
        return NextResponse.json(
          {
            error: mappedError.error,
            userMessage: mappedError.userMessage,
          },
          { status: mappedError.status }
        );
      }
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
    let transactionCurrency: Currency = "USDC";

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
      
      const { data: circleWallets } = await supabase
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
            blockchains: [destinationBlockchain as Blockchain],
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
        } catch (error) {
          console.error("Failed to auto-create Circle wallet:", error);
          return NextResponse.json(
            {
              error: "Failed to create wallet on destination chain",
              userMessage: `Could not automatically create a wallet on ${CHAIN_LABELS[destinationChain]}. Please try creating one manually. The burn intent has been submitted (Transfer ID: ${transferId}).`,
              details: error instanceof Error ? error.message : String(error)
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
      } catch (mintError) {
        const mintErrorMessage = mintError instanceof Error ? mintError.message : String(mintError);
        // Check if it's a gas error
        if (mintErrorMessage.includes('insufficient') || mintErrorMessage.includes('native tokens')) {
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
      // Reaching here with a non-USDC currency is already guaranteed to be an
      // explicit same-chain wallet payout — the guards above 400 on every other
      // combination — so the requested currency is honored as-is. "auto" that
      // resolves to a same-chain wallet still lands here, but it can only ever
      // have asked for USDC.
      transactionCurrency = sourceType === "wallet" ? requestedCurrency : "USDC";
      try {
        const sameChainSendResult = await sendUsdcOnSameChainWithAppKit({
          sourceBlockchain: sourceWallet.blockchain,
          sourceWalletAddress: sourceWallet.address,
          recipientAddress,
          amount: amountDisplay,
          token: transactionCurrency,
        });

        txId = sameChainSendResult.txId;
        txHash = sameChainSendResult.txHash;

        if (sameChainSendResult.estimatedFee) {
          const parsedEstimatedFee = Number.parseFloat(
            sameChainSendResult.estimatedFee
          );
          if (Number.isFinite(parsedEstimatedFee)) {
            estimatedFee = parsedEstimatedFee;
          }
        }
      } catch (error) {
        const mappedError = getAppKitSendError(error);
        return NextResponse.json(
          {
            error: mappedError.error,
            userMessage: mappedError.userMessage,
          },
          { status: mappedError.status }
        );
      }
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
        currency: transactionCurrency,
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

  } catch (error) {
    console.error("Payout error:", error);

    // If we hit our polling ceiling, the underlying transfer is still in flight
    // upstream (Circle / Gateway). Surface a 202 so the client can poll for
    // completion via /api/bridge/monitor or refresh, instead of a misleading 500.
    if (error instanceof PollingTimeoutError) {
      return NextResponse.json(
        {
          success: false,
          status: "pending",
          txId: error.challengeId,
          message:
            "Transfer accepted but did not finalize within the request window. It may still complete; check transaction status.",
        },
        { status: 202 }
      );
    }

    let errorMessage = "Internal server error";
    let userFriendlyMessage = "";

    if (error instanceof Error && error.message) {
      errorMessage = error.message;

      // Provide user-friendly messages for common errors
      if (errorMessage.includes("Insufficient native token")) {
        userFriendlyMessage = "The source wallet needs native tokens (gas) to pay for transaction fees. Please add native tokens to your wallet.";
      } else if (errorMessage.includes("Insufficient funds")) {
        userFriendlyMessage = "Not enough USDC balance across all your wallets to complete this transfer.";
      } else if (errorMessage.includes("No wallets found")) {
        userFriendlyMessage = "You don't have any wallets yet. Please create a wallet first.";
      } else {
        const responseMessage = (error as { response?: { data?: { message?: string } } })
          .response?.data?.message;
        if (responseMessage) {
          errorMessage = responseMessage;
        }
      }
    }

    return NextResponse.json(
      {
        error: errorMessage,
        userMessage: userFriendlyMessage || errorMessage,
      },
      { status: 500 }
    );
  }
});
