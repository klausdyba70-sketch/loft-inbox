// KI-Einstufung einer Anfrage auf Abruf (z. B. beim Öffnen)
import { guard, json, requireOwner } from '../lib/core.mjs';
import { classifyThread } from '../lib/ai.mjs';
export default guard(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405);
  const { db } = await requireOwner(req);
  const { threadId } = await req.json();
  return json({ ok: true, result: await classifyThread(db, threadId) });
});
export const config = { path: '/api/ai/classify' };
