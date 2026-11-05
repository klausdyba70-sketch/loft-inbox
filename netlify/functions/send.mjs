// Antwort aus der App über mail@ senden (Antwort auf die letzte eingegangene Mail des Verlaufs)
import { guard, json, requireOwner, msAccessToken, graph } from '../lib/core.mjs';
import { runSync } from '../lib/sync.mjs';
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export default guard(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405);
  const { db } = await requireOwner(req);
  const { threadId, body } = await req.json();
  if (!threadId || !body?.trim()) return json({ error: 'Antworttext fehlt' }, 400);
  const { data: last } = await db.from('messages').select('graph_id').eq('thread_id', threadId).eq('direction', 'in')
    .not('graph_id', 'is', null).order('sent_at', { ascending: false }).limit(1).maybeSingle();
  if (!last) return json({ error: 'Keine eingegangene Mail zum Antworten gefunden' }, 409);
  const token = await msAccessToken(db);
  const html = esc(body.trim()).replace(/\n/g, '<br>');
  await graph(token, `/me/messages/${encodeURIComponent(last.graph_id)}/reply`, { method: 'POST', body: JSON.stringify({ comment: html }) });
  await db.from('audit_log').insert({ action: 'antwort_gesendet', detail: { threadId } });
  // gesendete Mail gleich in den Verlauf holen
  let synced = null; try { synced = await runSync(db, { budgetMs: 4000 }); } catch (e) { console.error(e); }
  return json({ ok: true, synced });
});
export const config = { path: '/api/send' };
