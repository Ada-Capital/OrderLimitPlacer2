#!/usr/bin/env npx tsx

import * as readline from "readline";
import type { Hex } from "viem";
import { parseUnits } from "viem";
import {
  VALID_PAIRS,
  getPairLabel,
  ORDER_EXPIRATION_MINUTES,
  formatTokenAmount,
  type TradingPair,
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
  type OrderParams,
} from "../lib/order";
import { getQuote } from "../lib/quote";
import { executeOrder } from "../lib/execute";

function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY ?? false,
  });
}

async function readAllLines(rl: readline.Interface): Promise<string[]> {
  const lines: string[] = [];

  return new Promise((resolve) => {
    rl.on("line", (line) => {
      lines.push(line.trim());
    });
    rl.on("close", () => {
      resolve(lines);
    });
  });
}

async function promptInteractive(rl: readline.Interface): Promise<{
  pair: TradingPair;
  amount: string;
  confirmed: boolean;
}> {
  console.log("Available trading pairs:");
  VALID_PAIRS.forEach((pair, index) => {
    console.log(`  ${index + 1}. ${getPairLabel(pair)}`);
  });
  console.log("");

  const pairIndex = await new Promise<number>((resolve, reject) => {
    rl.question("Select pair (1-4): ", (answer) => {
      const index = parseInt(answer.trim(), 10) - 1;
      if (isNaN(index) || index < 0 || index >= VALID_PAIRS.length) {
        reject(new Error("Invalid pair selection."));
        return;
      }
      resolve(index);
    });
  });

  const pair = VALID_PAIRS[pairIndex];
  console.log("");
  console.log(`Selected: ${getPairLabel(pair)}`);
  console.log("");

  const amount = await new Promise<string>((resolve) => {
    rl.question(`Enter amount of ${pair.source.symbol} to trade: `, (answer) => {
      resolve(answer.trim());
    });
  });

  return { pair, amount, confirmed: false };
}

async function promptConfirmation(rl: readline.Interface): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question("Do you want to proceed with this order? (y/N): ", (answer) => {
      const confirmed =
        answer.trim().toLowerCase() === "y" ||
        answer.trim().toLowerCase() === "yes";
      resolve(confirmed);
    });
  });
}

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

