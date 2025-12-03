import "dotenv/config";
import type { Hex } from "viem";

export const POLYGON_CHAIN_ID = 137;

function getPolygonRpcUrl(): string {
  const url = process.env.POLYGON_RPC_URL;
  if (!url) {
    throw new Error("POLYGON_RPC_URL environment variable is required.");
  }
  return url;
}

export const POLYGON_RPC_URL = getPolygonRpcUrl();

function getFillerApiUrl(): string {
  const url = process.env.FILLER_API_URL;
  if (!url) {
    throw new Error("FILLER_API_URL environment variable is required.");
  }
  return url;
}

export const FILLER_API_URL = getFillerApiUrl();

export const LIMIT_ORDER_PROTOCOL_ADDRESS =
  "0x111111125421ca6dc452d289314280a0f8842a65" as const;

export const TOKENS = {
  USDC: {
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as Hex,
    decimals: 6,
    symbol: "USDC",
  },
  USDT: {
    address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" as Hex,
    decimals: 6,
    symbol: "USDT",
  },
  BRLA: {
    address: "0xE6A537a407488807F0bbeb0038B79004f19DDDFb" as Hex,
    decimals: 18,
    symbol: "BRLA",
  },
} as const;

export type TokenSymbol = keyof typeof TOKENS;
export type TokenInfo = (typeof TOKENS)[TokenSymbol];

export const ORDER_CONFIG = {
  makerAsset: TOKENS.USDC,
  takerAsset: TOKENS.BRLA,
  expirationMinutes: 60,
} as const;

export function getTokenByAddress(address: string): TokenInfo | undefined {
  const lowerAddress = address.toLowerCase();
  return Object.values(TOKENS).find(
    (token) => token.address.toLowerCase() === lowerAddress
  );
}

export function getTokenBySymbol(symbol: string): TokenInfo | undefined {
  const upperSymbol = symbol.toUpperCase() as TokenSymbol;
  return TOKENS[upperSymbol];
}

export function getTakerPrivateKey(): Hex {
  const key = process.env.TAKER_PRIVATE_KEY;
  if (!key) {
    throw new Error("TAKER_PRIVATE_KEY environment variable is required.");
  }
  return key.startsWith("0x") ? (key as Hex) : (`0x${key}` as Hex);
}

export function formatTokenAmount(
  amount: bigint,
  decimals: number,
  symbol?: string
): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  const fractionStr = fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");

  const formatted = fractionStr ? `${whole}.${fractionStr}` : whole.toString();

  return symbol ? `${formatted} ${symbol}` : formatted;
}
