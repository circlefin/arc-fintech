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

-- Migration: re_add_tx_hash_column

-- 1. Add tx_hash column back to transactions table
ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS tx_hash text;

-- 2. Re-create index on tx_hash for webhook lookups
CREATE INDEX IF NOT EXISTS transactions_tx_hash_idx ON public.transactions(tx_hash);

-- 3. Add comment for documentation
COMMENT ON COLUMN public.transactions.tx_hash IS 'Blockchain transaction hash for webhook matching';