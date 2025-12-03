import {
  LimitOrder,
  MakerTraits,
  Address as SDKAddress,
  Extension,
} from "@1inch/limit-order-sdk";
import type { Hex, WalletClient } from "viem";
import { POLYGON_CHAIN_ID, LIMIT_ORDER_PROTOCOL_ADDRESS } from "../config";

// ============================================================================
// Types
// ============================================================================

export interface OrderParams {
  makerAsset: Hex;
  takerAsset: Hex;
  makingAmount: bigint;
  takingAmount: bigint;
  maker: Hex;
  receiver?: Hex;
  expirationMinutes?: number;
}

export interface SignedOrder {
  order: LimitOrder;
  signature: Hex;
  orderHash: string;
  orderData: ReturnType<LimitOrder["build"]>;
}

export interface OrderOutput {
  orderHash: string;
  signature: Hex;
  order: {
    salt: string;
    maker: string;
    receiver: string;
    makerAsset: string;
    takerAsset: string;
    makingAmount: string;
    takingAmount: string;
    makerTraits: string;
  };
}

// ============================================================================
// Order Building
// ============================================================================

export function buildMakerTraits(expirationMinutes: number): MakerTraits {
  const expirationTimestamp = BigInt(
    Math.floor(Date.now() / 1000) + expirationMinutes * 60
  );

  return MakerTraits.default()
    .withExpiration(expirationTimestamp)
    .allowPartialFills()
    .allowMultipleFills();
}

export function createLimitOrder(params: OrderParams): LimitOrder {
  const {
    makerAsset,
    takerAsset,
    makingAmount,
    takingAmount,
    maker,
    receiver,
    expirationMinutes = 60,
  } = params;

  const makerTraits = buildMakerTraits(expirationMinutes);

  const order = new LimitOrder(
    {
      makerAsset: new SDKAddress(makerAsset),
      takerAsset: new SDKAddress(takerAsset),
      makingAmount,
      takingAmount,
      maker: new SDKAddress(maker),
      receiver: new SDKAddress(receiver ?? maker),
    },
    makerTraits,
    Extension.default(),
    { optimizeReceiverAddress: false }
  );

  return order;
}

// ============================================================================
// Order Signing
// ============================================================================

export async function signOrder(
  order: LimitOrder,
  walletClient: WalletClient
): Promise<Hex> {
  if (!walletClient.account) {
    throw new Error("Wallet client must have an account");
  }

  const typedData = order.getTypedData(POLYGON_CHAIN_ID);

  const signature = await walletClient.signTypedData({
    account: walletClient.account,
    domain: typedData.domain,
    types: { Order: typedData.types[typedData.primaryType] },
    primaryType: "Order" as const,
    message: typedData.message,
  });

  return signature;
}

// ============================================================================
// Order Hash Computation
// ============================================================================

export function computeOrderHash(order: LimitOrder): string {
  const typedData = order.getTypedData(POLYGON_CHAIN_ID);
  // The order hash is derived from the typed data structure
  // For display purposes, we use the salt as a unique identifier
  return `0x${order.salt.toString(16).padStart(64, "0")}`;
}

// ============================================================================
// Full Order Generation
// ============================================================================

export async function generateSignedOrder(
  params: OrderParams,
  walletClient: WalletClient
): Promise<SignedOrder> {
  const order = createLimitOrder(params);
  const signature = await signOrder(order, walletClient);
  const orderHash = computeOrderHash(order);
  const orderData = order.build();

  return {
    order,
    signature,
    orderHash,
    orderData,
  };
}

// ============================================================================
// Output Formatting
// ============================================================================

export function formatOrderOutput(signedOrder: SignedOrder): OrderOutput {
  const { signature, orderHash, orderData } = signedOrder;

  return {
    orderHash,
    signature,
    order: {
      salt: orderData.salt.toString(),
      maker: orderData.maker,
      receiver: orderData.receiver,
      makerAsset: orderData.makerAsset,
      takerAsset: orderData.takerAsset,
      makingAmount: orderData.makingAmount.toString(),
      takingAmount: orderData.takingAmount.toString(),
      makerTraits: orderData.makerTraits.toString(),
    },
  };
}

// ============================================================================
// Signature Parsing (for fillOrder)
// ============================================================================

export function parseSignatureToCompact(signature: Hex): { r: Hex; vs: Hex } {
  const sig = signature.startsWith("0x") ? signature.slice(2) : signature;

  if (sig.length !== 130) {
    throw new Error(
      `Invalid signature length: expected 130 hex chars, got ${sig.length}`
    );
  }

  const r = `0x${sig.slice(0, 64)}` as Hex;
  const s = sig.slice(64, 128);
  const v = parseInt(sig.slice(128, 130), 16);

  const sBigInt = BigInt(`0x${s}`);
  const vsBigInt = v === 28 ? sBigInt | (1n << 255n) : sBigInt;
  const vs = `0x${vsBigInt.toString(16).padStart(64, "0")}` as Hex;

  return { r, vs };
}

