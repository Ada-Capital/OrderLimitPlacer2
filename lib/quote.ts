import { formatUnits } from "viem";
import { ORDER_CONFIG, FILLER_API_URL } from "../config";

export interface QuoteResult {
  inputAmount: bigint;
  outputAmount: bigint;
  rate: string;
  inputToken: typeof ORDER_CONFIG.makerAsset;
  outputToken: typeof ORDER_CONFIG.takerAsset;
}

interface QuoteApiResponse {
  inputAmount: string;
  expectedOutput: string;
  rate: string;
}

export async function getQuote(inputAmountRaw: bigint): Promise<QuoteResult> {
  const inputToken = ORDER_CONFIG.makerAsset;
  const outputToken = ORDER_CONFIG.takerAsset;

  const amountUSDC = formatUnits(inputAmountRaw, inputToken.decimals);

  const response = await fetch(`${FILLER_API_URL}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amountUSDC }),
  });

  if (!response.ok) {
    const error = await response.json() as { error?: string };
    throw new Error(`Quote failed: ${error.error ?? response.statusText}`);
  }

  const data = await response.json() as QuoteApiResponse;

  return {
    inputAmount: BigInt(data.inputAmount),
    outputAmount: BigInt(data.expectedOutput),
    rate: data.rate,
    inputToken,
    outputToken,
  };
}
