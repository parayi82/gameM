-- La Cabaña — esquema mínimo de Supabase.
-- `auth.users` lo gestiona Supabase Auth automáticamente (usamos signInAnonymously()
-- desde el cliente; el usuario puede luego vincular email si se desea retención cross-device).

create table if not exists public.progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  chapter_id integer not null,
  current_node_id text not null,
  visited_nodes jsonb not null default '[]'::jsonb,
  flags jsonb not null default '{}'::jsonb,
  inventory jsonb not null default '[]'::jsonb,
  endings_unlocked jsonb not null default '[]'::jsonb,
  last_decision_point jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, chapter_id)
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chapter_id integer not null,
  stripe_payment_id text not null unique,
  unlocked_at timestamptz not null default now(),
  unique (user_id, chapter_id)
);

alter table public.progress enable row level security;
alter table public.purchases enable row level security;

-- Cada usuario solo puede leer/escribir su propio progreso.
create policy "progress_select_own" on public.progress
  for select using (auth.uid() = user_id);
create policy "progress_upsert_own" on public.progress
  for insert with check (auth.uid() = user_id);
create policy "progress_update_own" on public.progress
  for update using (auth.uid() = user_id);

-- Las compras las lee el propio usuario; solo el backend (service role, en el
-- webhook de Stripe) puede insertarlas — el cliente nunca escribe purchases.
create policy "purchases_select_own" on public.purchases
  for select using (auth.uid() = user_id);

create index if not exists progress_user_idx on public.progress (user_id);
create index if not exists purchases_user_idx on public.purchases (user_id);
