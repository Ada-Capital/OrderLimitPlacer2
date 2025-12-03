import { ORDER_CONFIG } from "../config";

export interface QuoteResult {
  inputAmount: bigint;
  outputAmount: bigint;
  inputToken: typeof ORDER_CONFIG.makerAsset;
  outputToken: typeof ORDER_CONFIG.takerAsset;
}

export async function getQuote(inputAmountRaw: bigint): Promise<QuoteResult> {
  const inputToken = ORDER_CONFIG.makerAsset;
  const outputToken = ORDER_CONFIG.takerAsset;

  const outputAmount = await fetchQuoteFromApi(inputAmountRaw);

  return {
    inputAmount: inputAmountRaw,
    outputAmount,
    inputToken,
    outputToken,
  };
}

async function fetchQuoteFromApi(inputAmountRaw: bigint): Promise<bigint> {
  // TODO: implement quote API
  //
  // const response = await fetch(`${QUOTE_API_URL}/quote`, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({
  //     inputToken: ORDER_CONFIG.makerAsset.address,
  //     outputToken: ORDER_CONFIG.takerAsset.address,
  //     inputAmount: inputAmountRaw.toString(),
  //   }),
  // });
  //
  // const data = await response.json();
  // return BigInt(data.outputAmount);

  // Hardcoded rate: 1 USDC = 5 BRLA
  // USDC has 6 decimals, BRLA has 18 decimals
  const rateNumerator = 5n;
  const decimalAdjustment = 10n ** 12n;

  return inputAmountRaw * rateNumerator * decimalAdjustment;
}
