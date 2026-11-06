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

## Postfach bleibt unangetastet (feste Regel)

- Die App **liest** mail@ nur. Sie löscht, verschiebt oder markiert keine Mails, alles bleibt auf dem Microsoft-Server.
- Mail auf dem Mac und die Weiterleitung an Freshdesk laufen unverändert weiter.
- Antworten gehen über das Postfach raus und liegen danach im Ordner "Gesendet".
- Status, Farben, Spam und Erledigt gelten nur in der App.

## KI und Testmodus

- `ai-worker` (alle 5 Minuten, nur live) stuft neue Mails ein (Anfrage, Sonstiges, Spam), schreibt Zusammenfassung, erkennt Studio, Art, Wunschtermin, Priorität und bereitet Vorschläge vor.
- Beim Öffnen einer Anfrage stuft die App bei Bedarf sofort ein und holt 3 Vorschläge (je ein Aufruf, damit es unter 10 s bleibt).
- Wissen kommt aus der Notion-FAQ (alle 6 Stunden neu). Ohne Notion setzt die KI Platzhalter für Preise.
- Testmodus: `/api/test/new` erzeugt eine KI-Testanfrage (is_test), Senden in Testanfragen geht nie über Microsoft, `/api/test/reply` lässt die Testkundin antworten, `/api/test/clear` löscht alles.

## Arbeitsweise (Netlify-Credits sparen)

- Entwickelt wird auf dem Zweig `dev`. Netlify baut ihn als Branch-Deploy unter https://dev--loftstudiocologne-inbox.netlify.app, das kostet keine Credits.
- `main` ist die Live-Version. Nach `main` wird nur zusammengeführt, wenn Klaus "veröffentlichen" sagt. Jeder Live-Deploy kostet 15 Credits.
- Der automatische Mailabruf läuft nur in der Live-Version.

## Sicherheit

- Zugriff auf alle Tabellen nur für den eingetragenen Besitzer **mit abgeschlossenem zweiten Faktor** (`aal2`). Geprüft in `public.is_owner()`.
- Anonyme Nutzer haben keine Rechte. Registrierung wird in Supabase abgeschaltet.
- Dokumente liegen im privaten Bucket `documents`.
- Schlüssel stehen nie im Code, nur in den Umgebungsvariablen unten.

## Umgebungsvariablen (trägt Klaus selbst ein)

**Netlify** (Project configuration → Environment variables). Nur diese vier, alles andere steht schon im Code:

| Name | Inhalt | Geheim |
| --- | --- | --- |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys: "Publishable key" (bei älteren Projekten "anon public") | nein |
| `SUPABASE_SECRET_KEY` | Supabase → API Keys: "Secret key" (bei älteren Projekten "service_role") | **ja** |
| `MS_CLIENT_SECRET` | Wert des geheimen Clientschlüssels der Microsoft-App "Loft Inbox" | **ja** |
| `TOKEN_ENC_KEY` | Zufälliger Text mit mindestens 40 Zeichen aus dem Passwortmanager. Verschlüsselt den Microsoft-Zugang in der Datenbank | **ja** |

KI: `ANTHROPIC_API_KEY` (geheim) und `NOTION_TOKEN` (geheim). Optional `AI_MODEL_FAST` / `AI_MODEL_WRITE` (Standard `claude-haiku-5-5`) und `NOTION_PAGE_ID`.

Später: Google-Zugang, Freshdesk-Schlüssel.

## Bekannte, nicht geheime Werte

| Was | Wert |
| --- | --- |
| Supabase-Projekt | https://welzlrpiseuewrdjhids.supabase.co |
| Postfach | Nur mail@loftstudiocologne.com (Microsoft 365, über Microsoft Graph). bookings@ und support@ werden nicht gelesen |
| Microsoft App "Loft Inbox", Anwendungs-ID (Client) | ddac8569-3b28-41e4-a4f1-f00f4914494a |
| Microsoft Verzeichnis-ID (Mandant) | d10e43c7-ae2a-466b-aece-eb536ad78dfe |
| Netlify-Adresse | https://loftstudiocologne-inbox.netlify.app |
| Microsoft Umleitungs-URI | https://loftstudiocologne-inbox.netlify.app/api/ms/callback |
| Google-Kalender | loftstudiocologne@gmail.com: "PENTHOUSE LOFT ANNY", "FACTORY LOFT ANNY" (Anny synchronisiert) |

Der Mailabruf läuft als geplante Netlify-Funktion alle 5 Minuten (`netlify/functions/mail-sync.mjs`).

## Ersteinrichtung Supabase

1. Projekt "loft-inbox" in Region Frankfurt anlegen.
2. Authentication: neue Registrierungen abschalten, MFA (TOTP) aktivieren.
3. SQL Editor: alle Dateien aus `supabase/migrations/` der Reihe nach ausführen.
4. Klaus' Konto anlegen und seine Nutzer-ID in `public.app_owner` eintragen.
