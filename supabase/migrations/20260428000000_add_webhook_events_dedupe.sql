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

-- Re-introduce a webhook event log so the Circle webhook handler can
-- deduplicate replays. The previous transaction_webhook_events table was
-- dropped in 20251218133658_remove_unnecessary_table.sql; this is the minimal
-- shape needed for replay protection.

create table if not exists public.webhook_events (
  -- Use Circle's notification id as the primary key. If Circle replays an
  -- event the second insert will fail with a unique-violation, which is how
  -- we detect duplicates.
  notification_id text not null,
  notification_type text not null,
  circle_transaction_id text,
  state text,
  payload jsonb not null,
  received_at timestamptz not null default now(),

  constraint webhook_events_pkey primary key (notification_id)
);

create index if not exists webhook_events_circle_transaction_id_idx
  on public.webhook_events(circle_transaction_id);
create index if not exists webhook_events_received_at_idx
  on public.webhook_events(received_at);

-- Enable RLS so application users can never read or write this table.
alter table public.webhook_events enable row level security;

-- Only the service role (used by our webhook handler) may insert/select.
create policy "Service role manages webhook events"
  on public.webhook_events
  for all
  using (auth.jwt()->>'role' = 'service_role')
  with check (auth.jwt()->>'role' = 'service_role');
