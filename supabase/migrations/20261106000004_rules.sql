-- Hausregeln für die KI-Antworten. Nur hinzufügen.
alter table public.settings add column if not exists ai_rules text;
insert into public.settings (id) values (true) on conflict (id) do nothing;
update public.settings set ai_rules = '- Bei Anfragen mit Uhrzeit oder Dauer immer den Preis für 1 Stunde Overtime nennen (Preis aus dem Wissen, sonst [Preis Overtime 1 Std.]).
- Auf- und Abbau liegen immer in der gebuchten Zeit.
- Wer mehr Zeit braucht: entweder 1 Stunde Overtime dazubuchen oder 1 Stunde früher anfangen und dafür 1 Stunde früher gehen.'
where ai_rules is null;
