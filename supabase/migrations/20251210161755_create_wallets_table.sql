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

-- Create the wallets table
create table if not exists public.wallets (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  blockchain text,
  address text,
  circle_wallet_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint wallets_pkey primary key (id)
);

-- Create an index on user_id for faster lookups
create index if not exists wallets_user_id_idx on public.wallets(user_id);

-- Create a unique index on circle_wallet_id to prevent duplicates
create unique index if not exists wallets_circle_wallet_id_idx on public.wallets(circle_wallet_id);

-- Enable Row Level Security (RLS)
alter table public.wallets enable row level security;

-- Create Policies
-- 1. Allow users to view their own wallets
create policy "Users can view their own wallets"
  on public.wallets
  for select
  using (auth.uid() = user_id);

-- 2. Allow users to insert their own wallets
create policy "Users can insert their own wallets"
  on public.wallets
  for insert
  with check (auth.uid() = user_id);

-- 3. Allow users to update their own wallets
create policy "Users can update their own wallets"
  on public.wallets
  for update
  using (auth.uid() = user_id);

-- 4. Allow users to delete their own wallets
create policy "Users can delete their own wallets"
  on public.wallets
  for delete
  using (auth.uid() = user_id);

-- Enable Realtime for the wallets table
alter publication supabase_realtime add table public.wallets;