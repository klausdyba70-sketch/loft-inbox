// Original-HTML einer älteren Mail nachladen (vor der HTML-Speicherung abgerufene Mails)
import { guard, json, requireOwner, msAccessToken, graph } from '../lib/core.mjs';
export default guard(async (req) => {
  const { db } = await requireOwner(req);
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return json({ error: 'id fehlt' }, 400);
  const { data: m } = await db.from('messages').select('id,graph_id,body_html').eq('id', id).maybeSingle();
  if (!m) return json({ error: 'Nachricht nicht gefunden' }, 404);
  if (m.body_html) return json({ html: m.body_html });
  if (!m.graph_id) return json({ html: null });
  const token = await msAccessToken(db);
  const r = await graph(token, `/me/messages/${encodeURIComponent(m.graph_id)}?$select=body`, { headers: { Prefer: 'outlook.body-content-type="html"' } });
  const html = r?.body?.contentType === 'html' ? r.body.content : null;
  if (html && html.length < 400000) await db.from('messages').update({ body_html: html }).eq('id', m.id);
  return json({ html });
});
export const config = { path: '/api/message-html' };
