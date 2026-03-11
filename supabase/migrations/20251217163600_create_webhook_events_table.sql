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

-- Create the transaction_webhook_events table for logging and deduplication
create table if not exists public.transaction_webhook_events (
  id uuid not null default gen_random_uuid(),
  circle_event_id text,
  circle_transaction_id text,
  mapped_status text,
  raw_payload jsonb not null,
  signature_valid boolean not null default false,
  dedupe_hash text not null,
  created_at timestamptz not null default now(),

  constraint transaction_webhook_events_pkey primary key (id),
  constraint transaction_webhook_events_dedupe_hash_unique unique (dedupe_hash)
);

-- Create indexes for faster querying
create index if not exists transaction_webhook_events_circle_event_id_idx 
  on public.transaction_webhook_events(circle_event_id);
create index if not exists transaction_webhook_events_circle_transaction_id_idx 
  on public.transaction_webhook_events(circle_transaction_id);
create index if not exists transaction_webhook_events_created_at_idx 
  on public.transaction_webhook_events(created_at);

-- Enable Row Level Security (RLS)
alter table public.transaction_webhook_events enable row level security;

-- Create policy to allow service role (backend) to manage webhook events
-- Regular users should not have access to webhook events
create policy "Service role can manage webhook events"
  on public.transaction_webhook_events
  for all
  using (auth.jwt()->>'role' = 'service_role');

-- Add new columns to transactions table to support webhook processing
alter table public.transactions
  add column if not exists status text not null default 'pending',
  add column if not exists tx_hash text,
  add column if not exists circle_transaction_id text,
  add column if not exists transaction_type text not null default 'USER',
  add column if not exists direction text not null default 'debit',
  add column if not exists credit_amount numeric default 0;

-- Create index on tx_hash for webhook lookups
create index if not exists transactions_tx_hash_idx on public.transactions(tx_hash);
create index if not exists transactions_circle_transaction_id_idx on public.transactions(circle_transaction_id);
create index if not exists transactions_status_idx on public.transactions(status);
create index if not exists transactions_transaction_type_idx on public.transactions(transaction_type);
