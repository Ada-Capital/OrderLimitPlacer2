import type { Hex } from "viem";
import { parseUnits } from "viem";
import { ORDER_CONFIG, formatTokenAmount } from "../config";
import {
  createPolygonPublicClient,
  createPolygonWalletClient,
  createAccountFromPrivateKey,
  validateSufficientBalance,
  ensureTokenApproval,
} from "./blockchain";
import {
  generateSignedOrder,
  formatOrderOutput,
  type OrderParams,
  type OrderOutput,
} from "./order";
import { getQuote, type QuoteResult } from "./quote";

export interface GenerateOrderOptions {
  makerPrivateKey: Hex;
  amountStr: string;
  skipApproval?: boolean;
  silent?: boolean;
}

export interface GenerateOrderResult {
  order: OrderOutput;
  quote: QuoteResult;
  makerAddress: Hex;
}

function log(silent: boolean, ...args: unknown[]) {
  if (!silent) {
    console.log(...args);
  }
}

export async function generateOrder(
  options: GenerateOrderOptions
): Promise<GenerateOrderResult> {
  const { makerPrivateKey, amountStr, skipApproval = false, silent = false } = options;

  const makerToken = ORDER_CONFIG.makerAsset;
  const takerToken = ORDER_CONFIG.takerAsset;
  const expirationMinutes = ORDER_CONFIG.expirationMinutes;

  const makingAmountRaw = parseUnits(amountStr, makerToken.decimals);
  if (makingAmountRaw <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }

  log(silent, "Getting quote...");
  const quote = await getQuote(makingAmountRaw);
  const makingAmount = quote.inputAmount;
  const takingAmount = quote.outputAmount;

  log(silent, `      Input:  ${formatTokenAmount(makingAmount, makerToken.decimals, makerToken.symbol)}`);
  log(silent, `      Output: ${formatTokenAmount(takingAmount, takerToken.decimals, takerToken.symbol)}`);
  log(silent, `      Rate:   ${quote.rate} BRLA/USDC`);

  const makerAccount = createAccountFromPrivateKey(makerPrivateKey);
  const publicClient = createPolygonPublicClient();
  const walletClient = createPolygonWalletClient(makerAccount);

  log(silent, "");
  log(silent, `Maker Address: ${makerAccount.address}`);
  log(silent, `Order: ${makerToken.symbol} -> ${takerToken.symbol}`);
  log(silent, `Expiration: ${expirationMinutes} minutes`);
  log(silent, "");

  log(silent, "Checking maker balance...");
  const { sufficient, balance } = await validateSufficientBalance(
    publicClient,
    makerToken.address,
    makerAccount.address,
    makingAmount
  );

  log(silent, `      Balance: ${formatTokenAmount(balance, makerToken.decimals, makerToken.symbol)}`);

  if (!sufficient) {
    throw new Error(
      `Insufficient ${makerToken.symbol} balance. Required: ${formatTokenAmount(makingAmount, makerToken.decimals, makerToken.symbol)}, Available: ${formatTokenAmount(balance, makerToken.decimals, makerToken.symbol)}`
    );
  }
  log(silent, "      Balance OK");

  if (!skipApproval) {
    log(silent, "");
    log(silent, "Checking/setting approval...");
    const { txHash } = await ensureTokenApproval(
      walletClient,
      publicClient,
      makerToken.address,
      makerAccount.address,
      makingAmount
    );

    if (txHash) {
      log(silent, `      Approval transaction: ${txHash}`);
    } else {
      log(silent, "      Already approved");
    }
  }

  log(silent, "");
  log(silent, "Generating and signing order...");

  const orderParams: OrderParams = {
    makerAsset: makerToken.address,
    takerAsset: takerToken.address,
    makingAmount,
    takingAmount,
    maker: makerAccount.address,
    expirationMinutes,
  };

  const signedOrder = await generateSignedOrder(orderParams, walletClient);
  const order = formatOrderOutput(signedOrder);

  log(silent, "      Order signed successfully");

  return {
    order,
    quote,
    makerAddress: makerAccount.address,
  };
}

