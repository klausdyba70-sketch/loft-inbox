// "Jetzt abrufen" aus der App
import { guard, json, requireOwner } from '../lib/core.mjs';
import { runSync } from '../lib/sync.mjs';
export default guard(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405);
  const { db } = await requireOwner(req);
  return json({ ok: true, result: await runSync(db) });
});
export const config = { path: '/api/sync' };
