// Hintergrund: neue Mails einstufen und für frische Anfragen Vorschläge vorbereiten (alle 5 Minuten, nur Live-Version)
import { admin } from '../lib/core.mjs';
import { classifyThread, draftVariant, refreshKnowledge, VARIANTS } from '../lib/ai.mjs';
const BUDGET = 26000;
export default async () => {
  if (!process.env.ANTHROPIC_API_KEY) { console.log('KI aus: ANTHROPIC_API_KEY fehlt'); return; }
  const start = Date.now(), left = () => BUDGET - (Date.now() - start);
  const db = admin();
  try { await refreshKnowledge(db); } catch (e) { console.error('Notion', e.message); }
  let classified = 0, drafted = 0;
  // Ab wann gilt eine Mail als "neu"? Beim ersten Lauf merken, ältere bekommen Vorschläge nur per Knopf
  const { data: since } = await db.from('sync_state').select('value').eq('key', 'ai:since').maybeSingle();
  const aiSince = since?.value?.at || new Date().toISOString();
  if (!since) await db.from('sync_state').upsert({ key: 'ai:since', value: { at: aiSince }, updated_at: aiSince });
  // 1) Einstufen, neueste zuerst, 4 parallel
  while (left() > 6000) {
    const { data: todo } = await db.from('threads').select('id').is('ai_at', null).order('last_message_at', { ascending: false }).limit(4);
    if (!todo?.length) break;
    const res = await Promise.allSettled(todo.map((t) => classifyThread(db, t.id)));
    res.forEach((r, i) => { if (r.status === 'fulfilled') classified++; else { console.error('Einstufung', todo[i].id, r.reason?.message); db.from('threads').update({ ai_at: new Date().toISOString() }).eq('id', todo[i].id).then(() => {}); } });
  }
  // 2) Vorschläge für die neuesten offenen Anfragen ohne Entwurf
  if (left() > 9000) {
    const { data: open } = await db.from('threads').select('id,last_message_at').eq('kind', 'anfrage').eq('status', 'offen').eq('is_test', false).gte('last_message_at', aiSince).order('last_message_at', { ascending: false }).limit(10);
    for (const t of open || []) {
      if (left() < 9000) break;
      const { data: d } = await db.from('drafts').select('based_on').eq('thread_id', t.id).limit(1);
      const { data: li } = await db.from('messages').select('sent_at,direction').eq('thread_id', t.id).order('sent_at', { ascending: false }).limit(1);
      if (!li?.length || li[0].direction !== 'in') continue;
      if (d?.length && d[0].based_on && new Date(d[0].based_on) >= new Date(new Date(li[0].sent_at) - 1000)) continue;
      const res = await Promise.allSettled(VARIANTS.map((v) => draftVariant(db, t.id, v.key)));
      drafted += res.filter((r) => r.status === 'fulfilled').length ? 1 : 0;
    }
  }
  await db.from('sync_state').upsert({ key: 'ai:last_run', value: { at: new Date().toISOString(), classified, drafted }, updated_at: new Date().toISOString() });
  console.log('KI-Lauf', classified, 'eingestuft,', drafted, 'mit Vorschlägen');
};
export const config = { schedule: '*/5 * * * *' };
