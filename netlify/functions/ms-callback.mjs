// Rückkehr von Microsoft: Code gegen Tokens tauschen, Refresh-Token verschlüsselt ablegen
import { admin, encrypt, exchangeCode, graph, APP_URL, MAILBOX } from '../lib/core.mjs';
const back = (q) => Response.redirect(`${APP_URL()}/#einstellungen?${q}`, 302);
export default async (req) => {
  const u = new URL(req.url);
  if (u.searchParams.get('error')) return back('ms=fehler&grund=' + encodeURIComponent(u.searchParams.get('error_description') || u.searchParams.get('error')));
  const code = u.searchParams.get('code'), state = u.searchParams.get('state');
  if (!code || !state) return back('ms=fehler&grund=unvollstaendig');
  const db = admin();
  const { data: st } = await db.from('oauth_states').delete().eq('state', state).gt('created_at', new Date(Date.now() - 15 * 60e3).toISOString()).select('state');
  if (!st?.length) return back('ms=fehler&grund=abgelaufen');
  try {
    const t = await exchangeCode(code);
    const me = await graph(t.access_token, '/me?$select=mail,userPrincipalName');
    const account = (me.mail || me.userPrincipalName || '').toLowerCase();
    if (account !== MAILBOX) return back('ms=fehler&grund=' + encodeURIComponent(`Bitte mit ${MAILBOX} anmelden, nicht mit ${account}`));
    await db.from('ms_auth').upsert({ id: true, account, refresh_token_enc: await encrypt(t.refresh_token), updated_at: new Date().toISOString() });
    await db.from('audit_log').insert({ action: 'microsoft_verbunden', detail: { account } });
    return back('ms=ok');
  } catch (e) {
    console.error(e);
    return back('ms=fehler&grund=' + encodeURIComponent(e.message));
  }
};
export const config = { path: '/api/ms/callback' };
