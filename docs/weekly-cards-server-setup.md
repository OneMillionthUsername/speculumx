# Wöchentliche Cards – Einrichtung auf dem Server

Anleitung für die Person (oder den Claude) auf dem Produktionsserver. Das Feature selbst liegt im Repository und kommt mit dem normalen Deployment. Auf dem Server sind nur Konfiguration, ein Zeitplan und eine Prüfung nötig.

## Was das Feature tut

Einmal pro Woche sammelt `scripts/weekly-cards.mjs` Meldungen der letzten 7 Tage aus Hacker News (Algolia-API, mind. 150 Punkte) und 20 RSS/Atom-Feeds (`config/cardDigest.js`). Ein LLM wählt höchstens 5 Meldungen aus, die zu den Blog-Themen passen (Programmierung, KI/LLMs, Wissenschaft, Philosophie, Gesellschaft). Daraus entstehen **unveröffentlichte** Cards. Veröffentlicht wird von Hand unter `/cards/manage` (Bearbeiten, „Veröffentlicht“ anhaken). Es wird nichts automatisch veröffentlicht.

Bild je Card, in dieser Reihenfolge:

1. Ein Bild der verlinkten Seite, **nur** wenn eine freie Lizenz maschinenlesbar belegt ist (Wikimedia Commons mit CC0/Public Domain, oder die Seite erklärt sich per `rel="license"`/JSON-LD zu CC0/Public Domain). Es wird lokal gespeichert, nie hotgelinkt.
2. Sonst eine KI-Illustration (Gemini-Bildmodell), im einheitlichen Stil des Themes, ohne Text, Logos und Personen.
3. Wenn auch das scheitert: das statische Standardbild `public/assets/img/card-default.webp`.

Gespeicherte Bilder liegen unter `public/assets/media/cards/` (`lic-…` = lizenziert, `ai-…` = KI-generiert), jeweils mit den Varianten `-344.webp` und `-688.webp`, die die Startseite erwartet.

## Was auf dem Server zu tun ist

Annahmen laut `deploy-production.yml` und `docker-compose.yml`: Projektverzeichnis `/var/www/speculumx/blog`, Container `speculumx_app`, Konfiguration in `.env.production`, rootless Docker unter dem Deploy-User.

### 1. Deployment abwarten

Das Feature ist mit dem Merge nach `main` und dem Deploy aktiv. Prüfen, dass das Skript im Container liegt:

```bash
docker exec speculumx_app ls scripts/weekly-cards.mjs public/assets/img/card-default.webp
```

### 2. Konfiguration in `.env.production`

Es sind keine neuen Variablen zwingend. Vorhanden sein muss ein KI-Schlüssel, den die App schon nutzt: `GEMINI_API_KEY` (oder `ANTHROPIC_API_KEY`, dann wird Claude vorgezogen).

Optional (Standardwerte in Klammern):

| Variable | Wirkung |
| --- | --- |
| `CARD_DIGEST_MAX_CARDS` (5) | Entwürfe pro Lauf, 1–10 |
| `CARD_DIGEST_DAYS` (7) | Alter der Meldungen in Tagen |
| `CARD_DIGEST_HN_MIN_POINTS` (150) | Mindestpunkte für Hacker-News-Meldungen |
| `CARD_DIGEST_LANGUAGE` (Deutsch) | Sprache von Titel und Untertitel |
| `CARD_DIGEST_LICENSED_IMAGES` (true) | `false`: nie nach lizenzierten Bildern suchen |
| `CARD_DIGEST_AI_IMAGES` (true) | `false`: nie KI-Bilder erzeugen, immer das Standardbild |
| `CARD_DIGEST_IMAGE_MODELS` (`gemini-2.5-flash-image`) | Gemini-Bildmodelle, kommagetrennt, das erste funktionierende zählt |

Die Datei wird beim Containerstart gelesen. Nach einer Änderung: `docker compose --env-file .env.production up -d` im Projektverzeichnis.

### 3. Ausgehendes Netz prüfen

Der Container braucht HTTPS nach außen zu `hn.algolia.com`, den Feed-Hosts (Liste in `config/cardDigest.js`), `commons.wikimedia.org`, `upload.wikimedia.org` und `generativelanguage.googleapis.com`. Standard-Docker erlaubt das. Bei einer Egress-Firewall diese Hosts freigeben.

### 4. Funktion prüfen (in dieser Reihenfolge)

Im Container nicht `npm run` verwenden: das Root-Dateisystem ist read-only, npm will einen Cache schreiben. Immer `node` direkt:

