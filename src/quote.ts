#!/usr/bin/env npx tsx

import * as readline from "readline";
import { parseUnits } from "viem";
import { ORDER_CONFIG, formatTokenAmount } from "../config";
import { getQuote } from "../lib/quote";

async function promptForAmount(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`Enter amount of ${ORDER_CONFIG.makerAsset.symbol} to quote: `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  const makerToken = ORDER_CONFIG.makerAsset;
  const takerToken = ORDER_CONFIG.takerAsset;

  console.log("=".repeat(60));
  console.log("USDC -> BRLA QUOTE");
  console.log("=".repeat(60));
  console.log("");

  const amountStr = await promptForAmount();

  if (!amountStr) {
    console.log("Error: Amount is required.");
    process.exit(1);
  }

  const amountRaw = parseUnits(amountStr, makerToken.decimals);
  if (amountRaw <= 0n) {
    console.log("Error: Amount must be greater than zero.");
    process.exit(1);
  }

  console.log("");
  console.log("Getting quote...");

  const quote = await getQuote(amountRaw);

  console.log("");
  console.log("-".repeat(60));
  console.log(`  Input:  ${formatTokenAmount(quote.inputAmount, makerToken.decimals, makerToken.symbol)}`);
  console.log(`  Output: ${formatTokenAmount(quote.outputAmount, takerToken.decimals, takerToken.symbol)}`);
  console.log(`  Rate:   ${quote.rate} BRLA/USDC`);
  console.log("-".repeat(60));
}

main().catch((error) => {
  console.log("Fatal error:", error);
  process.exit(1);
});

