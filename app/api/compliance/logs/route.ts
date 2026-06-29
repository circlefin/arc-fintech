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

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateQuery } from '@/lib/api/validate';
import { withAuth } from '@/lib/api/with-auth';

// Coerce numeric query params with explicit bounds so missing/garbage values
// can't reach `.range()` as NaN (which previously returned 416 from PostgREST).
const querySchema = z.object({
  result: z.enum(['PASS', 'REVIEW', 'FAIL', 'ERROR']).optional(),
  blockchain: z.string().min(1).max(64).optional(),
  startDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  endDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const GET = withAuth(async (req, { user, supabase }) => {
  try {
    const parsed = validateQuery(req.nextUrl, querySchema);
    if (!parsed.ok) return parsed.response;
    const { result, blockchain, startDate, endDate, limit, offset } = parsed.data;

    // Build query
    let query = supabase
      .from('compliance_logs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (result) {
      query = query.eq('result', result);
    }

    // Apply blockchain filter if provided
    if (blockchain) {
      query = query.eq('blockchain', blockchain);
    }

    // Apply date range filters if provided
    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      // Add one day to include the entire end date
      const endDateTime = new Date(endDate);
      endDateTime.setDate(endDateTime.getDate() + 1);
      query = query.lt('created_at', endDateTime.toISOString());
    }

    const { data: logs, error } = await query;

    if (error) {
      console.error('Error fetching compliance logs:', error);
      return NextResponse.json(
        { error: 'Failed to fetch compliance logs' },
        { status: 500 }
      );
    }

    return NextResponse.json({ logs });
  } catch (error) {
    console.error('Compliance logs error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
