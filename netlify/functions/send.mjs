// Antwort aus der App über mail@ senden (Antwort auf die letzte eingegangene Mail des Verlaufs)
import { guard, json, requireOwner, msAccessToken, graph } from '../lib/core.mjs';
import { runSync } from '../lib/sync.mjs';
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export default guard(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405);
  const { db } = await requireOwner(req);
  const { threadId, body } = await req.json();
  if (!threadId || !body?.trim()) return json({ error: 'Antworttext fehlt' }, 400);
  const { data: th } = await db.from('threads').select('id,is_test,status,subject,first_response_minutes,contacts(email)').eq('id', threadId).maybeSingle();
  if (th?.is_test) {
    // Testmodus: nichts verlassen das Haus, die Antwort wird nur gespeichert
    const at = new Date().toISOString();
    await db.from('messages').insert({ thread_id: threadId, direction: 'out', from_addr: 'mail@loftstudiocologne.com', to_addr: th.contacts?.email || '', subject: 'Re: ' + th.subject, body_text: body.trim(), sent_at: at });
    const { data: firstIn } = await db.from('messages').select('sent_at').eq('thread_id', threadId).eq('direction', 'in').order('sent_at').limit(1).maybeSingle();
    const patch = { last_message_at: at, status: th.status === 'offen' ? 'beantwortet' : th.status };
    if (th.first_response_minutes == null && firstIn) patch.first_response_minutes = Math.max(0, Math.round((new Date(at) - new Date(firstIn.sent_at)) / 60000));
    await db.from('threads').update(patch).eq('id', threadId);
    return json({ ok: true, test: true });
  }
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
