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

export async function POST(request: NextRequest) {
  try {
    const { address, blockchain } = await request.json();

    if (!address || !blockchain) {
      return NextResponse.json(
        { error: "Address and blockchain are required" },
        { status: 400 }
      );
    }

    // Validate the address using Circle's API
    const response = await circleDeveloperSdk.validateAddress({
      address,
      blockchain,
    });

    return NextResponse.json({
      isValid: response.data?.isValid || false,
      address,
      blockchain,
    });
  } catch (error) {
    console.error("Address validation error:", error);
    return NextResponse.json(
      { 
        error: "Failed to validate address",
        isValid: false,
      },
      { status: 500 }
    );
  }
}
