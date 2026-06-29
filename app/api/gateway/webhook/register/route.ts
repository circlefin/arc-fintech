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

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { syncGatewayWebhookSubscription } from "@/lib/circle/gateway-webhooks";

/**
 * Register the calling user's wallet addresses with the app's Gateway
 * permissionless webhook subscription, so Circle delivers
 * `gateway.deposit.finalized` events for their deposits. Idempotent — safe to
 * call repeatedly (e.g. after creating wallets). Addresses accumulate across
 * users on the single shared subscription.
 */
export const POST = withAuth(async (_req, { user, supabase }) => {
  try {
    const { data: wallets, error } = await supabase
      .from("wallets")
      .select("address")
      .eq("user_id", user.id)
      .not("address", "is", null);

    if (error) {
      console.error("Failed to load wallet addresses for registration:", error);
      return NextResponse.json(
        { error: "Failed to load wallet addresses" },
        { status: 500 }
      );
    }

    const addresses = (wallets ?? [])
      .map((w) => w.address as string | null)
      .filter((a): a is string => !!a);

    const result = await syncGatewayWebhookSubscription(addresses);

    if (result.status === "skipped") {
      return NextResponse.json(
        { success: false, status: result.status, reason: result.reason },
        { status: 200 }
      );
    }

    return NextResponse.json({
      success: true,
      status: result.status,
      subscriptionId: result.subscription.id,
      addresses: result.subscription.addresses ?? [],
      domains: result.subscription.domains ?? [],
    });
  } catch (error) {
    console.error("Gateway webhook registration failed:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
