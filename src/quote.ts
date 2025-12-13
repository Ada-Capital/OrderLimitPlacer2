#!/usr/bin/env npx tsx

import * as readline from "readline";
import { parseUnits } from "viem";
import {
  VALID_PAIRS,
  getPairLabel,
  formatTokenAmount,
  type TradingPair,
} from "../config";
import { getQuote } from "../lib/quote";

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
    rl.question(`Enter amount of ${pair.source.symbol} to quote: `, (answer) => {
      resolve(answer.trim());
    });
  });

  return { pair, amount };
}

async function main(): Promise<void> {
  const rl = createReadline();

  console.log("=".repeat(60));
  console.log("STABLECOIN QUOTE");
  console.log("=".repeat(60));
  console.log("");

  let pair: TradingPair;
  let amountStr: string;

  if (process.stdin.isTTY) {
    const input = await promptInteractive(rl);
    pair = input.pair;
    amountStr = input.amount;
    rl.close();
  } else {
    const lines = await readAllLines(rl);
    const pairIndex = parseInt(lines[0] ?? "", 10) - 1;
    if (isNaN(pairIndex) || pairIndex < 0 || pairIndex >= VALID_PAIRS.length) {
      console.log("Error: Invalid pair selection.");
      process.exit(1);
    }
    pair = VALID_PAIRS[pairIndex];
    amountStr = lines[1] ?? "";

    console.log("Available trading pairs:");
    VALID_PAIRS.forEach((p, index) => {
      console.log(`  ${index + 1}. ${getPairLabel(p)}`);
    });
    console.log("");
    console.log(`Selected: ${getPairLabel(pair)}`);
    console.log("");
  }

  if (!amountStr) {
    console.log("Error: Amount is required.");
    process.exit(1);
  }

  const amountRaw = parseUnits(amountStr, pair.source.decimals);
  if (amountRaw <= 0n) {
    console.log("Error: Amount must be greater than zero.");
    process.exit(1);
  }

  console.log("Getting quote...");

  const quote = await getQuote(amountRaw, pair);

  console.log("");
  console.log("-".repeat(60));
  console.log(
    `  Input:  ${formatTokenAmount(quote.inputAmount, pair.source.decimals, pair.source.symbol)}`
  );
  console.log(
    `  Output: ${formatTokenAmount(quote.outputAmount, pair.output.decimals, pair.output.symbol)}`
  );
  console.log(`  Rate:   ${quote.rate} ${pair.output.symbol}/${pair.source.symbol}`);
  console.log("-".repeat(60));
}

main().catch((error) => {
  console.log("Fatal error:", error);
  process.exit(1);
});
