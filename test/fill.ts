#!/usr/bin/env npx tsx
/**
 * Test script to simulate/execute filling a limit order
 *
 * This script:
 * 1. Loads a generated order JSON from file or stdin
 * 2. Simulates the fillOrder call using a taker address
 * 3. Reports if simulation succeeds or fails with decoded error
 *
 * Required environment variables:
 *   POLYGON_RPC_URL     - Polygon RPC endpoint
 *   TAKER_PRIVATE_KEY   - Private key for execution (required for --execute)
 *
 * Usage:
 *   ORDER_PATH=order.json npx tsx test/fill.ts
 *   ORDER_PATH=order.json npx tsx test/fill.ts --execute
 */

import * as fs from "fs";
import { encodeFunctionData, decodeErrorResult, type Hex } from "viem";
import { polygon } from "viem/chains";
import {
  getTakerPrivateKey,
  formatTokenAmount,
  getTokenByAddress,
  LIMIT_ORDER_PROTOCOL_ADDRESS,
  POLYGON_RPC_URL,
} from "../config";
import {
  createPolygonPublicClient,
  createPolygonWalletClient,
  createAccountFromPrivateKey,
  validateSufficientBalance,
  ensureTokenApproval,
} from "../lib/blockchain";
import { parseSignatureToCompact, type OrderOutput } from "../lib/order";
import { LIMIT_ORDER_PROTOCOL_ABI } from "../lib/abi";

