# CI/CD Pipeline für ExpressBlog

## Lokale Tests ausführen

```bash
# Alle Tests
npm test

# Tests mit Coverage
npm run test:coverage

# Tests im Watch-Modus
npm run test:watch

# Linting
npm run lint
```

## GitHub Actions Pipeline

Die Pipeline läuft automatisch bei:
- **Push** auf `main` oder `develop` Branch
- **Pull Requests** gegen `main` Branch

### Pipeline-Schritte:

1. **Test-Job** (parallel auf Node 18.x, 20.x, 22.x)
   - Dependencies installieren
   - Linting ausführen
   - Tests ausführen
   - Coverage-Report generieren
   - Coverage zu Codecov hochladen

2. **Build-Job** (nur bei erfolgreichen Tests)
   - Application builden
   - Security-Audit durchführen

3. **Deploy-Job** (nur bei Push auf main)
   - Deployment auf Production-Server

## Docker-Integration

Dein Projekt hat bereits Docker-Setup:

```bash
# Tests in Docker-Container ausführen
docker-compose run --rm app npm test

# Vollständige Umgebung starten
docker-compose up -d

# Tests in laufendem Container
docker-compose exec app npm test
```

## Lokale CI/CD Simulation

```bash
# Vollständige Pipeline lokal simulieren
npm run lint && npm run test:coverage && npm run build
```

## Vorteile dieser Einrichtung:

✅ **Automatische Qualitätssicherung**
✅ **Multi-Node-Version Testing**
✅ **Coverage-Tracking**
✅ **Sicherheitsprüfungen**
✅ **Docker-Unterstützung**
✅ **Kostenlos bei GitHub**
