/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  screenRecipientForTransfer,
  shouldBlockTransfer,
} from "@/lib/compliance/utils"

const ADDRESS = "0x000000000000000000000000000000000000dEaD"

function mockFetchJson(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

describe("screenRecipientForTransfer", () => {
  beforeEach(() => {
    vi.stubEnv("CIRCLE_API_KEY", "test-key")
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("passes an approved address", async () => {
    const fetchMock = mockFetchJson({ data: { result: "APPROVED" } })

    const result = await screenRecipientForTransfer(ADDRESS, "ARC-TESTNET")

    expect(result).toBe("PASS")
    expect(shouldBlockTransfer(result)).toBe(false)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ address: ADDRESS, chain: "ARC-TESTNET" })
  })

  it("blocks a denied address", async () => {
    mockFetchJson({ data: { result: "DENIED" } })

    const result = await screenRecipientForTransfer(ADDRESS, "ARC-TESTNET")

    expect(result).toBe("FAIL")
    expect(shouldBlockTransfer(result)).toBe(true)
  })

  it("does not block an address flagged for review", async () => {
    mockFetchJson({ data: { result: "UNKNOWN", decision: { actions: ["REVIEW"] } } })

    const result = await screenRecipientForTransfer(ADDRESS, "ARC-TESTNET")

    expect(result).toBe("REVIEW")
    expect(shouldBlockTransfer(result)).toBe(false)
  })

  it("fails closed when Circle returns an error status", async () => {
    mockFetchJson({ message: "internal" }, 500)

    const result = await screenRecipientForTransfer(ADDRESS, "ARC-TESTNET")

    expect(result).toBe("ERROR")
    expect(shouldBlockTransfer(result)).toBe(true)
  })

  it("fails closed when the request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))

    const result = await screenRecipientForTransfer(ADDRESS, "ARC-TESTNET")

    expect(result).toBe("ERROR")
    expect(shouldBlockTransfer(result)).toBe(true)
  })

  it("fails closed when CIRCLE_API_KEY is missing", async () => {
    vi.stubEnv("CIRCLE_API_KEY", "")
    const fetchMock = mockFetchJson({ data: { result: "APPROVED" } })

    const result = await screenRecipientForTransfer(ADDRESS, "ARC-TESTNET")

    expect(result).toBe("ERROR")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
