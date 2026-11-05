# Loft Inbox

Anfragen-App für Loft Studio Cologne (Ersatz für Freshdesk). Ein Nutzer, Postfach mail@loftstudiocologne.com.

## Aufbau

| Teil | Wo | Was |
| --- | --- | --- |
| `app/` | Netlify | Oberfläche (aus dem Prototyp), Login mit Passkey und Authenticator |
| `netlify/functions/` | Netlify | Senden per SMTP, KI-Aufrufe, Freshdesk-Import |
| `supabase/migrations/` | Supabase | Datenbank-Schema und Zugriffsregeln |
| `supabase/functions/` | Supabase | Zeitgesteuerter Mailabruf (IMAP), Notion- und Kalender-Abgleich |

App und Daten sind getrennt: Ein Update der App ändert nie die Daten. Datenbank-Änderungen laufen nur über neue Dateien in `supabase/migrations/`, die ausschließlich hinzufügen.

## Sicherheit

- Zugriff auf alle Tabellen nur für den eingetragenen Besitzer **mit abgeschlossenem zweiten Faktor** (`aal2`). Geprüft in `public.is_owner()`.
- Anonyme Nutzer haben keine Rechte. Registrierung wird in Supabase abgeschaltet.
- Dokumente liegen im privaten Bucket `documents`.
- Schlüssel stehen nie im Code, nur in den Umgebungsvariablen unten.

## Umgebungsvariablen (trägt Klaus selbst ein)

**Netlify** (Website-Einstellungen, Environment variables):

| Name | Inhalt | Geheim |
| --- | --- | --- |
| `SUPABASE_URL` | Projekt-URL aus Supabase | nein |
| `SUPABASE_ANON_KEY` | "anon public" Schlüssel aus Supabase | nein |
| `SUPABASE_SERVICE_ROLE_KEY` | "service_role" Schlüssel aus Supabase | **ja** |
| `ANTHROPIC_API_KEY` | API-Schlüssel aus console.anthropic.com | **ja** |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` | Versandserver von domainFACTORY | nein |
| `SMTP_PASSWORD` | Passwort von mail@ | **ja** |
| `FRESHDESK_DOMAIN` / `FRESHDESK_API_KEY` | nur für den Import, danach löschen | **ja** |

**Supabase** (Edge Functions, Secrets):

| Name | Inhalt | Geheim |
| --- | --- | --- |
| `IMAP_HOST` / `IMAP_PORT` / `IMAP_USER` | Abrufserver von domainFACTORY | nein |
| `IMAP_PASSWORD` | Passwort von mail@ | **ja** |
| `ANTHROPIC_API_KEY` | wie oben | **ja** |
| `NOTION_TOKEN` | Schlüssel der Notion-Integration | **ja** |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | aus dem Google-Cloud-Projekt (Phase 3) | **ja** |

## Ersteinrichtung Supabase

1. Projekt "loft-inbox" in Region Frankfurt anlegen.
2. Authentication: neue Registrierungen abschalten, MFA (TOTP) aktivieren.
3. SQL Editor: `supabase/migrations/20261105000001_init.sql` ausführen.
4. Klaus' Konto anlegen und seine Nutzer-ID in `public.app_owner` eintragen.
