# Loft Inbox

Anfragen-App für Loft Studio Cologne (Ersatz für Freshdesk). Ein Nutzer, Postfach mail@loftstudiocologne.com.

## Aufbau

| Teil | Wo | Was |
| --- | --- | --- |
| `app/` | Netlify | Oberfläche, Login mit Passkey und Authenticator |
| `docs/prototyp.html` | nur Referenz | Klickbarer Prototyp mit Beispieldaten, wird nicht veröffentlicht |
| `netlify/functions/` | Netlify | Microsoft-Anmeldung, Senden über Microsoft Graph, KI-Aufrufe, Freshdesk-Import |
| `supabase/migrations/` | Supabase | Datenbank-Schema und Zugriffsregeln |
| `supabase/functions/` | Supabase | Zeitgesteuerter Mailabruf (Microsoft Graph), Notion- und Kalender-Abgleich |

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
| `MS_TENANT_ID` / `MS_CLIENT_ID` | Microsoft-Verzeichnis- und Anwendungs-ID | nein |
| `MS_CLIENT_SECRET` | Geheimer Clientschlüssel der App "Loft Inbox" | **ja** |
| `FRESHDESK_DOMAIN` / `FRESHDESK_API_KEY` | nur für den Import, danach löschen | **ja** |

**Supabase** (Edge Functions, Secrets):

| Name | Inhalt | Geheim |
| --- | --- | --- |
| `MS_TENANT_ID` / `MS_CLIENT_ID` | Microsoft-Verzeichnis- und Anwendungs-ID (siehe unten) | nein |
| `MS_CLIENT_SECRET` | Geheimer Clientschlüssel der App "Loft Inbox" | **ja** |
| `ANTHROPIC_API_KEY` | wie oben | **ja** |
| `NOTION_TOKEN` | Schlüssel der Notion-Integration | **ja** |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | aus dem Google-Cloud-Projekt (Phase 3) | **ja** |

## Bekannte, nicht geheime Werte

| Was | Wert |
| --- | --- |
| Supabase-Projekt | https://welzlrpiseuewrdjhids.supabase.co |
| Postfach | Nur mail@loftstudiocologne.com (Microsoft 365, über Microsoft Graph). bookings@ und support@ werden nicht gelesen |
| Microsoft App "Loft Inbox", Anwendungs-ID (Client) | ddac8569-3b28-41e4-a4f1-f00f4914494a |
| Microsoft Verzeichnis-ID (Mandant) | d10e43c7-ae2a-466b-aece-eb536ad78dfe |
| Google-Kalender | loftstudiocologne@gmail.com: "PENTHOUSE LOFT ANNY", "FACTORY LOFT ANNY" (Anny synchronisiert) |

Der geheime Microsoft-Clientschlüssel kommt als `MS_CLIENT_SECRET` in die Umgebungsvariablen von Netlify und Supabase.

## Ersteinrichtung Supabase

1. Projekt "loft-inbox" in Region Frankfurt anlegen.
2. Authentication: neue Registrierungen abschalten, MFA (TOTP) aktivieren.
3. SQL Editor: `supabase/migrations/20261105000001_init.sql` ausführen.
4. Klaus' Konto anlegen und seine Nutzer-ID in `public.app_owner` eintragen.
