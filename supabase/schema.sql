-- Vantage — Supabase schema
-- Run this in the Supabase SQL editor: https://supabase.com/dashboard/project/_/sql

-- User analyses table
create table if not exists analyses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  name            text not null,
  category        text not null,
  region          text not null default 'All Australia',
  fingerprint_result jsonb not null,
  saved_suburbs   jsonb not null default '[]',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Row Level Security: users can only access their own analyses
alter table analyses enable row level security;

create policy "Users can read their own analyses"
  on analyses for select
  using (auth.uid() = user_id);

create policy "Users can insert their own analyses"
  on analyses for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own analyses"
  on analyses for update
  using (auth.uid() = user_id);

create policy "Users can delete their own analyses"
  on analyses for delete
  using (auth.uid() = user_id);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger analyses_updated_at
  before update on analyses
  for each row execute function update_updated_at();