// ============================================================================
// Environment Loading
// ============================================================================

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Error: ${name} environment variable is required.`);
    process.exit(1);
  }
  return value;
}

function isExecuteMode(): boolean {
  return process.argv.includes("--execute");
}

// ============================================================================
// Order Loading
// ============================================================================

function loadOrderFromFile(path: string): OrderOutput {
  const content = fs.readFileSync(path, "utf-8");
  return JSON.parse(content) as OrderOutput;
}

function loadOrderFromStdin(): Promise<OrderOutput> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(data) as OrderOutput);
      } catch {
        reject(new Error("Failed to parse order JSON from stdin"));
      }
    });
    process.stdin.on("error", reject);
  });
}

async function loadOrder(): Promise<OrderOutput> {
  const orderPath = process.env.ORDER_PATH;
  
  if (orderPath) {
    return loadOrderFromFile(orderPath);
  }

  if (!process.stdin.isTTY) {
    return loadOrderFromStdin();
  }

  console.error("Error: ORDER_PATH environment variable is required.");
  process.exit(1);
}

// ============================================================================
// Order Struct Building
// ============================================================================

function buildOrderStruct(order: OrderOutput["order"]) {
  return {
    salt: BigInt(order.salt),
    maker: BigInt(order.maker),
    receiver: BigInt(order.receiver),
    makerAsset: BigInt(order.makerAsset),
    takerAsset: BigInt(order.takerAsset),
    makingAmount: BigInt(order.makingAmount),
    takingAmount: BigInt(order.takingAmount),
    makerTraits: BigInt(order.makerTraits),
  };
}

// ============================================================================
// Fill Transaction Building
// ============================================================================

function buildFillOrderData(order: OrderOutput, takingAmount: bigint): Hex {
  const orderStruct = buildOrderStruct(order.order);
  const { r, vs } = parseSignatureToCompact(order.signature);

  return encodeFunctionData({
    abi: LIMIT_ORDER_PROTOCOL_ABI,
    functionName: "fillOrder",
    args: [orderStruct, r, vs, takingAmount, 0n],
  });
}

// ============================================================================
// Error Decoding
// ============================================================================

function decodeRevertError(errorData: string | undefined): string {
  if (!errorData || errorData === "0x") {
    return "Unknown error (no revert data)";
  }

  try {
    const decoded = decodeErrorResult({
      abi: LIMIT_ORDER_PROTOCOL_ABI,
      data: errorData as Hex,
    });

    if (decoded.args && decoded.args.length > 0) {
      return `${decoded.errorName}(${decoded.args.map((a) => String(a)).join(", ")})`;
    }
    return `${decoded.errorName}()`;
  } catch {
    const selector = errorData.slice(0, 10);
    return `Unknown error with selector ${selector}`;
  }
}

// ============================================================================
// Simulation
// ============================================================================

async function simulateFill(
  order: OrderOutput,
  takerAddress: Hex
): Promise<{ success: boolean; error?: string }> {
  const publicClient = createPolygonPublicClient();
  const takingAmount = BigInt(order.order.takingAmount);
  const fillData = buildFillOrderData(order, takingAmount);

  try {
    await publicClient.call({
      account: takerAddress,
      to: LIMIT_ORDER_PROTOCOL_ADDRESS as Hex,
      data: fillData,
    });
    return { success: true };
  } catch (error: unknown) {
    const revertData = await getRevertData(
      LIMIT_ORDER_PROTOCOL_ADDRESS as Hex,
      fillData,
      takerAddress
    );

    if (revertData) {
      return { success: false, error: decodeRevertError(revertData) };
    }

    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

async function getRevertData(
  to: Hex,
  data: Hex,
  from: Hex
): Promise<string | undefined> {
  try {
    const response = await fetch(POLYGON_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ from, to, data }, "latest"],
      }),
    });
    const result = (await response.json()) as { error?: { data?: string } };
    return result.error?.data;
  } catch {
    return undefined;
  }
}

// ============================================================================
// Execution
// ============================================================================

async function executeFill(
  order: OrderOutput,
  takerPrivateKey: Hex
): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
  const takerAccount = createAccountFromPrivateKey(takerPrivateKey);
  const publicClient = createPolygonPublicClient();
  const walletClient = createPolygonWalletClient(takerAccount);

  const takingAmount = BigInt(order.order.takingAmount);
  const takerAssetAddress = `0x${BigInt(order.order.takerAsset).toString(16).padStart(40, "0")}` as Hex;

  const takerToken = getTokenByAddress(takerAssetAddress);
  if (!takerToken) {
    return { success: false, error: `Unknown taker asset: ${takerAssetAddress}` };
  }

  const { sufficient, balance } = await validateSufficientBalance(
    publicClient,
    takerToken.address,
    takerAccount.address,
    takingAmount
  );

  console.log(
    `Taker balance: ${formatTokenAmount(balance, takerToken.decimals, takerToken.symbol)}`
  );

  if (!sufficient) {
    return {
      success: false,
      error: `Insufficient ${takerToken.symbol} balance`,
    };
  }

  const { txHash: approvalTx } = await ensureTokenApproval(
    walletClient,
    publicClient,
    takerToken.address,
    takerAccount.address,
    takingAmount
  );

  if (approvalTx) {
    console.log(`Approval tx: ${approvalTx}`);
  }

  const fillData = buildFillOrderData(order, takingAmount);

  try {
    const gasEstimate = await publicClient.estimateGas({
      account: takerAccount.address,
      to: LIMIT_ORDER_PROTOCOL_ADDRESS as Hex,
      data: fillData,
    });

    const txHash = await walletClient.sendTransaction({
      to: LIMIT_ORDER_PROTOCOL_ADDRESS as Hex,
      data: fillData,
      chain: polygon,
      account: takerAccount,
      gas: gasEstimate + gasEstimate / 10n,
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    if (receipt.status === "success") {
      return { success: true, txHash };
    } else {
      return { success: false, txHash, error: "Transaction reverted" };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// ============================================================================
// Display Order Info
// ============================================================================

function displayOrderInfo(order: OrderOutput): void {
  const makerAssetHex = `0x${BigInt(order.order.makerAsset).toString(16).padStart(40, "0")}` as Hex;
  const takerAssetHex = `0x${BigInt(order.order.takerAsset).toString(16).padStart(40, "0")}` as Hex;
  const makerToken = getTokenByAddress(makerAssetHex);
  const takerToken = getTokenByAddress(takerAssetHex);

  console.log(`Order Hash: ${order.orderHash}`);
  console.log(
    `Maker Asset: ${makerAssetHex}${makerToken ? ` (${makerToken.symbol})` : ""}`
  );
  console.log(
    `Taker Asset: ${takerAssetHex}${takerToken ? ` (${takerToken.symbol})` : ""}`
  );

  if (makerToken) {
    console.log(
      `Making Amount: ${formatTokenAmount(BigInt(order.order.makingAmount), makerToken.decimals, makerToken.symbol)}`
    );
  } else {
    console.log(`Making Amount: ${order.order.makingAmount}`);
  }

  if (takerToken) {
    console.log(
      `Taking Amount: ${formatTokenAmount(BigInt(order.order.takingAmount), takerToken.decimals, takerToken.symbol)}`
    );
  } else {
    console.log(`Taking Amount: ${order.order.takingAmount}`);
  }
}

// ============================================================================
// Main Flow
// ============================================================================

async function main(): Promise<void> {
  const order = await loadOrder();
  const executeMode = isExecuteMode();

  console.log("=".repeat(80));
  console.log("1INCH LIMIT ORDER FILL TEST");
  console.log("=".repeat(80));
  console.log("");

  displayOrderInfo(order);
  console.log("");

  if (executeMode) {
    const takerPrivateKey = getTakerPrivateKey();
    const takerAccount = createAccountFromPrivateKey(takerPrivateKey);

    console.log(`Taker Address: ${takerAccount.address}`);
    console.log("");
    console.log("Executing fill...");

    const result = await executeFill(order, takerPrivateKey);

    if (result.success) {
      console.log("");
      console.log("FILL SUCCESSFUL");
      console.log(`Transaction: ${result.txHash}`);
    } else {
      console.log("");
      console.log("FILL FAILED");
      console.log(`Error: ${result.error}`);
      if (result.txHash) {
        console.log(`Transaction: ${result.txHash}`);
      }
      process.exit(1);
    }
  } else {
    const takerPrivateKey = getTakerPrivateKey();
    const takerAccount = createAccountFromPrivateKey(takerPrivateKey);

    console.log(`Taker Address: ${takerAccount.address}`);
    console.log("");
    console.log("Simulating fill...");

    const result = await simulateFill(order, takerAccount.address);

    if (result.success) {
      console.log("");
      console.log("SIMULATION PASSED");
      console.log("The order can be filled successfully.");
    } else {
      console.log("");
      console.log("SIMULATION FAILED");
      console.log(`Error: ${result.error}`);
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
