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

// Compliance result types
export type ComplianceResult = 'PASS' | 'REVIEW' | 'FAIL';

export type ComplianceAction = 'APPROVE' | 'DENY' | 'FREEZE_WALLET' | 'REVIEW';

export type RiskCategory = 
  | 'SANCTIONS' 
  | 'TERRORIST_FINANCING' 
  | 'CSAM' 
  | 'ILLICIT_BEHAVIOR' 
  | 'GAMBLING';

export type RiskScore = 'BLOCKLIST' | 'SEVERE' | 'HIGH' | 'MEDIUM' | 'LOW';

export type RiskReasonType = 'OWNERSHIP' | 'INTERACTION' | 'EXPOSURE';

// Circle API Response Types
export interface CircleComplianceReason {
  source: string;
  sourceValue: string;
  riskScore: RiskScore;
  riskCategories: RiskCategory[];
  type: RiskReasonType;
}

export interface CircleComplianceDecision {
  ruleName: string;
  actions: ComplianceAction[];
  reasons: CircleComplianceReason[];
  screeningDate: string;
}

export interface CircleScreeningResponse {
  result: 'APPROVED' | 'DENIED' | string;
  decision?: CircleComplianceDecision;
  address: string;
  chain: string;
}

// Internal Application Types
export interface ComplianceLog {
  id: string;
  user_id: string;
  wallet_address: string;
  blockchain: string;
  result: ComplianceResult;
  rule_name: string | null;
  actions: ComplianceAction[] | null;
  risk_categories: RiskCategory[] | null;
  risk_score: string | null;
  reasons: CircleComplianceReason[] | null;
  screening_date: string;
  created_at: string;
  updated_at: string;
}

export interface ComplianceCheckRequest {
  address: string;
  chain: string;
}

export interface ComplianceCheckResponse {
  success: boolean;
  result: ComplianceResult;
  message?: string;
  details?: {
    ruleName?: string;
    actions?: ComplianceAction[];
    riskCategories?: RiskCategory[];
    riskScore?: string;
    reasons?: CircleComplianceReason[];
    screeningDate?: string;
  };
  error?: string;
}
