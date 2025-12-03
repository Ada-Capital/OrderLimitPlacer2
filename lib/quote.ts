import { ORDER_CONFIG } from "../config";

// ============================================================================
// Types
// ============================================================================

export interface QuoteResult {
  inputAmount: bigint;
  outputAmount: bigint;
  inputToken: typeof ORDER_CONFIG.makerAsset;
  outputToken: typeof ORDER_CONFIG.takerAsset;
}

// ============================================================================
// Quote Functions
// ============================================================================

/**
 * Get a quote for swapping USDC to BRLA
 *
 * @param inputAmountRaw - Amount of USDC in smallest units (6 decimals)
 * @returns Quote result with output amount in BRLA (18 decimals)
 */
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

/**
 * Fetch quote from the quoting API
 *
 * TODO: Implement actual API call
 * Currently returns a hardcoded rate for testing
 */
async function fetchQuoteFromApi(inputAmountRaw: bigint): Promise<bigint> {
  // TODO: Implement actual quote API call
  // Example API call structure:
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

  // Hardcoded rate for testing: 1 USDC = 5 BRLA
  // USDC has 6 decimals, BRLA has 18 decimals
  // To convert: outputAmount = inputAmount * rate * (10^18 / 10^6)
  // = inputAmount * 5 * 10^12
  const rateNumerator = 5n;
  const decimalAdjustment = 10n ** 12n; // 18 - 6 = 12 decimals difference

  return inputAmountRaw * rateNumerator * decimalAdjustment;
}