```bash
# Quellen: welche Feeds antworten? (kein LLM, keine Datenbank)
docker exec speculumx_app node scripts/weekly-cards.mjs --check-sources

# Bildmodell: kann der API-Schlüssel Bilder erzeugen?
docker exec speculumx_app node scripts/weekly-cards.mjs --test-image

# Trockenlauf: wählt aus und zeigt die Cards, schreibt nichts
docker exec speculumx_app node scripts/weekly-cards.mjs --dry-run

# Echter Lauf: legt Entwürfe an
docker exec speculumx_app node scripts/weekly-cards.mjs
```

Erwartung und Maßnahmen:

- `--check-sources`: Feeds, die `FAIL` melden, sind eingestellt oder haben eine neue URL. Die URL in `config/cardDigest.js` korrigieren oder den Eintrag entfernen (per Pull Request, nicht auf dem Server). Ein einzelner ausgefallener Feed bricht den Lauf nicht ab, nur wenn **alle** Quellen ausfallen. Die Feed-URLs wurden bei der Entwicklung nicht live geprüft, ein paar Korrekturen sind beim ersten Lauf zu erwarten.
- `--test-image`: Meldet `FAIL`, wenn das Modell unbekannt ist oder der Schlüssel keine Bilder erzeugen darf (Bildgenerierung ist nicht in jedem kostenlosen Kontingent enthalten). Dann entweder `CARD_DIGEST_IMAGE_MODELS` auf ein verfügbares Bildmodell setzen oder `CARD_DIGEST_AI_IMAGES=false`. Die Cards bekommen in beiden Fällen ein Bild, nämlich das Standardbild.
- Echter Lauf: Danach unter `/cards/manage` prüfen, ob die Entwürfe mit Bild und Quelle erscheinen. Eine Bilddatei abrufen und prüfen, dass sie über den Webserver ausgeliefert wird:

  ```bash
  curl -I https://<domain>/assets/media/cards/<datei>-344.webp   # erwartet: 200 und image/webp
  ```

  Bei 403/404: Rechte auf `public/assets/media/cards` prüfen. Der Container-User (uid 1000 im Container) muss schreiben können, der Webserver lesen. Das gilt wie für die Uploads in `public/assets/media`.
- Während des ersten echten Laufs `docker stats speculumx_app` beobachten. Das Skript läuft im Speicherlimit des App-Containers (512 MB). Erwartet ist eine kurze Spitze, kein Problem für die laufende App.

### 5. Zeitplan einrichten

Empfohlen ist ein systemd-User-Timer unter dem Deploy-User, weil er die Umgebung für rootless Docker mitbringt. Einmalig `loginctl enable-linger <deploy-user>` ausführen, damit der Timer ohne Login läuft.

`~/.config/systemd/user/speculumx-weekly-cards.service`

```ini
[Unit]
Description=speculumx: weekly card drafts

[Service]
Type=oneshot
ExecStart=/usr/bin/docker exec speculumx_app node scripts/weekly-cards.mjs
```

`~/.config/systemd/user/speculumx-weekly-cards.timer`

```ini
[Unit]
Description=speculumx: weekly card drafts, Mondays

[Timer]
OnCalendar=Mon *-*-* 06:30:00 Europe/Vienna
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now speculumx-weekly-cards.timer
systemctl --user list-timers speculumx-weekly-cards.timer     # nächster Lauf
systemctl --user start speculumx-weekly-cards.service          # sofort testen
journalctl --user -u speculumx-weekly-cards.service -n 80      # Ausgabe des Laufs
```

Alternative Cron-Zeile (rootless Docker braucht `DOCKER_HOST`):

```cron
30 6 * * 1 DOCKER_HOST=unix:///run/user/<uid>/docker.sock docker exec speculumx_app node scripts/weekly-cards.mjs >> $HOME/weekly-cards.log 2>&1
```

Der Lauf beendet sich mit Exit-Code 1, wenn alle Quellen, das LLM oder die Datenbank ausfallen. `systemctl --user status speculumx-weekly-cards.service` zeigt dann `failed`.

## Betrieb

- Abgelehnte Entwürfe **nicht löschen**, sondern unveröffentlicht lassen. Der Job überspringt jede URL, die schon als Card existiert (auch unveröffentlicht), und schlägt sie dann nicht erneut vor.
- Ein zweiter Lauf in derselben Woche legt weitere Entwürfe aus dem Rest der Meldungen an. Vorher `--dry-run` nutzen.
- Das Standardbild lässt sich ersetzen, indem die drei Dateien `card-default.webp`, `-344.webp` und `-688.webp` in `public/assets/img/` ausgetauscht werden (Größen 1032×930, 344×310, 688×620). `npm run cards:default-image` rendert das mitgelieferte Bild neu.
- KI-Bilder tragen das unsichtbare SynthID-Wasserzeichen von Google. Eine sichtbare Kennzeichnung gibt es nicht. Die Dateinamen mit `ai-` zeigen, welche Bilder generiert sind.
