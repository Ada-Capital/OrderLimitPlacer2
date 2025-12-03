import {
  createPublicClient,
  createWalletClient,
  http,
  maxUint256,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Account,
} from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ERC20_ABI } from "./abi";
import { POLYGON_RPC_URL, LIMIT_ORDER_PROTOCOL_ADDRESS } from "../config";

// ============================================================================
// Client Creation
// ============================================================================

export function createPolygonPublicClient(): PublicClient {
  return createPublicClient({
    chain: polygon,
    transport: http(POLYGON_RPC_URL),
  });
}

export function createPolygonWalletClient(account: Account): WalletClient {
  return createWalletClient({
    chain: polygon,
    transport: http(POLYGON_RPC_URL),
    account,
  });
}

export function createAccountFromPrivateKey(privateKey: Hex): Account {
  return privateKeyToAccount(privateKey);
}

// ============================================================================
// Token Operations
// ============================================================================

export async function getTokenBalance(
  client: PublicClient,
  tokenAddress: Hex,
  owner: Hex
): Promise<bigint> {
  const balance = await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
  return balance;
}

export async function getTokenAllowance(
  client: PublicClient,
  tokenAddress: Hex,
  owner: Hex,
  spender: Hex
): Promise<bigint> {
  const allowance = await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });
  return allowance;
}

export async function approveToken(
  walletClient: WalletClient,
  publicClient: PublicClient,
  tokenAddress: Hex,
  spender: Hex,
  amount: bigint = maxUint256
): Promise<Hex> {
  if (!walletClient.account) {
    throw new Error("Wallet client must have an account");
  }

  const hash = await walletClient.writeContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, amount],
    chain: polygon,
    account: walletClient.account,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// ============================================================================
// Approval Check and Execute
// ============================================================================

export async function ensureTokenApproval(
  walletClient: WalletClient,
  publicClient: PublicClient,
  tokenAddress: Hex,
  owner: Hex,
  requiredAmount: bigint
): Promise<{ approved: boolean; txHash?: Hex }> {
  const currentAllowance = await getTokenAllowance(
    publicClient,
    tokenAddress,
    owner,
    LIMIT_ORDER_PROTOCOL_ADDRESS as Hex
  );

  if (currentAllowance >= requiredAmount) {
    return { approved: true };
  }

  const txHash = await approveToken(
    walletClient,
    publicClient,
    tokenAddress,
    LIMIT_ORDER_PROTOCOL_ADDRESS as Hex
  );

  return { approved: true, txHash };
}

// ============================================================================
// Balance Validation
// ============================================================================

export async function validateSufficientBalance(
  client: PublicClient,
  tokenAddress: Hex,
  owner: Hex,
  requiredAmount: bigint
): Promise<{ sufficient: boolean; balance: bigint }> {
  const balance = await getTokenBalance(client, tokenAddress, owner);
  return {
    sufficient: balance >= requiredAmount,
    balance,
  };
}

