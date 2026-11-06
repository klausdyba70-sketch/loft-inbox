-- KI-Felder und Testmodus. Nur hinzufügen, nichts löschen.
alter table public.threads add column if not exists kind text check (kind in ('anfrage', 'sonstiges', 'spam'));
alter table public.threads add column if not exists ai_at timestamptz;        -- wann die KI zuletzt eingestuft hat (null = offen)
alter table public.threads add column if not exists is_test boolean not null default false;
create index if not exists threads_ai_pending on public.threads (last_message_at desc) where ai_at is null;

alter table public.drafts add column if not exists based_on timestamptz;      -- Zeitpunkt der Kundenmail, auf die der Entwurf antwortet
create index if not exists drafts_thread_idx on public.drafts (thread_id, position);
