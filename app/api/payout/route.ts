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
import { withAuth } from "@/lib/api/with-auth";
import {
  signAndSubmitGatewayBurnIntent,
  executeGatewayMint,
  type SupportedChain,
  getUsdcBalance,
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
import type { Address } from "viem";

function convertToSmallestUnit(amount: string): string {
  const val = parseFloat(amount);
  if (isNaN(val)) return "0";
  return BigInt(Math.floor(val * 1_000_000)).toString();
}

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
      const destinationBlockchain = CHAIN_TO_BLOCKCHAIN[destinationChain];
      const destinationAppKitChain =
        APP_KIT_CHAIN_BY_BLOCKCHAIN[destinationBlockchain];

      // #region agent log
      fetch('http://127.0.0.1:7276/ingest/b6916372-e6aa-4804-b60b-f6f109736944',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3365f4'},body:JSON.stringify({sessionId:'3365f4',runId:'pre-fix-1',hypothesisId:'H3',location:'app/api/payout/route.ts:178',message:'Gateway payout chain mapping',data:{requestedDestinationChain:destinationChain,destinationBlockchain,destinationAppKitChain:destinationAppKitChain ?? null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

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

      // #region agent log
      fetch('http://127.0.0.1:7276/ingest/b6916372-e6aa-4804-b60b-f6f109736944',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3365f4'},body:JSON.stringify({sessionId:'3365f4',runId:'pre-fix-2',hypothesisId:'H5',location:'app/api/payout/route.ts:230',message:'Gateway signer/depositor split',data:{gatewaySignerAddressCount:gatewaySignerAddresses.length,selectedSignerAddress:`${gatewaySignerAddresses[0].slice(0,6)}...${gatewaySignerAddresses[0].slice(-4)}`,nonSignerAddressCount:nonGatewaySignerAddresses.size},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

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

      // #region agent log
      fetch('http://127.0.0.1:7276/ingest/b6916372-e6aa-4804-b60b-f6f109736944',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3365f4'},body:JSON.stringify({sessionId:'3365f4',runId:'pre-fix-1',hypothesisId:'H1',location:'app/api/payout/route.ts:239',message:'Gateway payout source address candidates',data:{walletCount:wallets.length,gatewaySignerWalletCount:wallets.filter((wallet)=>wallet.type==='gateway_signer').length,nonGatewaySignerAddressCount:nonGatewaySignerAddresses.size,gatewayDepositRowCount:(gatewayDeposits ?? []).length,uniqueAddressCount:uniqueAddresses.length,uniqueAddressPreview:uniqueAddresses.slice(0,3).map((address)=>`${address.slice(0,6)}...${address.slice(-4)}`)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

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
          amountNum.toString()
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
          amount: amountNum.toString(),
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
          amount: amountNum.toString(),
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
        const err = error as {
          code?: unknown;
          type?: unknown;
          message?: unknown;
          shortMessage?: unknown;
          details?: unknown;
          cause?: {
            code?: unknown;
            status?: unknown;
            method?: unknown;
            url?: unknown;
          };
        };
        // #region agent log
        fetch('http://127.0.0.1:7276/ingest/b6916372-e6aa-4804-b60b-f6f109736944',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3365f4'},body:JSON.stringify({sessionId:'3365f4',runId:'pre-fix-1',hypothesisId:'H4',location:'app/api/payout/route.ts:329',message:'Gateway spend error details',data:{code:err?.code ?? null,type:err?.type ?? null,message:typeof err?.message==='string' ? err.message : String(err?.message ?? ''),shortMessage:typeof err?.shortMessage==='string' ? err.shortMessage : null,details:typeof err?.details==='string' ? err.details : null,causeCode:err?.cause?.code ?? null,causeStatus:err?.cause?.status ?? null,causeMethod:typeof err?.cause?.method === 'string' ? err.cause.method : null,causeUrl:typeof err?.cause?.url === 'string' ? err.cause.url : null},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
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
      try {
        const sameChainSendResult = await sendUsdcOnSameChainWithAppKit({
          sourceBlockchain: sourceWallet.blockchain,
          sourceWalletAddress: sourceWallet.address,
          recipientAddress,
          amount: amountNum.toString(),
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
        userMessage: userFriendlyMessage || errorMessage,
      },
      { status: 500 }
    );
  }
});
