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

-- Create the transactions table
create table if not exists public.transactions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric not null, -- Using numeric for precise financial calculations
  sender_address text not null,
  recipient_address text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint transactions_pkey primary key (id)
);

-- Create indexes for faster querying
create index if not exists transactions_user_id_idx on public.transactions(user_id);
create index if not exists transactions_sender_address_idx on public.transactions(sender_address);
create index if not exists transactions_recipient_address_idx on public.transactions(recipient_address);

-- Enable Row Level Security (RLS)
alter table public.transactions enable row level security;

-- Create Policies
-- 1. Allow users to view their own transactions
create policy "Users can view their own transactions"
  on public.transactions
  for select
  using (auth.uid() = user_id);

-- 2. Allow users to insert their own transactions
create policy "Users can insert their own transactions"
  on public.transactions
  for insert
  with check (auth.uid() = user_id);

-- 3. Allow users to update their own transactions (optional, depending on logic)
create policy "Users can update their own transactions"
  on public.transactions
  for update
  using (auth.uid() = user_id);

-- Function to automatically update 'updated_at' on change
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Trigger to execute the function before update
create trigger handle_transactions_updated_at
  before update on public.transactions
  for each row
  execute function public.handle_updated_at();

-- Enable Realtime for the transactions table (so the dashboard updates automatically)
alter publication supabase_realtime add table public.transactions;