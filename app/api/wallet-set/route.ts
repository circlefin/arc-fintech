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

import { NextRequest, NextResponse } from "next/server";
import { circleDeveloperSdk } from "@/lib/circle/developer-controlled-wallets-client";

export async function POST(req: NextRequest) {
  try {
    const { entityName } = await req.json();
    const apiKey = process.env.CIRCLE_API_KEY?.trim();
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET?.trim();

    if (!apiKey || !entitySecret) {
      return NextResponse.json(
        { error: "Circle API credentials are not configured" },
        { status: 500 }
      );
    }

    // Circle entity secret is generated as a 64-char hex string.
    if (!/^[a-fA-F0-9]{64}$/.test(entitySecret)) {
      return NextResponse.json(
        {
          error:
            "CIRCLE_ENTITY_SECRET format is invalid. Expected a 64-character hex string from Circle generateEntitySecret().",
        },
        { status: 500 }
      );
    }

    if (!entityName.trim()) {
      return NextResponse.json(
        { error: "entityName is required" },
        { status: 400 }
      );
    }

    const response = await circleDeveloperSdk.createWalletSet({
      name: entityName,
    });

    if (!response.data) {
      return NextResponse.json(
        "The response did not include a valid wallet set",
        { status: 500 }
      );
    }

    return NextResponse.json({ ...response.data.walletSet }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";

    if (error instanceof Error) {
      console.error(`Wallet set creation failed: ${error.message}`);
    }

    return NextResponse.json(
      {
        error: "Failed to create wallet set",
        details: message,
      },
      { status: 500 }
    );
  }
}
