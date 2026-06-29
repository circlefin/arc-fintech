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

/**
 * Circle App Kit + Circle Wallets adapter singletons.
 *
 * The App Kit Unified Balance SDK is the supported abstraction over the
 * Circle Gateway protocol — it bundles the per-chain approve + deposit dance
 * (previously hand-rolled in `gateway-sdk.ts`) and the Gateway balance HTTP
 * call into a single `kit.unifiedBalance.*` interface.
 *
 * The Circle Wallets adapter is a *developer-controlled* adapter: each
 * `deposit` / `getBalances` call must pass `{ adapter, chain, address }`
 * because one adapter instance fronts every Circle wallet on this Circle
 * Console account. The adapter resolves which wallet to use from the
 * `address` (the Circle wallet's own EVM address), so the deposit route
 * keeps using the existing `wallet.address` from Supabase.
 *
 * Both objects are cached at module scope. They are lazy-initialised so
 * that any misconfigured `CIRCLE_API_KEY` / `CIRCLE_ENTITY_SECRET` fails on
 * first use rather than crashing the process at module load — keeps Next.js
 * route discovery from breaking when env is partially set.
 *
 * Server-side only: `@circle-fin/adapter-circle-wallets` calls Circle's
 * Developer Controlled Wallets API with the entity secret, which must never
 * touch the browser bundle.
 */

import "server-only"

import { AppKit } from "@circle-fin/app-kit"
import {
  createCircleWalletsAdapter,
  type CircleWalletsAdapter,
} from "@circle-fin/adapter-circle-wallets"

let cachedAppKit: AppKit | null = null
let cachedAdapter: CircleWalletsAdapter | null = null

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        "Set it in .env.local before calling Circle App Kit."
    )
  }
  return value
}

export function getAppKit(): AppKit {
  if (!cachedAppKit) {
    cachedAppKit = new AppKit()
  }
  return cachedAppKit
}

export function createCircleWalletsAdapterInstance(): CircleWalletsAdapter {
  return createCircleWalletsAdapter({
    apiKey: requireEnv("CIRCLE_API_KEY"),
    entitySecret: requireEnv("CIRCLE_ENTITY_SECRET"),
  })
}

export function getCircleWalletsAdapter(): CircleWalletsAdapter {
  if (!cachedAdapter) {
    cachedAdapter = createCircleWalletsAdapterInstance()
  }
  return cachedAdapter
}
