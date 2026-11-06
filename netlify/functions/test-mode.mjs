// Testmodus: KI-erzeugte Anfragen und Kundenantworten, ohne echte Mails
import { webcrypto as crypto } from 'node:crypto';
import { guard, json, requireOwner, MAILBOX } from '../lib/core.mjs';
import { classifyThread, generateTestInquiry, generateTestReply } from '../lib/ai.mjs';
export default guard(async (req, ctx) => {
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405);
  const { db } = await requireOwner(req);
  const action = ctx.params?.action || new URL(req.url).pathname.split('/').pop();
  const body = await req.json().catch(() => ({}));
  const now = new Date().toISOString();
  if (action === 'new') {
    const g = await generateTestInquiry();
    const { data: c, error: ce } = await db.from('contacts').insert({ email: g.email, name: g.name, source: 'manuell', notes: 'Testkontakt' }).select('id').single();
    if (ce) throw ce;
    const { data: t, error: te } = await db.from('threads').insert({ conversation_id: 'test-' + crypto.randomUUID(), contact_id: c.id, subject: g.subject, status: 'offen', unread: true, is_test: true, last_message_at: now }).select('id').single();
    if (te) throw te;
    await db.from('messages').insert({ thread_id: t.id, direction: 'in', from_addr: g.email, to_addr: MAILBOX, subject: g.subject, body_text: g.body, sent_at: now });
    let ai = null; try { ai = await classifyThread(db, t.id); } catch (e) { console.error(e); }
    return json({ ok: true, id: t.id, ai });
  }
  if (action === 'reply') {
    const { data: t } = await db.from('threads').select('id,is_test,subject,status,contacts(email)').eq('id', body.threadId).maybeSingle();
    if (!t?.is_test) return json({ error: 'Nur für Testanfragen' }, 400);
    const text = await generateTestReply(db, t.id);
    await db.from('messages').insert({ thread_id: t.id, direction: 'in', from_addr: t.contacts?.email || 'test@example.com', to_addr: MAILBOX, subject: 'Re: ' + t.subject, body_text: text, sent_at: new Date().toISOString() });
    await db.from('threads').update({ status: t.status === 'spam' ? 'spam' : 'offen', unread: true, last_message_at: new Date().toISOString(), ai_at: null }).eq('id', t.id);
    try { await classifyThread(db, t.id); } catch (e) { console.error(e); }
    return json({ ok: true });
  }
  if (action === 'clear') {
    const { data: ts } = await db.from('threads').delete().eq('is_test', true).select('id');
    await db.from('contacts').delete().eq('source', 'manuell').like('email', '%@example.com');
    return json({ ok: true, deleted: ts?.length || 0 });
  }
  return json({ error: 'Unbekannte Aktion' }, 404);
});
export const config = { path: '/api/test/:action' };
