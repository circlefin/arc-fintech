/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from "vitest";

import { arcTestnet } from "@/lib/circle/gateway-sdk";

describe("arcTestnet", () => {
  it("uses Arc's native currency scale and public explorer", () => {
    expect(arcTestnet.nativeCurrency).toEqual({
      name: "USD Coin",
      symbol: "USDC",
      decimals: 18,
    });
    expect(arcTestnet.blockExplorers.default).toEqual({
      name: "ArcScan",
      url: "https://testnet.arcscan.app",
    });
  });
});
