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

-- ── User stores table ─────────────────────────────────────────────────────────
-- Stores the user's own physical locations (both best and worst performing).
-- Run this block in the Supabase SQL editor after the initial schema above.

create table if not exists user_stores (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  category    text not null,
  locality    text not null,
  state       text not null default 'AU',
  performance text not null check (performance in ('best', 'worst')),
  created_at  timestamptz default now()
);

alter table user_stores enable row level security;

create policy "Users can read their own stores"
  on user_stores for select
  using (auth.uid() = user_id);

create policy "Users can insert their own stores"
  on user_stores for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own stores"
  on user_stores for delete
  using (auth.uid() = user_id);

-- ── Complete account deletion function ───────────────────────────────────────
-- Called via supabase.rpc("delete_user") — deletes the caller from auth.users.
-- security definer runs with owner privileges so it can delete from auth schema.

create or replace function delete_user()
returns void
language plpgsql security definer
as $$
declare
  uid uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  delete from auth.users where id = uid;
end;
$$;
