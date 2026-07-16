/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppKit } from "@circle-fin/app-kit"
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets"

export const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY ?? ""
export const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET ?? ""
export const ARC_SOURCE_ADDRESS =
  process.env.ARC_SOURCE_ADDRESS ?? "0x1111111111111111111111111111111111111111"
export const ARC_DELEGATE_ADDRESS =
  process.env.ARC_DELEGATE_ADDRESS ?? "0x2222222222222222222222222222222222222222"
export const ARC_RECIPIENT_ADDRESS =
  process.env.ARC_RECIPIENT_ADDRESS ?? "0x3333333333333333333333333333333333333333"
export const ARC_SPEND_AMOUNT = process.env.ARC_SPEND_AMOUNT ?? "0.002"

const ARC_CHAIN = "Arc_Testnet"
const TOKEN = "USDC"

const kit = new AppKit()
const adapter = createCircleWalletsAdapter({
  apiKey: CIRCLE_API_KEY,
  entitySecret: CIRCLE_ENTITY_SECRET,
})

const addDelegateResult = await kit.unifiedBalance.addDelegate({
  from: {
    adapter,
    address: ARC_SOURCE_ADDRESS,
    chain: ARC_CHAIN,
  },
  delegateAddress: ARC_DELEGATE_ADDRESS,
})
console.log(addDelegateResult)

const balancesResult = await kit.unifiedBalance.getBalances({
  token: TOKEN,
  sources: { address: ARC_SOURCE_ADDRESS },
  networkType: "testnet",
})
console.log(JSON.stringify(balancesResult, null, 2))

const spendResult = await kit.unifiedBalance.spend({
  from: {
    adapter,
    address: ARC_DELEGATE_ADDRESS,
    sourceAccount: ARC_SOURCE_ADDRESS,
    allocations: [{ amount: ARC_SPEND_AMOUNT, chain: ARC_CHAIN }],
  },
  to: {
    chain: ARC_CHAIN,
    recipientAddress: ARC_RECIPIENT_ADDRESS,
    useForwarder: true,
  },
  token: TOKEN,
  amount: ARC_SPEND_AMOUNT,
})
console.log(spendResult)
