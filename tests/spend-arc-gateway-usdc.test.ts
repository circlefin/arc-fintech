/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("scripts/spend-arc-gateway-usdc", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("builds adapter credentials and executes addDelegate -> getBalances -> spend flow", async () => {
    const addDelegateResult = { state: "added" };
    const balancesResult = { token: "USDC", totalConfirmedBalance: "4.018088" };
    const spendResult = { transferId: "transfer-123" };
    const adapter = { kind: "circle-wallets-adapter" };

    const addDelegate = vi.fn().mockResolvedValue(addDelegateResult);
    const getBalances = vi.fn().mockResolvedValue(balancesResult);
    const spend = vi.fn().mockResolvedValue(spendResult);

    const AppKitMock = vi.fn(function AppKit() {
      return {
        unifiedBalance: {
          addDelegate,
          getBalances,
          spend,
        },
      };
    });

    const createCircleWalletsAdapter = vi.fn(() => adapter);

    vi.doMock("@circle-fin/app-kit", () => ({
      AppKit: AppKitMock,
    }));

    vi.doMock("@circle-fin/adapter-circle-wallets", () => ({
      createCircleWalletsAdapter,
    }));

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const scriptModule = await import("../scripts/spend-arc-gateway-usdc.mjs");

    expect(AppKitMock).toHaveBeenCalledTimes(1);
    expect(createCircleWalletsAdapter).toHaveBeenCalledWith({
      apiKey: scriptModule.CIRCLE_API_KEY,
      entitySecret: scriptModule.CIRCLE_ENTITY_SECRET,
    });

    expect(addDelegate).toHaveBeenCalledTimes(1);
    expect(getBalances).toHaveBeenCalledTimes(1);
    expect(spend).toHaveBeenCalledTimes(1);

    const addDelegateInput = addDelegate.mock.calls[0]?.[0];
    expect(addDelegateInput).toEqual({
      from: {
        adapter,
        address: expect.stringMatching(/^0x[a-fA-F0-9]{40}$/),
        chain: "Arc_Testnet",
      },
      delegateAddress: expect.stringMatching(/^0x[a-fA-F0-9]{40}$/),
    });

    expect(getBalances).toHaveBeenCalledWith({
      token: "USDC",
      sources: { address: addDelegateInput.from.address },
      networkType: "testnet",
    });

    expect(spend).toHaveBeenCalledWith({
      from: {
        adapter,
        address: addDelegateInput.delegateAddress,
        sourceAccount: addDelegateInput.from.address,
        allocations: [{ amount: "0.002", chain: "Arc_Testnet" }],
      },
      to: {
        chain: "Arc_Testnet",
        recipientAddress: scriptModule.ARC_RECIPIENT_ADDRESS,
        useForwarder: true,
      },
      token: "USDC",
      amount: "0.002",
    });

    expect(consoleLog).toHaveBeenNthCalledWith(1, addDelegateResult);
    expect(consoleLog).toHaveBeenNthCalledWith(
      2,
      JSON.stringify(balancesResult, null, 2)
    );
    expect(consoleLog).toHaveBeenNthCalledWith(3, spendResult);
  });
});
