// Notion-Wissen jetzt neu laden
import { guard, json, requireOwner } from '../lib/core.mjs';
import { refreshKnowledge } from '../lib/ai.mjs';
export default guard(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405);
  const { db } = await requireOwner(req);
  return json(await refreshKnowledge(db, true));
});
export const config = { path: '/api/ai/knowledge' };
