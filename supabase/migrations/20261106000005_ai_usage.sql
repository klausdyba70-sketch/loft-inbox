-- KI-Kosten mitschreiben. Nur hinzufügen.
create table if not exists public.ai_usage (
  id bigserial primary key,
  at timestamptz not null default now(),
  model text not null,
  kind text not null default 'sonstiges',   -- Antwort, Ändern, Einstufen, Frage, Testmodus
  input int not null default 0,
  output int not null default 0,
  cache_write int not null default 0,
  cache_read int not null default 0,
  cost_usd numeric(12,6) not null default 0
);
create index if not exists ai_usage_at on public.ai_usage (at desc);
alter table public.ai_usage enable row level security;
drop policy if exists owner_all on public.ai_usage;
create policy owner_all on public.ai_usage for all to authenticated using (public.is_owner()) with check (public.is_owner());
