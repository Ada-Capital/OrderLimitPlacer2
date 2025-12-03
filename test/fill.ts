#!/usr/bin/env npx tsx

import { encodeFunctionData, decodeErrorResult, parseUnits, type Hex } from "viem";
import { polygon } from "viem/chains";
import {
  formatTokenAmount,
  LIMIT_ORDER_PROTOCOL_ADDRESS,
  POLYGON_RPC_URL,
  ORDER_CONFIG,
} from "../config";
import {
  createPolygonPublicClient,
  createPolygonWalletClient,
  createAccountFromPrivateKey,
  validateSufficientBalance,
  ensureTokenApproval,
} from "../lib/blockchain";
import {
  generateSignedOrder,
  formatOrderOutput,
  parseSignatureToCompact,
  type OrderParams,
  type OrderOutput,
} from "../lib/order";
import { LIMIT_ORDER_PROTOCOL_ABI } from "../lib/abi";
import { getQuote } from "../lib/quote";

const TAKER_ADDRESS = "0x177CE60D2161fcfDD00274620E2f35a653a64Cd6" as Hex;
const MAKER_ADDRESS = "0x4D9e1f35e8eEB9162207d51B7Aa7a6898BD27090" as Hex;

const TEST_MAKING_AMOUNT = "1";

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

function isExecuteMode(): boolean {
  return process.argv.includes("--execute");
}

async function generateTestOrder(): Promise<OrderOutput> {
  const makerPrivateKey = getMakerPrivateKey();
  const makerToken = ORDER_CONFIG.makerAsset;
  const takerToken = ORDER_CONFIG.takerAsset;
  const expirationMinutes = ORDER_CONFIG.expirationMinutes;

  const makingAmountRaw = parseUnits(TEST_MAKING_AMOUNT, makerToken.decimals);
  const quote = await getQuote(makingAmountRaw);

  const makerAccount = createAccountFromPrivateKey(makerPrivateKey);
  const publicClient = createPolygonPublicClient();
  const walletClient = createPolygonWalletClient(makerAccount);

  const { sufficient, balance } = await validateSufficientBalance(
    publicClient,
    makerToken.address,
    makerAccount.address,
    quote.inputAmount
  );

  console.log(`Maker balance: ${formatTokenAmount(balance, makerToken.decimals, makerToken.symbol)}`);

  if (!sufficient) {
    console.log(`Error: Maker has insufficient ${makerToken.symbol} balance`);
    console.log(`Required: ${formatTokenAmount(quote.inputAmount, makerToken.decimals, makerToken.symbol)}`);
    process.exit(1);
  }

  const { txHash: approvalTx } = await ensureTokenApproval(
    walletClient,
    publicClient,
    makerToken.address,
    makerAccount.address,
    quote.inputAmount
  );

  if (approvalTx) {
    console.log(`Maker approval tx: ${approvalTx}`);
  }

  const orderParams: OrderParams = {
    makerAsset: makerToken.address,
    takerAsset: takerToken.address,
    makingAmount: quote.inputAmount,
    takingAmount: quote.outputAmount,
    maker: makerAccount.address,
    expirationMinutes,
  };

  const signedOrder = await generateSignedOrder(orderParams, walletClient);
  return formatOrderOutput(signedOrder);
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

async function executeFill(
  order: OrderOutput,
  takerPrivateKey: Hex
): Promise<{ success: boolean; txHash?: Hex; error?: string }> {
  const takerAccount = createAccountFromPrivateKey(takerPrivateKey);
  const publicClient = createPolygonPublicClient();
  const walletClient = createPolygonWalletClient(takerAccount);

  const takingAmount = BigInt(order.order.takingAmount);
  const takerToken = ORDER_CONFIG.takerAsset;

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

function displayOrderInfo(order: OrderOutput): void {
  const makerToken = ORDER_CONFIG.makerAsset;
  const takerToken = ORDER_CONFIG.takerAsset;

  console.log(`Order Hash: ${order.orderHash}`);
  console.log(`Maker Asset: ${makerToken.address} (${makerToken.symbol})`);
  console.log(`Taker Asset: ${takerToken.address} (${takerToken.symbol})`);
  console.log(
    `Making Amount: ${formatTokenAmount(BigInt(order.order.makingAmount), makerToken.decimals, makerToken.symbol)}`
  );
  console.log(
    `Taking Amount: ${formatTokenAmount(BigInt(order.order.takingAmount), takerToken.decimals, takerToken.symbol)}`
  );
}

async function main(): Promise<void> {
  const executeMode = isExecuteMode();

  console.log("=".repeat(80));
  console.log("1INCH LIMIT ORDER FILL TEST");
  console.log("=".repeat(80));
  console.log("");

  console.log(`Maker Address: ${MAKER_ADDRESS}`);
  console.log(`Taker Address: ${TAKER_ADDRESS}`);
  console.log(`Test Amount: ${TEST_MAKING_AMOUNT} ${ORDER_CONFIG.makerAsset.symbol}`);
  console.log("");

  console.log("Generating test order...");
  const order = await generateTestOrder();
  console.log("");

  displayOrderInfo(order);
  console.log("");

  if (executeMode) {
    const takerPrivateKey = getTakerPrivateKey();
    const takerAccount = createAccountFromPrivateKey(takerPrivateKey);

    console.log(`Executing with: ${takerAccount.address}`);
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
    console.log("Simulating fill...");

    const result = await simulateFill(order, TAKER_ADDRESS);

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
  console.log("Fatal error:", error);
  process.exit(1);
});
