# Vea-aggregatsioon (Sentry / GlitchTip)

Integratsioon on vaikimisi välja lülitatud ja töötab nii Sentry kui ka Sentry API-ga
ühilduva GlitchTipiga. Tootmises on privaatsuse tõttu eelistatud self-hosted GlitchTip;
Sentry SaaS-i kasutamine vajab eraldi andmekaitseotsust.

## Konfiguratsioon

Backend (`.env`, Docker Compose loeb automaatselt):

```env
ERROR_REPORTING_DSN=https://.../project-id
ERROR_REPORTING_ENVIRONMENT=production
ERROR_REPORTING_RELEASE=vutt-2026-07-11
```

Frontend (väärtused kompileeritakse `npm run build` ajal):

```env
VITE_SENTRY_DSN=https://.../project-id
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_RELEASE=vutt-2026-07-11
```

Frontend ja backend peaksid kasutama eri projekte/DSN-e. Tühja DSN-i korral SDK-d ei
käivitata. Pärast backend-muutust tuleb konteiner uuesti ehitada; pärast frontend-muutust
teha uus build ja kopeerida `dist/` serverisse.

## Privaatsus

Mõlemad integratsioonid kasutavad `sendDefaultPii=false` ning `beforeSend` filtrit.
Enne saatmist eemaldatakse:

- kasutaja identifikaator;
- päringukeha, küpsised ja päised (sh autentimistoken);
- URL-i query parameetrid;
- breadcrumb'ide `data` sisu.

Performance tracing on backendis välja lülitatud. DSN-i ei tohi lisada lähtekoodi.

## Kaetus

- Reacti globaalne error boundary ja React Routeri vead;
- brauseri käsitlemata erindid ja promise rejection'id;
- FastAPI/Starlette käsitlemata erindid;
- Python `threading.Thread` käsitlemata erindid, sh daemon-thread'id.

Health/heartbeat jälgimine on sellest eraldi: aggregatsioon teatab erindist, heartbeat
näitab, kas taustaloop jätkab töötamist.
