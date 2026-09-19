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
 */

import { NextRequest, NextResponse } from "next/server";
import { createOnrampServerKit, type OnrampServerKit } from "@circle-fin/onramp-kit/server";
import { createClient } from "@/lib/supabase/server";
import { DB_BLOCKCHAIN_TO_ONRAMP_CHAIN } from "@/lib/circle/onramp-chains";
import { ONRAMP_WIDGET_BASE_URL } from "@/lib/circle/onramp-environment";
import {
  ONRAMP_API_BASE_URL,
  assertOnrampSandbox,
  resolveReferrerDomain,
} from "@/lib/circle/onramp-server-environment";

// Constructed lazily (not at module scope): createOnrampServerKit validates
// kitKey eagerly and throws if it's missing, which would otherwise break
// Next's build-time page-data collection whenever KIT_KEY isn't set. The
// environment assertion runs here for the same reason.
let server: OnrampServerKit | undefined;

function getServer(): OnrampServerKit {
  if (!server) {
    // Both halves of the config have to agree, and both have to be sandbox:
    // unset means production, and this app only settles to testnets.
    assertOnrampSandbox();

    server = createOnrampServerKit({
      kitKey: process.env.KIT_KEY!,
      // Passed through verbatim. Undefined would leave the kit on its own
      // production defaults, which assertOnrampSandbox has just ruled out.
      baseUrl: ONRAMP_API_BASE_URL,
      widgetBaseUrl: ONRAMP_WIDGET_BASE_URL,
    });
  }
  return server;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const { walletId } = body ?? {};

    if (typeof walletId !== "string" || !walletId) {
      return NextResponse.json(
        { error: "walletId is required" },
        { status: 400 }
      );
    }

    // Resolve address/chain from a wallet the caller actually owns. Looking
    // up by the wallets.id primary key (rather than by address) avoids
    // ambiguity: Circle developer-controlled wallets reuse the same EVM
    // address across multiple chains within a wallet set, so a given
    // (user_id, address) pair can match several rows.
    const { data: wallet, error: walletError } = await supabase
      .from("wallets")
      .select("address, blockchain")
      .eq("user_id", user.id)
      .eq("id", walletId)
      .maybeSingle();

    if (walletError || !wallet) {
      return NextResponse.json(
        { error: "walletId does not belong to a wallet you own" },
        { status: 403 }
      );
    }

    // `destinationChain` is optional to the kit, but omitting it makes
    // wallets-api fall back to Ethereum *mainnet* — real fiat settling on a
    // chain this app never reads. Refuse to mint rather than guess.
    const destinationChain = DB_BLOCKCHAIN_TO_ONRAMP_CHAIN[wallet.blockchain];
    if (!destinationChain) {
      console.error(
        `No onramp chain mapping for blockchain "${wallet.blockchain}"`
      );
      return NextResponse.json(
        { error: `Onramp is not available for ${wallet.blockchain}` },
        { status: 400 }
      );
    }

    // Every session parameter is derived server-side; nothing from the request
    // body is forwarded. `referrerDomain` in particular is never taken from the
    // client: it's sealed into the session JWT and handed to the widget host as
    // a `frame-ancestors` CSP claim, so a caller-supplied value would let them
    // widen that allowlist to a domain of their choosing. resolveReferrerDomain
    // derives it instead, from the same server-side config the Gateway webhook
    // URL already comes from.
    const session = await getServer().createSession({
      userId: user.id, // never trust a client-supplied userId
      destinationAddress: wallet.address,
      destinationChain,
      referrerDomain: resolveReferrerDomain(),
    });

    return NextResponse.json(session, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    console.error("Error minting onramp session:", error);

    const statusByType: Record<string, number> = {
      INPUT: 400,
      RATE_LIMIT: 429,
      NETWORK: 504,
      SERVICE: 502,
      RPC: 502,
    };

    // KitError carries a `type` discriminator; anything else is a 500.
    const kitType =
      typeof error === "object" && error !== null && "type" in error
        ? String((error as { type: unknown }).type)
        : undefined;
    const message = error instanceof Error ? error.message : undefined;

    return NextResponse.json(
      { error: message || "Internal server error" },
      { status: (kitType ? statusByType[kitType] : undefined) ?? 500 }
    );
  }
}
