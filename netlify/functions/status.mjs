// Status für die Einstellungen: Microsoft verbunden? letzter Abruf?
import { guard, json, requireOwner } from '../lib/core.mjs';
export default guard(async (req) => {
  const { db } = await requireOwner(req);
  const { data: ms } = await db.from('ms_auth').select('account,updated_at').maybeSingle();
  const { data: rows } = await db.from('sync_state').select('key,value').in('key', ['graph:last_run', 'graph:last_error', 'graph:inbox', 'graph:sentitems']);
  const s = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
  const { data: kn } = await db.from('knowledge').select('synced_at').order('synced_at', { ascending: false }).limit(1);
  const { count: pending } = await db.from('threads').select('id', { count: 'exact', head: true }).is('ai_at', null);
  const { data: air } = await db.from('sync_state').select('value').eq('key', 'ai:last_run').maybeSingle();
  const { data: ne } = await db.from('sync_state').select('value').eq('key', 'notion:last_error').maybeSingle();
  const ai = { notionError: ne?.value?.message || null, anthropic: !!process.env.ANTHROPIC_API_KEY, notion: !!process.env.NOTION_TOKEN, knowledgeAt: kn?.[0]?.synced_at || null, pending: pending ?? null, lastRun: air?.value || null };
  return json({ microsoft: ms ? { account: ms.account, since: ms.updated_at } : null, lastRun: s['graph:last_run'] || null, lastError: s['graph:last_error'] || null, backfill: !!(s['graph:inbox']?.next || s['graph:sentitems']?.next), ai });
});
export const config = { path: '/api/status' };
