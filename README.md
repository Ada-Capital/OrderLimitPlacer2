# OrderLimitPlacer

Generate and fill 1inch limit orders on Polygon.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with your values:

```
POLYGON_RPC_URL=https://polygon-rpc.com
MAKER_PRIVATE_KEY=0x...
```

## Get Quote

```bash
npm run quote
```

Example output:

```
============================================================
USDC -> BRLA QUOTE
============================================================

Enter amount of USDC to quote: 100

Getting quote...

------------------------------------------------------------
  Input:  100 USDC
  Output: 531.38 BRLA
  Rate:   5.3138 BRLA/USDC
------------------------------------------------------------
```

## Generate Order

```bash
npm run generate
```

Example output:

```
================================================================================
1INCH LIMIT ORDER GENERATOR
================================================================================

Enter amount of USDC to trade: 100

Getting quote...
      Input:  100 USDC
      Output: 500 BRLA

Maker Address: 0x4D9e1f35e8eEB9162207d51B7Aa7a6898BD27090
Order: USDC -> BRLA
Expiration: 60 minutes

Checking maker balance...
      Balance: 150 USDC
      Balance OK

--------------------------------------------------------------------------------
ORDER SUMMARY
--------------------------------------------------------------------------------
  You will sell:    100 USDC
  You will receive: 500 BRLA
  Expiration:       60 minutes
--------------------------------------------------------------------------------

Do you want to proceed with this order? (y/N): y

Checking/setting approval...
      Already approved

Generating and signing order...
      Order signed successfully

================================================================================
ORDER OUTPUT
================================================================================
{
  "orderHash": "0x...",
  "signature": "0x...",
  "order": { ... }
}
```