async function main(): Promise<void> {
  const makerPrivateKey = getMakerPrivateKey();
  const expirationMinutes = ORDER_EXPIRATION_MINUTES;

  console.log("=".repeat(80));
  console.log("1INCH LIMIT ORDER GENERATOR");
  console.log("=".repeat(80));
  console.log("");

  const rl = createReadline();
  let pair: TradingPair;
  let amountStr: string;
  let confirmStr: string;

  if (process.stdin.isTTY) {
    const input = await promptInteractive(rl);
    pair = input.pair;
    amountStr = input.amount;

    if (!amountStr) {
      console.log("Error: Amount is required.");
      rl.close();
      process.exit(1);
    }
  } else {
    const lines = await readAllLines(rl);
    const pairIndex = parseInt(lines[0] ?? "", 10) - 1;
    if (isNaN(pairIndex) || pairIndex < 0 || pairIndex >= VALID_PAIRS.length) {
      console.log("Error: Invalid pair selection.");
      process.exit(1);
    }
    pair = VALID_PAIRS[pairIndex];
    amountStr = lines[1] ?? "";
    confirmStr = lines[2] ?? "";

    if (!amountStr) {
      console.log("Error: Amount is required.");
      process.exit(1);
    }
  }

  const sourceToken = pair.source;
  const outputToken = pair.output;

  const makingAmountRaw = parseUnits(amountStr, sourceToken.decimals);
  if (makingAmountRaw <= 0n) {
    console.log("Error: Amount must be greater than zero.");
    if (process.stdin.isTTY) rl.close();
    process.exit(1);
  }

  console.log("");
  console.log("Getting quote...");
  const quote = await getQuote(makingAmountRaw, pair);
  const makingAmount = quote.inputAmount;
  const takingAmount = quote.outputAmount;

  console.log(
    `      Input:  ${formatTokenAmount(makingAmount, sourceToken.decimals, sourceToken.symbol)}`
  );
  console.log(
    `      Output: ${formatTokenAmount(takingAmount, outputToken.decimals, outputToken.symbol)}`
  );
  console.log(`      Rate:   ${quote.rate} ${outputToken.symbol}/${sourceToken.symbol}`);

  const makerAccount = createAccountFromPrivateKey(makerPrivateKey);
  const publicClient = createPolygonPublicClient();
  const walletClient = createPolygonWalletClient(makerAccount);

  console.log("");
  console.log(`Maker Address: ${makerAccount.address}`);
  console.log(`Order: ${getPairLabel(pair)}`);
  console.log(`Expiration: 24 hours`);
  console.log("");

  console.log("Checking maker balance...");
  const { sufficient, balance } = await validateSufficientBalance(
    publicClient,
    sourceToken.address,
    makerAccount.address,
    makingAmount
  );

  console.log(
    `      Balance: ${formatTokenAmount(balance, sourceToken.decimals, sourceToken.symbol)}`
  );

  if (!sufficient) {
    console.log("");
    console.log(`Error: Insufficient ${sourceToken.symbol} balance.`);
    console.log(
      `Required: ${formatTokenAmount(makingAmount, sourceToken.decimals, sourceToken.symbol)}`
    );
    console.log(
      `Available: ${formatTokenAmount(balance, sourceToken.decimals, sourceToken.symbol)}`
    );
    if (process.stdin.isTTY) rl.close();
    process.exit(1);
  }
  console.log("      Balance OK");

  console.log("");
  console.log("-".repeat(80));
  console.log("ORDER SUMMARY");
  console.log("-".repeat(80));
  console.log(
    `  You will sell:    ${formatTokenAmount(makingAmount, sourceToken.decimals, sourceToken.symbol)}`
  );
  console.log(
    `  You will receive: ${formatTokenAmount(takingAmount, outputToken.decimals, outputToken.symbol)}`
  );
  console.log(`  Rate:             ${quote.rate} ${outputToken.symbol}/${sourceToken.symbol}`);
  console.log(`  Expiration:       24 hours`);
  console.log("-".repeat(80));
  console.log("");

  let confirmed: boolean;
  if (process.stdin.isTTY) {
    confirmed = await promptConfirmation(rl);
    rl.close();
  } else {
    confirmed =
      confirmStr!.toLowerCase() === "y" || confirmStr!.toLowerCase() === "yes";
  }

  if (!confirmed) {
    console.log("Order cancelled.");
    process.exit(0);
  }

  console.log("");
  console.log("Checking/setting approval...");
  const { txHash } = await ensureTokenApproval(
    walletClient,
    publicClient,
    sourceToken.address,
    makerAccount.address,
    makingAmount
  );

  if (txHash) {
    console.log(`      Approval transaction: ${txHash}`);
  } else {
    console.log("      Already approved");
  }

  console.log("");
  console.log("Generating and signing order...");

  const orderParams: OrderParams = {
    makerAsset: sourceToken.address,
    takerAsset: outputToken.address,
    makingAmount,
    takingAmount,
    maker: makerAccount.address,
    expirationMinutes,
  };

  const signedOrder = await generateSignedOrder(orderParams, walletClient);
  const output = formatOrderOutput(signedOrder);

  console.log("      Order signed successfully");

  console.log("");
  console.log("Submitting order to filler...");
  const executeResult = await executeOrder(output);

  if (executeResult.success) {
    console.log("      Order submitted successfully");
    if (executeResult.message) {
      console.log(`      ${executeResult.message}`);
    }
  } else {
    console.log("      Order submission failed");
    if (executeResult.message) {
      console.log(`      ${executeResult.message}`);
    }
  }

  console.log("");
  console.log("=".repeat(80));
  console.log("ORDER OUTPUT");
  console.log("=".repeat(80));
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.log("Fatal error:", error);
  process.exit(1);
});
