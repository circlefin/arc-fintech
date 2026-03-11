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

import { v4 as uuidv4 } from 'uuid';
import {
  CircleScreeningResponse,
  ComplianceResult,
  ComplianceCheckResponse,
} from '@/types/compliance';

/**
 * Generate a unique idempotency key for Circle API calls
 */
export function generateIdempotencyKey(): string {
  return uuidv4();
}

/**
 * Screen a blockchain address using Circle's Compliance Engine
 */
export async function screenAddress(
  address: string,
  chain: string
): Promise<CircleScreeningResponse> {
  const apiKey = process.env.CIRCLE_API_KEY;

  if (!apiKey) {
    throw new Error('CIRCLE_API_KEY is not configured');
  }

  const idempotencyKey = generateIdempotencyKey();

  const response = await fetch(
    'https://api.circle.com/v1/w3s/compliance/screening/addresses',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idempotencyKey,
        address,
        chain,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Circle API error: ${response.status} - ${errorText}`);
  }

  const responseData = await response.json();
  console.log('Circle Screening Response:', responseData);

  // Circle API wraps the response in a 'data' property
  const data: CircleScreeningResponse = responseData.data || responseData;
  return data;
}

/**
 * Map Circle's screening response to our internal compliance result format
 */
export function mapComplianceResult(
  circleResponse: CircleScreeningResponse
): ComplianceResult {
  // If the result is DENIED, map to FAIL
  if (circleResponse.result === 'DENIED') {
    return 'FAIL';
  }

  // If the result is APPROVED, map to PASS
  if (circleResponse.result === 'APPROVED') {
    return 'PASS';
  }

  // If there's a decision with a REVIEW action, map to REVIEW
  if (
    circleResponse.decision?.actions &&
    circleResponse.decision.actions.includes('REVIEW')
  ) {
    return 'REVIEW';
  }

  // Default to PASS for any other case
  return 'PASS';
}

/**
 * Determine if a transfer should be blocked based on compliance result
 */
export function shouldBlockTransfer(result: ComplianceResult): boolean {
  return result === 'FAIL';
}

/**
 * Format compliance check response for UI consumption
 */
export function formatComplianceResponse(
  circleResponse: CircleScreeningResponse
): ComplianceCheckResponse {
  const result = mapComplianceResult(circleResponse);
  const blocked = shouldBlockTransfer(result);

  let message: string;
  if (result === 'FAIL') {
    message = 'This address has been flagged and transactions are blocked.';
  } else if (result === 'REVIEW') {
    message = 'This address requires manual review before proceeding.';
  } else {
    message = 'This address has passed compliance screening.';
  }

  return {
    success: true,
    result,
    message,
    details: circleResponse.decision
      ? {
        ruleName: circleResponse.decision.ruleName,
        actions: circleResponse.decision.actions,
        riskCategories: circleResponse.decision.reasons?.[0]?.riskCategories,
        riskScore: circleResponse.decision.reasons?.[0]?.riskScore,
        reasons: circleResponse.decision.reasons,
        screeningDate: circleResponse.decision.screeningDate,
      }
      : undefined,
  };
}

/**
 * Get a human-readable label for compliance result
 */
export function getComplianceResultLabel(result: ComplianceResult): string {
  switch (result) {
    case 'PASS':
      return 'Allowed';
    case 'REVIEW':
      return 'Requires Review';
    case 'FAIL':
      return 'Blocked';
    default:
      return 'Unknown';
  }
}

/**
 * Get risk category display name
 */
export function getRiskCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    SANCTIONS: 'Sanctions',
    TERRORIST_FINANCING: 'Terrorist Financing',
    CSAM: 'CSAM',
    ILLICIT_BEHAVIOR: 'Illicit Behavior',
    GAMBLING: 'Gambling',
  };
  return labels[category] || category;
}

/**
 * Validate if a string is a valid blockchain address
 */
export function isValidAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  // Trim whitespace
  const trimmedAddress = address.trim();

  // Check if it's a valid Ethereum-like address (0x + 40 hex characters)
  const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
  if (ethAddressRegex.test(trimmedAddress)) {
    return true;
  }

  // Check if it's a valid Solana address (32-44 base58 characters)
  const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (solanaAddressRegex.test(trimmedAddress)) {
    return true;
  }

  return false;
}

/**
 * Check if address is a test address (for testing purposes)
 */
export function isTestAddress(address: string): boolean {
  const testSuffixes = ['9999', '8888', '7777', '8999', '8899', '8889', '7779', '7666', '7766'];
  return testSuffixes.some(suffix => address.toLowerCase().endsWith(suffix));
}

/**
 * Get expected test result for test addresses
 */
export function getTestAddressExpectedResult(address: string): ComplianceResult | null {
  const lowerAddress = address.toLowerCase();

  if (lowerAddress.endsWith('9999') ||
    lowerAddress.endsWith('8888') ||
    lowerAddress.endsWith('7777') ||
    lowerAddress.endsWith('8999') ||
    lowerAddress.endsWith('8899') ||
    lowerAddress.endsWith('8889') ||
    lowerAddress.endsWith('7779') ||
    lowerAddress.endsWith('7666') ||
    lowerAddress.endsWith('7766')) {
    return 'FAIL';
  }

  return null;
}
