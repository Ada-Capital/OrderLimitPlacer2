#!/usr/bin/env npx tsx

import * as readline from "readline";
import type { Hex } from "viem";
import { parseUnits } from "viem";
import { ORDER_CONFIG, formatTokenAmount } from "../config";
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

async function readLines(): Promise<string[]> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY ?? false,
  });

  const lines: string[] = [];

  return new Promise((resolve) => {
    rl.on("line", (line) => {
      lines.push(line.trim());
    });
    rl.on("close", () => {
      resolve(lines);
    });

    if (process.stdin.isTTY) {
      rl.question("Enter amount of USDC to trade: ", (amount) => {
        lines.push(amount.trim());
        rl.question("Do you want to proceed with this order? (y/N): ", (confirm) => {
          lines.push(confirm.trim());
          rl.close();
        });
      });
    }
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
  const makerToken = ORDER_CONFIG.makerAsset;
  const takerToken = ORDER_CONFIG.takerAsset;
  const expirationMinutes = ORDER_CONFIG.expirationMinutes;

  console.log("=".repeat(80));
  console.log("1INCH LIMIT ORDER GENERATOR");
  console.log("=".repeat(80));
  console.log("");

  const lines = await readLines();
  const amountStr = lines[0];
  
  if (!amountStr) {
    console.log("Error: Amount is required.");
    process.exit(1);
  }

  const makingAmountRaw = parseUnits(amountStr, makerToken.decimals);
  if (makingAmountRaw <= 0n) {
    console.log("Error: Amount must be greater than zero.");
    process.exit(1);
  }

  console.log("");
  console.log("Getting quote...");
  const quote = await getQuote(makingAmountRaw);
  const makingAmount = quote.inputAmount;
  const takingAmount = quote.outputAmount;

  console.log(`      Input:  ${formatTokenAmount(makingAmount, makerToken.decimals, makerToken.symbol)}`);
  console.log(`      Output: ${formatTokenAmount(takingAmount, takerToken.decimals, takerToken.symbol)}`);
  console.log(`      Rate:   ${quote.rate} BRLA/USDC`);

  const makerAccount = createAccountFromPrivateKey(makerPrivateKey);
  const publicClient = createPolygonPublicClient();
  const walletClient = createPolygonWalletClient(makerAccount);

  console.log("");
  console.log(`Maker Address: ${makerAccount.address}`);
  console.log(`Order: ${makerToken.symbol} -> ${takerToken.symbol}`);
  console.log(`Expiration: ${expirationMinutes} minutes`);
  console.log("");

  console.log("Checking maker balance...");
  const { sufficient, balance } = await validateSufficientBalance(
    publicClient,
    makerToken.address,
    makerAccount.address,
    makingAmount
  );

  console.log(`      Balance: ${formatTokenAmount(balance, makerToken.decimals, makerToken.symbol)}`);

  if (!sufficient) {
    console.log("");
    console.log(`Error: Insufficient ${makerToken.symbol} balance.`);
    console.log(`Required: ${formatTokenAmount(makingAmount, makerToken.decimals, makerToken.symbol)}`);
    console.log(`Available: ${formatTokenAmount(balance, makerToken.decimals, makerToken.symbol)}`);
    process.exit(1);
  }
  console.log("      Balance OK");

  console.log("");
  console.log("-".repeat(80));
  console.log("ORDER SUMMARY");
  console.log("-".repeat(80));
  console.log(`  You will sell:    ${formatTokenAmount(makingAmount, makerToken.decimals, makerToken.symbol)}`);
  console.log(`  You will receive: ${formatTokenAmount(takingAmount, takerToken.decimals, takerToken.symbol)}`);
  console.log(`  Rate:             ${quote.rate} BRLA/USDC`);
  console.log(`  Expiration:       ${expirationMinutes} minutes`);
  console.log("-".repeat(80));
  console.log("");

  const confirmStr = lines[1] ?? "";
  const confirmed = confirmStr.toLowerCase() === "y" || confirmStr.toLowerCase() === "yes";
  
  if (!confirmed) {
    console.log("Order cancelled.");
    process.exit(0);
  }

  console.log("");
  console.log("Checking/setting approval...");
  const { txHash } = await ensureTokenApproval(
    walletClient,
    publicClient,
    makerToken.address,
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
    makerAsset: makerToken.address,
    takerAsset: takerToken.address,
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
    console.log(`      TX ID: ${executeResult.txId}`);
  } else {
    console.log("      Order submission failed");
    console.log(`      Error: ${executeResult.error}`);
    if (executeResult.details) {
      console.log(`      Details: ${executeResult.details}`);
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
