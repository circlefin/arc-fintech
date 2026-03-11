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
import { createClient } from "@/lib/supabase/server";
import { storeGatewayEOAWalletsForUser } from "@/lib/circle/create-gateway-eoa-wallets";

/**
 * POST /api/wallet/create-gateway-signers
 * Creates Gateway EOA signer wallets for the authenticated user
 * This should be called during user onboarding (after successful signup)
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user already has Gateway signer wallets
    const { data: existingWallets, error: checkError } = await supabase
      .from("wallets")
      .select("id")
      .eq("user_id", user.id)
      .eq("type", "gateway_signer")
      .limit(1);

    if (checkError) {
      console.error("Error checking existing wallets:", checkError);
      return NextResponse.json(
        { error: "Failed to check existing wallets" },
        { status: 500 }
      );
    }

    if (existingWallets && existingWallets.length > 0) {
      return NextResponse.json(
        { 
          message: "Gateway signer wallets already exist for this user",
          alreadyExists: true 
        },
        { status: 200 }
      );
    }

    // Create Gateway EOA wallets
    const wallets = await storeGatewayEOAWalletsForUser(user.id);

    return NextResponse.json({
      success: true,
      message: `Created ${wallets.length} Gateway signer wallets`,
      wallets: wallets.map(w => ({
        id: w.id,
        name: w.name,
        address: w.address,
        blockchain: w.blockchain,
        type: w.type,
      })),
    });
  } catch (error: any) {
    console.error("Error creating Gateway signer wallets:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
