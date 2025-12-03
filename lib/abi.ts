// ============================================================================
// ERC20 ABI (minimal for balance, allowance, approve)
// ============================================================================

export const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// ============================================================================
// 1inch Limit Order Protocol ABI (fillOrder function and errors)
// ============================================================================

export const LIMIT_ORDER_PROTOCOL_ABI = [
  {
    inputs: [
      {
        components: [
          { name: "salt", type: "uint256" },
          { name: "maker", type: "uint256" },
          { name: "receiver", type: "uint256" },
          { name: "makerAsset", type: "uint256" },
          { name: "takerAsset", type: "uint256" },
          { name: "makingAmount", type: "uint256" },
          { name: "takingAmount", type: "uint256" },
          { name: "makerTraits", type: "uint256" },
        ],
        name: "order",
        type: "tuple",
      },
      { name: "r", type: "bytes32" },
      { name: "vs", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "takerTraits", type: "uint256" },
    ],
    name: "fillOrder",
    outputs: [
      { name: "", type: "uint256" },
      { name: "", type: "uint256" },
      { name: "", type: "bytes32" },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { name: "maker", type: "address" },
      { name: "orderHash", type: "bytes32" },
    ],
    name: "remainingInvalidatorForOrder",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Error definitions for decoding
  { inputs: [], name: "BadSignature", type: "error" },
  { inputs: [], name: "OrderExpired", type: "error" },
  { inputs: [], name: "InvalidatedOrder", type: "error" },
  { inputs: [], name: "TakingAmountExceeded", type: "error" },
  { inputs: [], name: "MakingAmountTooLow", type: "error" },
  { inputs: [], name: "PrivateOrder", type: "error" },
  { inputs: [], name: "PredicateIsNotTrue", type: "error" },
  { inputs: [], name: "TransferFromMakerToTakerFailed", type: "error" },
  { inputs: [], name: "TransferFromTakerToMakerFailed", type: "error" },
] as const;

