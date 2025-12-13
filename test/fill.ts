#!/usr/bin/env npx tsx

import { encodeFunctionData, decodeErrorResult, type Hex } from "viem";
import {
  formatTokenAmount,
  LIMIT_ORDER_PROTOCOL_ADDRESS,
  POLYGON_RPC_URL,
  VALID_PAIRS,
  getPairLabel,
} from "../config";
import {
  createPolygonPublicClient,
  createPolygonWalletClient,
  createAccountFromPrivateKey,
  ensureTokenApproval,
} from "../lib/blockchain";
import { parseSignatureToCompact, type OrderOutput } from "../lib/order";
import { LIMIT_ORDER_PROTOCOL_ABI } from "../lib/abi";
import { generateOrder } from "../lib/generate";

const TEST_MAKING_AMOUNT = "1";
const TEST_PAIR = VALID_PAIRS[0]; // USDC -> BRLA

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.log(`Error: ${name} environment variable is required.`);
    process.exit(1);
  }
  return value;
}

function getMakerPrivateKey(): Hex {
  const key = getRequiredEnv("MAKER_PRIVATE_KEY");
  return key.startsWith("0x") ? (key as Hex) : (`0x${key}` as Hex);
}

function getTakerPrivateKey(): Hex {
  const key = getRequiredEnv("TAKER_PRIVATE_KEY");
  return key.startsWith("0x") ? (key as Hex) : (`0x${key}` as Hex);
}

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

function buildFillOrderData(order: OrderOutput, takingAmount: bigint): Hex {
  const orderStruct = buildOrderStruct(order.order);
  const { r, vs } = parseSignatureToCompact(order.signature);

  return encodeFunctionData({
    abi: LIMIT_ORDER_PROTOCOL_ABI,
    functionName: "fillOrder",
    args: [orderStruct, r, vs, takingAmount, 0n],
  });
}

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

function displayOrderInfo(order: OrderOutput): void {
  const sourceToken = TEST_PAIR.source;
  const outputToken = TEST_PAIR.output;

  console.log(`Order Hash: ${order.orderHash}`);
  console.log(`Maker Asset: ${sourceToken.address} (${sourceToken.symbol})`);
  console.log(`Taker Asset: ${outputToken.address} (${outputToken.symbol})`);
  console.log(
    `Making Amount: ${formatTokenAmount(BigInt(order.order.makingAmount), sourceToken.decimals, sourceToken.symbol)}`
  );
  console.log(
    `Taking Amount: ${formatTokenAmount(BigInt(order.order.takingAmount), outputToken.decimals, outputToken.symbol)}`
  );
}

async function main(): Promise<void> {
  console.log("=".repeat(80));
  console.log("1INCH LIMIT ORDER FILL TEST");
  console.log("=".repeat(80));
  console.log("");

  const makerPrivateKey = getMakerPrivateKey();
  const takerPrivateKey = getTakerPrivateKey();
  const takerAccount = createAccountFromPrivateKey(takerPrivateKey);

  console.log(`Test Pair: ${getPairLabel(TEST_PAIR)}`);
  console.log(`Test Amount: ${TEST_MAKING_AMOUNT} ${TEST_PAIR.source.symbol}`);
  console.log("");

  console.log("Generating order using shared generateOrder()...");
  console.log("");

  const result = await generateOrder({
    makerPrivateKey,
    amountStr: TEST_MAKING_AMOUNT,
    pair: TEST_PAIR,
  });

  console.log("");
  displayOrderInfo(result.order);
  console.log("");
  console.log("Order JSON:");
  console.log(JSON.stringify(result.order, null, 2));
  console.log("");

  const publicClient = createPolygonPublicClient();
  const takerWalletClient = createPolygonWalletClient(takerAccount);
  const takingAmount = BigInt(result.order.order.takingAmount);
  const outputToken = TEST_PAIR.output;

  console.log(`Ensuring taker ${outputToken.symbol} approval...`);
  const { txHash: approvalTx } = await ensureTokenApproval(
    takerWalletClient,
    publicClient,
    outputToken.address,
    takerAccount.address,
    takingAmount
  );
  if (approvalTx) {
    console.log(`Approval tx: ${approvalTx}`);
  } else {
    console.log("Already approved");
  }
  console.log("");

  console.log("Simulating fill...");
  const simResult = await simulateFill(result.order, takerAccount.address);

  if (simResult.success) {
    console.log("");
    console.log("SIMULATION PASSED");
    console.log("The order can be filled successfully.");
  } else {
    console.log("");
    console.log("SIMULATION FAILED");
    console.log(`Error: ${simResult.error}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.log("Fatal error:", error);
  process.exit(1);
});
