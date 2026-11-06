// Einen Antwortvorschlag erzeugen (Variante: direkt | ausfuehrlich | rueckfrage)
import { guard, json, requireOwner } from '../lib/core.mjs';
import { draftVariant } from '../lib/ai.mjs';
export default guard(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405);
  const { db } = await requireOwner(req);
  const { threadId, variant } = await req.json();
  return json({ ok: true, draft: await draftVariant(db, threadId, variant) });
});
export const config = { path: '/api/ai/draft' };
