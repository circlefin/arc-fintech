/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface OwnedWalletRow {
  circle_wallet_id: string;
  address: string;
  blockchain: string;
}

/**
 * Verify that the supplied Circle wallet IDs all belong to `userId`. Returns
 * the matched rows on success, or null on failure (caller should 404).
 *
 * Without this check, an authenticated user could pass arbitrary Circle wallet
 * IDs and have the server proxy SDK calls against wallets owned by other
 * tenants (IDOR).
 */
export async function assertWalletsOwnedByUser(
  supabase: SupabaseClient,
  userId: string,
  walletIds: string[]
): Promise<OwnedWalletRow[] | null> {
  const unique = Array.from(new Set(walletIds.filter(Boolean)));
  if (unique.length === 0) return null;

  const { data, error } = await supabase
    .from("wallets")
    .select("circle_wallet_id, address, blockchain")
    .eq("user_id", userId)
    .in("circle_wallet_id", unique);

  if (error || !data) return null;
  if (data.length !== unique.length) return null;
  return data as OwnedWalletRow[];
}
