# 0087 — Kasutusstatistika nginxi logist, ilma IP-deta

**Staatus:** vastu võetud, teostatud (2026-11-21, #855).

## Kontekst

Umami eemaldati 2026-11-19. Liikluspaneel (#786) on häiresüsteem: ta näeb ainult backendi
jõudnud päringuid, hoiab andmeid mälus 24 h ja tema arvu määrasid avatud vahekaartide
minutiküsitlused (20.11: 57 % päringutest, #854). nginxi logis on kogu liiklus olemas, aga
logrotate hoiab seda 14 päeva.

## Otsus

1. **Allikas on nginxi access log**, mitte uus jälgimine. Klienti ei lisata ühtki beaconit
   ega skripti.
2. **Päevakokkuvõtte teeb HOSTI cron** (`scripts/usage_stats.py`, `15 0 * * *`): ainult
   standardteek, ei impordi `server`-it, loeb `vutt_access.log` + `.1` ja filtreerib
   kuupäeva järgi (ajastus logrotate suhtes ei ole kriitiline). Sama päeva kordusjooks
   asendab kirje. Backend (`GET /admin/usage-stats`, admin) ainult loeb ja koondab perioodi.
3. **Kettale ei kirjutata IP-aadresse ega User-Agente** — ainult arvud ja top-loendid
   (teose/isiku ID, viitaja domeen, IP-viitaja → „(IP-aadress)", roboti nimi). Fail
   `state/usage_stats.json`; tee arvutatakse skriptis sama reegliga mis `server/config.py`-s
   (valvur `tests/test_usage_stats.py`).
4. **Külastaja = eri IP, mis kasutas rakendust** (`/api/files/` või `/meili/`, mitte
   taustaküsitlus) — skännerid ja otsingurobotid API-t ei kasuta. Jälgimine (Zabbix) ja
   UA järgi robotid eraldi; taustaküsitlus loendatakse, aga ei ole tegevus.
5. **Teose pealkiri ainult loetavale teosele** (`can_read_work`), muidu paljas ID.

## Teadlikud piirangud

- SPA sees avatud teoseid logist ei näe (Meili POST, pildilogi `access_log off`):
  „top teosed" = OTSE avatud (väline link, järjehoidja, värskendus).
- Mitu inimest ühe IP taga (ülikooli võrk) = üks külastaja.
- JavaScripti käivitav brauserirobot (9.11.2026) paistab külastajate hüppena; UA järgi
  teda eristada ei saa.
