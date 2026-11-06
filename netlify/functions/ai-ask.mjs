// @-Fragen an die eigenen Anfragen
import { guard, json, requireOwner } from '../lib/core.mjs';
import { askInbox } from '../lib/ai.mjs';
export default guard(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405);
  const { db } = await requireOwner(req);
  const { question } = await req.json();
  if (!question?.trim()) return json({ error: 'Keine Frage' }, 400);
  return json({ ok: true, ...(await askInbox(db, question.slice(0, 300))) });
});
export const config = { path: '/api/ai/ask' };
