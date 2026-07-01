import { getBalances, estimateSpend, getSupportedChains, createUnifiedBalanceKitContext } from "@circle-fin/unified-balance-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import * as dotenv from "dotenv";
dotenv.config();

BigInt.prototype.toJSON = function() { return this.toString(); };

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   Unified Balance Kit — Arc Testnet      ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const adapter = createCircleWalletsAdapter({
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  });

  // Context oluştur
  const context = createUnifiedBalanceKitContext({
    sources: [{ adapter }],
  });

  // Step 0: Supported chains
  console.log("📊 Step 0: getSupportedChains...");
  try {
    const chains = getSupportedChains(context);
    console.log("Chains:", chains.map(c => c.chain || c.name || JSON.stringify(c)).slice(0, 5));
  } catch(e) {
    console.log("getSupportedChains error:", e.message);
  }

  // Step 1: getBalances
  console.log("\n📊 Step 1: getBalances...");
  try {
    const balances = await getBalances(context, { sources: [{ adapter, address: process.env.CIRCLE_WALLET_ADDRESS }], includePending: true });
    console.log("✅ Balances:", JSON.stringify(balances, null, 2));
  } catch(e) {
    console.log("getBalances error:", e.message);
  }
  // Step 2: deposit
  console.log("\n📊 Step 2: deposit (Ethereum Sepolia → Gateway)...");
  try {
    const { deposit } = await import("@circle-fin/unified-balance-kit");
    const depositResult = await deposit(context, {
      amount: "1",
      token: "USDC",
      from: { adapter, chain: "Arc_Testnet", address: "0xa75282fe398a4bf910884bdff29aeb1a23f2e55a" },
    });
    console.log("✅ Deposit result:", JSON.stringify(depositResult, null, 2));
  } catch(e) {
    console.log("deposit error:", e.message);
  }

  // Step 3: estimateSpend
  console.log("\n📊 Step 2: estimateSpend...");
  try {
    const estimate = await estimateSpend(context, {
      amount: "0.001",
      token: "USDC",
      from: [{ adapter, address: process.env.CIRCLE_WALLET_ADDRESS }],
      to: {
        adapter,
        chain: "Arc_Testnet",
        address: "0xa75282fe398a4bf910884bdff29aeb1a23f2e55a",
      },
    });
    console.log("✅ Estimate:", JSON.stringify(estimate, null, 2));
  } catch(e) {
    console.log("estimateSpend error:", e.message);
  }
  // Step 3: addDelegate
  console.log("\n📊 Step 3: addDelegate...");
  try {
    const { addDelegate, getDelegateStatus } = await import("@circle-fin/unified-balance-kit");
    const delegateResult = await addDelegate(context, {
      from: { adapter, chain: "Arc_Testnet", address: "0xa75282fe398a4bf910884bdff29aeb1a23f2e55a" },
      delegateAddress: "0x54b4B44749a95070560509B6Ec0be501665CcF63",
    });
    console.log("✅ addDelegate result:", JSON.stringify(delegateResult, null, 2));

    console.log("\n📊 Step 3b: getDelegateStatus...");
    const status = await getDelegateStatus(context, {
      from: { adapter, chain: "Arc_Testnet", address: "0xa75282fe398a4bf910884bdff29aeb1a23f2e55a" },
      delegateAddress: "0x54b4B44749a95070560509B6Ec0be501665CcF63",
    });
    console.log("✅ Delegate status:", status);
  } catch(e) {
    console.log("addDelegate error:", e.message);
  }

  // Step 4: spend
  console.log("\n📊 Step 4: spend (Gateway → Arc Testnet)...");
  try {
    const { spend } = await import("@circle-fin/unified-balance-kit");
    const spendResult = await spend(context, {
      amount: "0.001",
      token: "USDC",
      from: [{ adapter, address: process.env.CIRCLE_WALLET_ADDRESS }],
      to: {
        adapter,
        chain: "Arc_Testnet",
        address: "0xa75282fe398a4bf910884bdff29aeb1a23f2e55a",
      },
    });
    console.log("✅ Spend result:", JSON.stringify(spendResult, null, 2));
  } catch(e) {
    if (e.recoverability === "RESUMABLE" && e.cause?.trace) {
      console.log("RESUMABLE error — retry possible");
      console.log("attestation:", e.cause.trace.attestation);
    } else {
      console.log("spend error:", e.message, "| recoverability:", e.recoverability);
    }
  }
}

main().catch(console.error);
