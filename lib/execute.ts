import type { Hex } from "viem";
import { FILLER_API_URL } from "../config";
import { parseSignatureToCompact, type OrderOutput } from "./order";

export interface ExecuteRequest {
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
  signature: string;
  r: string;
  vs: string;
}

export interface ExecuteResponse {
  success: boolean;
  message?: string;
  txId?: string;
  error?: string;
  details?: string;
}

function buildExecuteRequest(orderOutput: OrderOutput): ExecuteRequest {
  const { r, vs } = parseSignatureToCompact(orderOutput.signature);

  return {
    order: {
      salt: orderOutput.order.salt,
      maker: orderOutput.order.maker,
      receiver: orderOutput.order.receiver,
      makerAsset: orderOutput.order.makerAsset,
      takerAsset: orderOutput.order.takerAsset,
      makingAmount: orderOutput.order.makingAmount,
      takingAmount: orderOutput.order.takingAmount,
      makerTraits: orderOutput.order.makerTraits,
    },
    signature: orderOutput.signature,
    r,
    vs,
  };
}

export async function executeOrder(orderOutput: OrderOutput): Promise<ExecuteResponse> {
  const request = buildExecuteRequest(orderOutput);

  const response = await fetch(`${FILLER_API_URL}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  const data = await response.json() as ExecuteResponse;
  return data;
}

