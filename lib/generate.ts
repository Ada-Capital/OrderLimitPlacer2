import type { Hex } from "viem";
import { parseUnits } from "viem";
import {
  ORDER_EXPIRATION_MINUTES,
  formatTokenAmount,
  getPairLabel,
  type TradingPair,
} from "../config";
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
  pair: TradingPair;
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
  const {
    makerPrivateKey,
    amountStr,
    pair,
    skipApproval = false,
    silent = false,
  } = options;

  const sourceToken = pair.source;
  const outputToken = pair.output;
  const expirationMinutes = ORDER_EXPIRATION_MINUTES;

  const makingAmountRaw = parseUnits(amountStr, sourceToken.decimals);
  if (makingAmountRaw <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }

  log(silent, "Getting quote...");
  const quote = await getQuote(makingAmountRaw, pair);
  const makingAmount = quote.inputAmount;
  const takingAmount = quote.outputAmount;

  log(
    silent,
    `      Input:  ${formatTokenAmount(makingAmount, sourceToken.decimals, sourceToken.symbol)}`
  );
  log(
    silent,
    `      Output: ${formatTokenAmount(takingAmount, outputToken.decimals, outputToken.symbol)}`
  );
  log(silent, `      Rate:   ${quote.rate} ${outputToken.symbol}/${sourceToken.symbol}`);

  const makerAccount = createAccountFromPrivateKey(makerPrivateKey);
  const publicClient = createPolygonPublicClient();
  const walletClient = createPolygonWalletClient(makerAccount);

  log(silent, "");
  log(silent, `Maker Address: ${makerAccount.address}`);
  log(silent, `Order: ${getPairLabel(pair)}`);
  log(silent, `Expiration: ${expirationMinutes} minutes`);
  log(silent, "");

  log(silent, "Checking maker balance...");
  const { sufficient, balance } = await validateSufficientBalance(
    publicClient,
    sourceToken.address,
    makerAccount.address,
    makingAmount
  );

  log(
    silent,
    `      Balance: ${formatTokenAmount(balance, sourceToken.decimals, sourceToken.symbol)}`
  );

  if (!sufficient) {
    throw new Error(
      `Insufficient ${sourceToken.symbol} balance. Required: ${formatTokenAmount(makingAmount, sourceToken.decimals, sourceToken.symbol)}, Available: ${formatTokenAmount(balance, sourceToken.decimals, sourceToken.symbol)}`
    );
  }
  log(silent, "      Balance OK");

  if (!skipApproval) {
    log(silent, "");
    log(silent, "Checking/setting approval...");
    const { txHash } = await ensureTokenApproval(
      walletClient,
      publicClient,
      sourceToken.address,
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
    makerAsset: sourceToken.address,
    takerAsset: outputToken.address,
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
