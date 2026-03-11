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

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  screenAddress,
  formatComplianceResponse,
  mapComplianceResult,
} from '@/lib/compliance/utils';
import { ComplianceCheckRequest } from '@/types/compliance';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body: ComplianceCheckRequest = await req.json();
    const { address, chain } = body;

    // Validate input
    if (!address || !chain) {
      return NextResponse.json(
        { error: 'Address and chain are required' },
        { status: 400 }
      );
    }

    // Call Circle's screening API
    const circleResponse = await screenAddress(address, chain);

    // Map to our format
    const complianceResponse = formatComplianceResponse(circleResponse);
    const result = mapComplianceResult(circleResponse);

    // Store in database
    const { error: dbError } = await supabase.from('compliance_logs').insert({
      user_id: user.id,
      wallet_address: address,
      blockchain: chain,
      result: result,
      rule_name: circleResponse.decision?.ruleName || null,
      actions: circleResponse.decision?.actions || null,
      risk_categories:
        circleResponse.decision?.reasons?.[0]?.riskCategories || null,
      risk_score: circleResponse.decision?.reasons?.[0]?.riskScore || null,
      reasons: circleResponse.decision?.reasons || null,
      screening_date: circleResponse.decision?.screeningDate || new Date().toISOString(),
    });

    if (dbError) {
      console.error('Error storing compliance log:', dbError);
      // Don't fail the request if logging fails
    }

    return NextResponse.json(complianceResponse);
  } catch (error) {
    console.error('Compliance screening error:', error);

    // Return a graceful error response
    return NextResponse.json(
      {
        success: false,
        result: 'PASS',
        message: 'Compliance screening temporarily unavailable. Proceeding with caution.',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
