-- Microsoft-Graph-Anbindung: Token-Ablage und Microsoft-IDs
-- Nur hinzufügen, nichts löschen.

-- Verschlüsselter Refresh-Token der Microsoft-Anmeldung (eine Zeile).
-- RLS an, KEINE Policy: nur der Server mit dem Secret Key kommt heran, die App im Browser nie.
create table if not exists public.ms_auth (
  id boolean primary key default true check (id),
  account text,                         -- angemeldetes Postfach, z. B. mail@loftstudiocologne.com
  refresh_token_enc text not null,      -- AES-GCM verschlüsselt mit TOKEN_ENC_KEY
  updated_at timestamptz not null default now()
);
alter table public.ms_auth enable row level security;
alter table public.ms_auth force row level security;
revoke all on public.ms_auth from anon, authenticated;

-- Einmal-Codes für den Anmeldeablauf (Schutz gegen untergeschobene Rückleitungen)
create table if not exists public.oauth_states (
  state text primary key,
  created_at timestamptz not null default now()
);
alter table public.oauth_states enable row level security;
alter table public.oauth_states force row level security;
revoke all on public.oauth_states from anon, authenticated;

-- Microsoft-IDs zum Zuordnen
alter table public.threads add column if not exists conversation_id text;
create unique index if not exists threads_conversation_key on public.threads (conversation_id) where conversation_id is not null;
alter table public.messages add column if not exists graph_id text;
create unique index if not exists messages_graph_key on public.messages (graph_id) where graph_id is not null;
