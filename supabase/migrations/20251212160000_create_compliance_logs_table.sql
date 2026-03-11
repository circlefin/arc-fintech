-- Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
--
-- Licensed under the Apache License, Version 2.0 (the "License");
-- you may not use this file except in compliance with the License.
-- You may obtain a copy of the License at
--
--     http://www.apache.org/licenses/LICENSE-2.0
--
-- Unless required by applicable law or agreed to in writing, software
-- distributed under the License is distributed on an "AS IS" BASIS,
-- WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
-- See the License for the specific language governing permissions and
-- limitations under the License.
--
-- SPDX-License-Identifier: Apache-2.0

-- Create compliance_logs table
CREATE TABLE IF NOT EXISTS public.compliance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  wallet_address TEXT NOT NULL,
  blockchain TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('PASS', 'REVIEW', 'FAIL')),
  rule_name TEXT,
  actions JSONB,
  risk_categories JSONB,
  risk_score TEXT,
  reasons JSONB,
  screening_date TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_compliance_logs_user_id ON public.compliance_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_compliance_logs_wallet_address ON public.compliance_logs(wallet_address);
CREATE INDEX IF NOT EXISTS idx_compliance_logs_result ON public.compliance_logs(result);
CREATE INDEX IF NOT EXISTS idx_compliance_logs_created_at ON public.compliance_logs(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.compliance_logs ENABLE ROW LEVEL SECURITY;

-- Create Policies
-- 1. Allow users to view their own compliance logs
CREATE POLICY "Users can view their own compliance logs"
  ON public.compliance_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- 2. Allow users to insert their own compliance logs
CREATE POLICY "Users can insert their own compliance logs"
  ON public.compliance_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Enable Realtime for the compliance_logs table
ALTER PUBLICATION supabase_realtime ADD TABLE public.compliance_logs;
