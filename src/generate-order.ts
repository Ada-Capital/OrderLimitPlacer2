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

function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function promptForAmount(rl: readline.Interface): Promise<string> {
  const makerToken = ORDER_CONFIG.makerAsset;

  while (true) {
    const answer = await prompt(rl, `Enter amount of ${makerToken.symbol} to trade: `);

    if (!answer) {
      console.log("Amount is required.");
      continue;
    }

    const parsed = parseUnits(answer, makerToken.decimals);
    if (parsed <= 0n) {
      console.log("Amount must be greater than zero.");
      continue;
    }

    return answer;
  }
}

async function promptForConfirmation(rl: readline.Interface): Promise<boolean> {
  const answer = await prompt(rl, "Do you want to proceed with this order? (y/N): ");
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
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
  const rl = createReadlineInterface();

  try {
    const makerPrivateKey = getMakerPrivateKey();
    const makerToken = ORDER_CONFIG.makerAsset;
    const takerToken = ORDER_CONFIG.takerAsset;
    const expirationMinutes = ORDER_CONFIG.expirationMinutes;

    console.log("=".repeat(80));
    console.log("1INCH LIMIT ORDER GENERATOR");
    console.log("=".repeat(80));
    console.log("");

    const amountStr = await promptForAmount(rl);
    const makingAmountRaw = parseUnits(amountStr, makerToken.decimals);

    console.log("");
    console.log("Getting quote...");
    const quote = await getQuote(makingAmountRaw);
    const makingAmount = quote.inputAmount;
    const takingAmount = quote.outputAmount;

    console.log(`      Input:  ${formatTokenAmount(makingAmount, makerToken.decimals, makerToken.symbol)}`);
    console.log(`      Output: ${formatTokenAmount(takingAmount, takerToken.decimals, takerToken.symbol)}`);
    console.log(`      Quote Rate:  ${formatTokenAmount(makingAmount / takingAmount, makerToken.decimals, makerToken.symbol)}`);

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
    console.log(`  Expiration:       ${expirationMinutes} minutes`);
    console.log("-".repeat(80));
    console.log("");

    const confirmed = await promptForConfirmation(rl);
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
    console.log("=".repeat(80));
    console.log("ORDER OUTPUT");
    console.log("=".repeat(80));

    console.log(JSON.stringify(output, null, 2));
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.log("Fatal error:", error);
  process.exit(1);
});
