// Status für die Einstellungen: Microsoft verbunden? letzter Abruf?
import { guard, json, requireOwner } from '../lib/core.mjs';
export default guard(async (req) => {
  const { db } = await requireOwner(req);
  const { data: ms } = await db.from('ms_auth').select('account,updated_at').maybeSingle();
  const { data: rows } = await db.from('sync_state').select('key,value').in('key', ['graph:last_run', 'graph:last_error', 'graph:inbox', 'graph:sentitems']);
  const s = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
  return json({ microsoft: ms ? { account: ms.account, since: ms.updated_at } : null, lastRun: s['graph:last_run'] || null, lastError: s['graph:last_error'] || null, backfill: !!(s['graph:inbox']?.next || s['graph:sentitems']?.next) });
});
export const config = { path: '/api/status' };
