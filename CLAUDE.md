# Loft Inbox: feste Regeln

1. **Nie etwas automatisch an Kunden senden.** Mails verlassen die App nur, wenn Klaus im Fenster „Antwort wirklich senden?" auf „Ja, senden" tippt.
   - Einzige Versandstelle: `netlify/functions/send.mjs`. Sie verlangt `confirmedByKlaus: true` und lehnt interne/automatische Aufrufe ab.
   - Kein zeitgesteuerter Job, kein KI-Lauf, kein Import darf Mails senden, weiterleiten oder Antworten erstellen. KI schreibt nur Entwürfe.
   - `scripts/check-no-autosend.mjs` läuft bei jedem Netlify-Build und bricht ab, wenn irgendwo sonst Versand-Code auftaucht.
2. **Postfach nur lesen.** Nichts löschen, verschieben oder als gelesen markieren. Mac Mail und die Weiterleitung an Freshdesk laufen unverändert.
3. **Kalender nur lesen** (iCal-Adressen). Keine Termine anlegen oder ändern. Anny bleibt unberührt.
4. **Freshdesk nur lesen** beim Import.
5. **Netlify-Credits sparen:** auf `dev` entwickeln, nach `main` nur wenn Klaus „veröffentlichen" sagt.
6. **Keine Schlüssel im Chat oder Code.** Klaus trägt sie selbst in Netlify/Supabase ein.
