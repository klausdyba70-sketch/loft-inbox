// Startet die Microsoft-Anmeldung für mail@ (nur für den angemeldeten Besitzer)
import { webcrypto as crypto } from 'node:crypto';
import { guard, json, requireOwner, authorizeUrl } from '../lib/core.mjs';
export default guard(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405);
  const { db } = await requireOwner(req);
  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
  await db.from('oauth_states').delete().lt('created_at', new Date(Date.now() - 15 * 60e3).toISOString());
  await db.from('oauth_states').insert({ state });
  return json({ url: authorizeUrl(state) });
});
export const config = { path: '/api/ms/start' };
