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

-- 1. Create the Enum types
create type public.transaction_type as enum (
  'INBOUND',
  'OUTBOUND'
);

create type public.blockchain_network as enum (
  'ETH-SEPOLIA',
  'BASE-SEPOLIA',
  'AVAX-FUJI',
  'ARC-TESTNET'
);

-- 2. Add the columns to the transactions table
-- We must provide DEFAULT values because the columns are NOT NULL and the table has existing data.
-- You can change 'ETH-SEPOLIA' to whichever network is most common in your existing data.
alter table public.transactions
add column type public.transaction_type not null default 'OUTBOUND',
add column blockchain public.blockchain_network not null default 'ETH-SEPOLIA';

-- 3. Create indexes for performance
create index if not exists transactions_type_idx on public.transactions using btree (type);
create index if not exists transactions_blockchain_idx on public.transactions using btree (blockchain);