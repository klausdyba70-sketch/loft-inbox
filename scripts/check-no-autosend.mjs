// Feste Regel: Die App schickt NIE etwas automatisch an Kunden.
// Dieser Check läuft bei jedem Netlify-Build. Findet er Code zum Mailversand außerhalb von netlify/functions/send.mjs,
// oder fehlt dort die Bestätigung durch Klaus, bricht der Build ab und nichts wird veröffentlicht.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SEND = /\/reply\b|\/replyAll\b|\/forward\b|sendMail|\/send\b['"`]|createReply|nodemailer|smtp/i;
const ALLOWED = 'netlify/functions/send.mjs';
const bad = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.m?js$/.test(f)) check(p); } };
const check = (p) => { const rel = p.replace(/\\/g, '/'); const src = readFileSync(p, 'utf8'); if (rel !== ALLOWED && SEND.test(src)) bad.push(rel); };
walk('netlify');
const send = readFileSync(ALLOWED, 'utf8');
if (!/confirmedByKlaus !== true\) return json\(\{ error/.test(send)) bad.push(ALLOWED + ' (Bestätigung durch Klaus fehlt)');
if (/schedule\s*:/.test(send)) bad.push(ALLOWED + ' (darf nie zeitgesteuert laufen)');
if (bad.length) { console.error('STOPP: Automatischer Mailversand ist verboten. Gefunden in:\n- ' + bad.join('\n- ')); process.exit(1); }
console.log('OK: Mails gehen nur nach Bestätigung durch Klaus raus (nur über ' + ALLOWED + ').');
