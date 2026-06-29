/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it, vi } from "vitest"
import { assertWalletsOwnedByUser } from "@/lib/api/ownership"
import type { SupabaseClient } from "@supabase/supabase-js"

type StubResult = {
  data: Array<{ circle_wallet_id: string; address: string; blockchain: string }> | null
  error: { message: string } | null
}

/**
 * Builds the minimal supabase chainable stub used by the ownership helper:
 * `.from(...).select(...).eq(...).in(...)` resolves to `{ data, error }`.
 */
function makeSupabaseStub(result: StubResult): SupabaseClient {
  const inFn = vi.fn().mockResolvedValue(result)
  const eq = vi.fn().mockReturnValue({ in: inFn })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  return { from } as unknown as SupabaseClient
}

describe("assertWalletsOwnedByUser", () => {
  it("returns the matched rows when every requested id belongs to the user", async () => {
    const rows = [
      { circle_wallet_id: "wallet-a", address: "0xaaa", blockchain: "ETH-SEPOLIA" },
      { circle_wallet_id: "wallet-b", address: "0xbbb", blockchain: "BASE-SEPOLIA" },
    ]
    const supabase = makeSupabaseStub({ data: rows, error: null })

    const result = await assertWalletsOwnedByUser(supabase, "user-1", [
      "wallet-a",
      "wallet-b",
    ])
    expect(result).toEqual(rows)
  })

  it("returns null when one of the wallet ids does not belong to the user (IDOR guard)", async () => {
    const supabase = makeSupabaseStub({
      data: [
        { circle_wallet_id: "wallet-a", address: "0xaaa", blockchain: "ETH-SEPOLIA" },
      ],
      error: null,
    })

    const result = await assertWalletsOwnedByUser(supabase, "user-1", [
      "wallet-a",
      "wallet-someone-else",
    ])
    expect(result).toBeNull()
  })

  it("returns null on Supabase error rather than swallowing it", async () => {
    const supabase = makeSupabaseStub({
      data: null,
      error: { message: "boom" },
    })

    const result = await assertWalletsOwnedByUser(supabase, "user-1", ["wallet-a"])
    expect(result).toBeNull()
  })

  it("returns null on empty input rather than performing an unbounded query", async () => {
    const supabase = makeSupabaseStub({ data: [], error: null })
    const result = await assertWalletsOwnedByUser(supabase, "user-1", [])
    expect(result).toBeNull()
  })

  it("deduplicates ids before checking length, matching the SQL behaviour", async () => {
    const supabase = makeSupabaseStub({
      data: [
        { circle_wallet_id: "wallet-a", address: "0xaaa", blockchain: "ETH-SEPOLIA" },
      ],
      error: null,
    })
    const result = await assertWalletsOwnedByUser(supabase, "user-1", [
      "wallet-a",
      "wallet-a",
    ])
    expect(result).not.toBeNull()
    expect(result?.length).toBe(1)
  })
})
