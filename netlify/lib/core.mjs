// Gemeinsame Helfer für alle Netlify-Funktionen
import { createClient } from '@supabase/supabase-js';
import { webcrypto as crypto } from 'node:crypto';

// Öffentliche, nicht geheime Werte als feste Vorgaben. Geheimnisse kommen nur aus den Netlify-Umgebungsvariablen.
const DEFAULTS = {
  SUPABASE_URL: 'https://welzlrpiseuewrdjhids.supabase.co',
  MS_TENANT_ID: 'd10e43c7-ae2a-466b-aece-eb536ad78dfe',
  MS_CLIENT_ID: 'ddac8569-3b28-41e4-a4f1-f00f4914494a',
};
const env = (k) => {
  const v = process.env[k] || DEFAULTS[k];
  if (!v) throw new Error(`Umgebungsvariable ${k} fehlt`);
  return v;
};

export const APP_URL = () => process.env.APP_URL || 'https://loftstudiocologne-inbox.netlify.app';
export const MAILBOX = 'mail@loftstudiocologne.com';
export const MS_SCOPES = 'offline_access User.Read Mail.ReadWrite Mail.Send';

export const admin = () =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_SECRET_KEY'), { auth: { persistSession: false } });

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// Prüft: gültige Supabase-Sitzung, zweiter Faktor (aal2), eingetragener Besitzer
export async function requireOwner(req) {
  const auth = req.headers.get('authorization') || '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) throw Object.assign(new Error('Nicht angemeldet'), { status: 401 });
  const db = admin();
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data?.user) throw Object.assign(new Error('Sitzung ungültig'), { status: 401 });
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  if (claims.aal !== 'aal2') throw Object.assign(new Error('Zweiter Faktor fehlt'), { status: 403 });
  const { data: own } = await db.from('app_owner').select('user_id').eq('user_id', data.user.id).maybeSingle();
  if (!own) throw Object.assign(new Error('Kein Zugriff'), { status: 403 });
  return { user: data.user, db };
}

export const guard = (fn) => async (req, ctx) => {
  try { return await fn(req, ctx); }
  catch (e) { console.error(e); return json({ error: e.message || 'Fehler' }, e.status || 500); }
};

// ---------- Verschlüsselung (AES-256-GCM) ----------
async function key() {
  const raw = new TextEncoder().encode(env('TOKEN_ENC_KEY'));
  const hash = await crypto.subtle.digest('SHA-256', raw);
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(text));
  return Buffer.from(iv).toString('base64') + '.' + Buffer.from(new Uint8Array(ct)).toString('base64');
}
export async function decrypt(blob) {
  const [iv, ct] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await key(), ct);
  return new TextDecoder().decode(pt);
}

// ---------- Microsoft ----------
const tokenUrl = () => `https://login.microsoftonline.com/${env('MS_TENANT_ID')}/oauth2/v2.0/token`;
export const redirectUri = () => `${APP_URL()}/api/ms/callback`;

export function authorizeUrl(state) {
  const p = new URLSearchParams({
    client_id: env('MS_CLIENT_ID'), response_type: 'code', redirect_uri: redirectUri(),
    response_mode: 'query', scope: MS_SCOPES, state, login_hint: MAILBOX, prompt: 'select_account',
  });
  return `https://login.microsoftonline.com/${env('MS_TENANT_ID')}/oauth2/v2.0/authorize?${p}`;
}

async function tokenRequest(params) {
  const body = new URLSearchParams({ client_id: env('MS_CLIENT_ID'), client_secret: env('MS_CLIENT_SECRET'), scope: MS_SCOPES, ...params });
  const r = await fetch(tokenUrl(), { method: 'POST', body });
  const j = await r.json();
  if (!r.ok) throw new Error(`Microsoft-Anmeldung fehlgeschlagen: ${j.error_description || j.error}`);
  return j;
}
export const exchangeCode = (code) => tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });

// Liefert ein gültiges Zugriffs-Token und speichert den erneuerten Refresh-Token
export async function msAccessToken(db) {
  const { data: row } = await db.from('ms_auth').select('refresh_token_enc').eq('id', true).maybeSingle();
  if (!row) throw Object.assign(new Error('Microsoft ist noch nicht verbunden'), { status: 409 });
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: await decrypt(row.refresh_token_enc) });
  if (t.refresh_token) {
    await db.from('ms_auth').update({ refresh_token_enc: await encrypt(t.refresh_token), updated_at: new Date().toISOString() }).eq('id', true);
  }
  return t.access_token;
}

export async function graph(token, path, init = {}) {
  const url = path.startsWith('http') ? path : `https://graph.microsoft.com/v1.0${path}`;
  const r = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', Prefer: 'outlook.body-content-type="text"', ...(init.headers || {}) },
  });
  if (r.status === 202 || r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Microsoft Graph ${r.status}: ${j.error?.message || 'Fehler'}`);
  return j;
}
