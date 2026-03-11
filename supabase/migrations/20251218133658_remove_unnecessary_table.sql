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

-- 1. Drop the webhook events table
drop table if exists public.transaction_webhook_events;

-- 2. Create the Enum type for status
-- We use a DO block to ensure we don't error if the type already exists
do $$ begin
    if not exists (select 1 from pg_type where typname = 'transaction_status') then
        create type public.transaction_status as enum ('PENDING', 'CONFIRMED', 'COMPLETE');
    end if;
end $$;

-- 3. Modify the transactions table
alter table public.transactions
  -- Drop the unwanted columns
  drop column if exists tx_hash,
  drop column if exists circle_transaction_id,
  drop column if exists transaction_type,
  drop column if exists direction,
  drop column if exists credit_amount,

  -- Prepare status column for conversion (drop old default first)
  alter column status drop default;

-- 4. Convert the status column to the new Enum type
alter table public.transactions
  alter column status type public.transaction_status
  using (
    case
      -- Handle case-insensitive mapping (e.g. 'pending' -> 'PENDING')
      when upper(status) = 'PENDING' then 'PENDING'::public.transaction_status
      when upper(status) = 'CONFIRMED' then 'CONFIRMED'::public.transaction_status
      when upper(status) = 'COMPLETE' then 'COMPLETE'::public.transaction_status
      -- Default fallback for any other values
      else 'PENDING'::public.transaction_status
    end
  );

-- 5. Set the new default for status
alter table public.transactions
  alter column status set default 'PENDING'::public.transaction_status;