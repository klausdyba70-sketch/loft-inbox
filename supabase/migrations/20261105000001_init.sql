-- Loft Inbox: Grundschema
-- Ein Besitzer (Klaus). Zugriff nur angemeldet UND mit zweitem Faktor (aal2).
-- Mailabruf, KI und Kalender laufen serverseitig mit dem Service-Schlüssel und umgehen RLS bewusst.

create extension if not exists pg_trgm;

-- ---------- Besitzer ----------
create table public.app_owner (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- true nur für den eingetragenen Besitzer mit abgeschlossener Zwei-Faktor-Anmeldung
create or replace function public.is_owner()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.app_owner where user_id = auth.uid())
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;
revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated;

-- ---------- Aufzählungen ----------
create type public.thread_status as enum ('offen', 'beantwortet', 'gebucht', 'abgeschlossen', 'spam');
create type public.studio as enum ('P', 'F', 'X');            -- Penthouse, Factory, nicht festgelegt
create type public.priority as enum ('hoch', 'normal', 'niedrig');
create type public.marker as enum ('rot', 'orange', 'gruen', 'blau', 'lila');
create type public.msg_direction as enum ('in', 'out');
create type public.doc_type as enum ('rechnung', 'motiv', 'release', 'angebot', 'sonst');

-- ---------- Kontakte ----------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  company text,
  phone text,
  address text,
  is_regular boolean not null default false,              -- Stammkunde
  source text not null default 'mail' check (source in ('mail', 'freshdesk', 'manuell')),
  freshdesk_id bigint unique,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index contacts_email_key on public.contacts (lower(email));

-- ---------- Anfragen (Threads) ----------
create table public.threads (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.contacts(id) on delete set null,
  subject text not null default '',
  status public.thread_status not null default 'offen',
  studio public.studio not null default 'X',
  category text,
  priority public.priority not null default 'normal',
  marker public.marker,
  starred boolean not null default false,
  unread boolean not null default true,
  spam_score smallint check (spam_score between 0 and 100),
  summary text,                                            -- KI-Zusammenfassung
  requested_date date,                                     -- erkanntes Wunschdatum
  requested_studio public.studio,
  first_response_minutes integer,
  last_message_at timestamptz not null default now(),
  freshdesk_id bigint unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index threads_status_idx on public.threads (status, last_message_at desc);
create index threads_contact_idx on public.threads (contact_id);

-- ---------- Nachrichten ----------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  direction public.msg_direction not null,
  from_addr text not null,
  to_addr text not null,
  cc text,
  subject text,
  body_text text not null default '',
  body_html text,
  signature text,
  sent_at timestamptz not null,
  message_id text,                                         -- RFC Message-ID, gegen Doppelimport
  in_reply_to text,
  imap_uid bigint,
  freshdesk_id bigint unique,
  created_at timestamptz not null default now()
);
create unique index messages_message_id_key on public.messages (message_id) where message_id is not null;
create index messages_thread_idx on public.messages (thread_id, sent_at);
create index messages_body_trgm on public.messages using gin (body_text gin_trgm_ops);

-- ---------- Dokumente und Anhänge ----------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.contacts(id) on delete set null,
  thread_id uuid references public.threads(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  type public.doc_type not null default 'sonst',
  file_name text not null,
  storage_path text not null unique,                       -- Pfad im privaten Bucket "documents"
  mime_type text,
  size_bytes bigint,
  status text,                                             -- bezahlt, offen, unterschrieben, ausstehend …
  doc_date date,
  created_at timestamptz not null default now()
);
create index documents_contact_idx on public.documents (contact_id, doc_date desc);

-- ---------- KI-Entwürfe ----------
create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  label text not null,
  body text not null,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- Einstellungen (eine Zeile) ----------
create table public.settings (
  id boolean primary key default true check (id),
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  tone text not null default 'du' check (tone in ('du', 'sie')),
  signature text not null default E'Viele Grüße\nKlaus\nLoft Studio Cologne',
  auto_drafts boolean not null default true,
  rules jsonb not null default '{"soon":true,"booking":true,"regular":true,"spam":true,"stale":true,"follow":true}',
  updated_at timestamptz not null default now()
);
insert into public.settings default values;

-- ---------- Sync-Status (Mailabruf, Notion, Kalender, Import) ----------
create table public.sync_state (
  key text primary key,                                    -- z. B. 'imap:INBOX', 'notion', 'freshdesk'
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- ---------- Wissensbasis aus Notion ----------
create table public.knowledge (
  id text primary key,                                     -- Notion-Block- oder Seiten-ID
  title text,
  content text not null,
  synced_at timestamptz not null default now()
);

-- ---------- Protokoll (Anmeldungen, Massenaktionen) ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  action text not null,
  detail jsonb
);

-- ---------- updated_at automatisch ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
create trigger contacts_touch before update on public.contacts for each row execute function public.touch_updated_at();
create trigger threads_touch before update on public.threads for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();

-- ---------- Zugriffsregeln ----------
do $$
declare t text;
begin
  foreach t in array array['contacts','threads','messages','documents','drafts','settings','sync_state','knowledge'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy owner_all on public.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())', t);
  end loop;
end $$;

alter table public.app_owner enable row level security;
alter table public.app_owner force row level security;
create policy owner_read on public.app_owner for select to authenticated using (public.is_owner());

-- Protokoll: lesen und anhängen, nie ändern oder löschen
alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;
create policy audit_read on public.audit_log for select to authenticated using (public.is_owner());
create policy audit_insert on public.audit_log for insert to authenticated with check (public.is_owner());

-- Anonyme Nutzer bekommen gar nichts
revoke all on all tables in schema public from anon;

-- ---------- Privater Speicher für Dokumente ----------
insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
  on conflict (id) do nothing;
create policy documents_owner on storage.objects for all to authenticated
  using (bucket_id = 'documents' and public.is_owner())
  with check (bucket_id = 'documents' and public.is_owner());
