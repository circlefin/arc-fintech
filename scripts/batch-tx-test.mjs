/**
 * Batch Transactions + Memos Test
 * Arc Testnet v0.7.2
 */
import { createWalletClient, createPublicClient, http, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as dotenv from "dotenv";
dotenv.config();

BigInt.prototype.toJSON = function() { return this.toString(); };

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  testnet: true,
};

const MEMO_PRECOMPILE = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505";
const EVENT_LOGGER   = "0x9C50765e591663ED541B2fB863626f39fC6C12e0";

const memoAbi = [{
  name: "callWithMemo",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { name: "target", type: "address" },
    { name: "data", type: "bytes" },
    { name: "memo", type: "bytes" },
  ],
  outputs: [{ type: "bytes" }],
}];

const eventLoggerAbi = [{
  name: "logMessage",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [{ name: "message", type: "string" }],
  outputs: [],
}];

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   Batch Transactions + Memos — Arc       ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY}`);
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });

  console.log(`Wallet: ${account.address}`);

  // Test 1: Single TX with Memo
  console.log("\n📊 Test 1: Single TX with Memo...");
  try {
    const logData = encodeFunctionData({
      abi: eventLoggerAbi,
      functionName: "logMessage",
      args: ["Batch TX + Memo Test — Arc Testnet v0.7.2"],
    });

    const memo = new TextEncoder().encode(JSON.stringify({
      invoiceId: "INV-2026-001",
      customerId: "arc-agent-a",
      timestamp: Date.now(),
    }));

    const hash = await walletClient.sendTransaction({
      to: MEMO_PRECOMPILE,
      data: encodeFunctionData({
        abi: memoAbi,
        functionName: "callWithMemo",
        args: [EVENT_LOGGER, logData, `0x${Buffer.from(memo).toString("hex")}`],
      }),
      gas: 500000n,
    });

    console.log(`✅ TX Hash: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Status: ${receipt.status}`);
    console.log(`✅ Block: ${receipt.blockNumber}`);
  } catch(e) {
    console.log("Memo TX error:", e.message.slice(0, 100));
  }

  // Test 2: Batch TX (sequential)
  console.log("\n📊 Test 2: Batch TX (3 EventLogger calls)...");
  try {
    const calls = [
      { memo: "Batch TX #1 — Arc v0.7.2" },
      { memo: "Batch TX #2 — invoiceId: INV-001" },
      { memo: "Batch TX #3 — customerId: arc-agent-a" },
    ];

    const hashes = await Promise.all(calls.map(call =>
      walletClient.sendTransaction({
        to: call.to,
        data: call.data,
        gas: 200000n,
      })
    ));

    console.log("✅ Batch TX hashes:");
    hashes.forEach((h, i) => console.log(`  #${i+1}: ${h}`));

    const receipts = await Promise.all(hashes.map(h => publicClient.waitForTransactionReceipt({ hash: h })));
    receipts.forEach((r, i) => console.log(`  #${i+1} status: ${r.status}, block: ${r.blockNumber}`));
  } catch(e) {
    console.log("Batch TX error:", e.message.slice(0, 100));
  }
}

main().catch(console.error);
