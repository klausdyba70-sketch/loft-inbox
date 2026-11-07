// Freshdesk-Import im Hintergrund (bis 15 Minuten pro Lauf). Setzt sich selbst fort, bis alles da ist.
import { createHash } from 'node:crypto';
import { requireOwner, admin, APP_URL } from '../lib/core.mjs';
import { runImport } from '../lib/freshdesk.mjs';

const internalToken = () => createHash('sha256').update('freshdesk-continue:' + (process.env.SUPABASE_SECRET_KEY || '')).digest('hex');

export default async (req) => {
  let db;
  try {
    if (req.headers.get('x-loft-internal') === internalToken()) db = admin();
    else ({ db } = await requireOwner(req));
    const body = await req.json().catch(() => ({}));
    if (body.restart) await db.from('sync_state').delete().eq('key', 'freshdesk:import');
    else if (!req.headers.get('x-loft-internal')) {
      const { data } = await db.from('sync_state').select('value').eq('key', 'freshdesk:import').maybeSingle();
      if (data?.value?.status === 'läuft' && Date.now() - new Date(data.value.at).getTime() < 120000) return; // läuft schon
    }
    const st = await runImport(db, { budgetMs: 9 * 60000 });
    if (st.status === 'pausiert' && !st.error) {
      // nächsten Lauf anstoßen
      const base = process.env.URL || APP_URL();
      await fetch(`${process.env.DEPLOY_PRIME_URL || base}/api/freshdesk/import`, { method: 'POST', headers: { 'x-loft-internal': internalToken(), 'content-type': 'application/json' }, body: '{}' }).catch((e) => console.error('Fortsetzen:', e.message));
    }
  } catch (e) {
    console.error('Freshdesk-Import:', e.message);
  }
};
export const config = { path: '/api/freshdesk/import', background: true };
