import { formatUnits } from "viem";
import { FILLER_API_URL, type TradingPair } from "../config";

export interface QuoteResult {
  inputAmount: bigint;
  outputAmount: bigint;
  rate: string;
  pair: TradingPair;
}

interface QuoteApiResponse {
  inputAmount: string;
  expectedOutput: string;
  rate: string;
}

export async function getQuote(
  inputAmountRaw: bigint,
  pair: TradingPair
): Promise<QuoteResult> {
  const amount = formatUnits(inputAmountRaw, pair.source.decimals);

  const response = await fetch(`${FILLER_API_URL}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      amount,
      sourceCurrency: pair.source.symbol,
      outputCurrency: pair.output.symbol,
    }),
  });

  if (!response.ok) {
    const error = (await response.json()) as { error?: string };
    throw new Error(`Quote failed: ${error.error ?? response.statusText}`);
  }

  const data = (await response.json()) as QuoteApiResponse;

  return {
    inputAmount: BigInt(data.inputAmount),
    outputAmount: BigInt(data.expectedOutput),
    rate: data.rate,
    pair,
  };
}
