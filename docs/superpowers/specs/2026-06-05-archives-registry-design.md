# Arhiivide register — disainidokument

**Kuupäev:** 2026-06-05  
**Staatus:** Kinnitatud

## Taust

Praegu on arhiivide register staatiliselt `data/config/archives.json`-is, ainult GET-endpoint, admin sektsioonis pole haldust. Kui teose metaandmetes on viide arhiivile, mis pole registris, ei ole võimalust seda otse lisada. MetadataModali dropdown on tavaline `<select>` ilma otsinguta.

## Eesmärk

1. Admin saab arhiive lisada/muuta/kustutada Maintenance lehelt
2. Admin saab arhiivi lisada otse MetadataModali inline-vormist
3. Editor saab MetadataModalist saata adminile teavituse uue arhiivi lisamiseks
4. Dropdown on otsitav kui arhiive on palju

---

## Andmekiht

`data/config/archives.json` struktuur jääb muutumatuks:

```json
{
  "RA": { "name": "Rahvusarhiiv", "url": "https://ais.ra.ee" },
  "TÜR": { "name": "Tartu Ülikooli Raamatukogu" }
}
```

- `id` (objekti võti) — kasutaja valitud lühend (nt "RA", "HAB"), muutumatu pärast loomist
- `name` — arhiivi täisnimi, muudetav
- `url` — institutsiooni peasait, muudetav, valikuline

`id` muutmine pole lubatud — olemasolevad `_metadata.json` viited (`archive_id: "RA"`) läheksid katki.

---

## Backend API

### Uued endpointid

| Meetod | URL | Roll | Kirjeldus |
|--------|-----|------|-----------|
| `POST` | `/config/archives` | admin | Lisa uus arhiiv |
| `PUT` | `/config/archives/{archive_id}` | admin | Muuda nime/URL-i |
| `DELETE` | `/config/archives/{archive_id}` | admin | Kustuta arhiiv |

### POST `/config/archives`

**Body:** `{ "id": "EKM", "name": "Eesti Kirjandusmuuseum", "url": "https://www.kirmus.ee" }`

- Valideerib: id ja name on kohustuslikud, id ei tohi olla tühi
- Tagastab `409` kui id juba olemas: `{ "detail": "Arhiiv tähisega 'EKM' on juba olemas" }`
- Edukalt: kirjutab `archives.json`, invalideerib cache, tagastab lisatud kirje

### PUT `/config/archives/{archive_id}`

**Body:** `{ "name": "Uus nimi", "url": "https://..." }`

- Id-d muuta ei saa (URL path kaudu tuvastatav, body id väli ignoreeritakse)
- Tagastab `404` kui id ei eksisteeri

### DELETE `/config/archives/{archive_id}`

- Ilma `?force=true` parameetrita: kontrollib kasutust kõigis `_metadata.json` failides
  - Kui kasutusel: tagastab `409` — `{ "detail": "Arhiiv 'RA' on kasutusel 3 teoses: Teos A, Teos B, Teos C" }`
  - Kui ei ole kasutusel: kustutab, tagastab `200`
- `?force=true` parameetriga: kustutab ilma kontrollita (viited `_metadata.json` failides jäävad alles)
- Cache invalidatsioon pärast kustutamist

**Frontend kustutamise voog:**
1. Kutsu `DELETE /config/archives/{id}` (ilma force'ita)
2. Kui `200`: done
3. Kui `409`: näita kinnitusdialoogi koos backend-i sõnumiga — "Arhiiv on kasutusel. Kas soovid ikkagi kustutada? Viited teostes jäävad alles."
4. Kui kinnitatakse: kutsu `DELETE /config/archives/{id}?force=true`

### Cache

Olemasolev `get_cached_archives()` / `invalidate_cache("archives")` muster — kirjutusel invalideeritakse, järgmine päring laeb uuesti failist.

---

## Frontend: `ArchiveSelect` komponent

**Fail:** `src/components/ArchiveSelect.tsx`

Asendab praeguse `<select>` nii MetadataModalis kui muudes kohtades kus arhiivi valida.

### Kombobox käitumine

- Suletud: näitab valitud arhiivi (`id — Nimi`) või `— Arhiiv —`
- Avamisel: ripploend koos filtriväljaga ülaosas
- Filtriväli peidetud kui arhiive ≤ 8 (praegune maht)
- Filtreerimine id ja nime järgi (case-insensitive)
- Klõps väljaspool sulgeb loendi

### "+" nupp

Nupp ilmub komboboxi kõrval. Käitumine sõltub rollist:

**Admin:**
- Avab inline mini-vormi: Lühend (id), Nimi, URL (valikuline)
- Lühendi reaalajas kontroll: kui id juba eksisteerib kohalikus `archives` state'is, kuvatakse koheselt hoiatus (enne serveripäringut)
- Salvestamisel `POST /config/archives`
- Edukalt: uus arhiiv lisatakse lokaalsesse state'i, valitakse automaatselt, loend sulgub
- Vea korral (409 vms): kuvatakse backend-i `detail` sõnum inline

**Editor (mitte admin):**
- Avab modaali eeltäidetud teavitusvormiga: "Soovin lisada arhiivi registrisse: [lühend], [nimi], [URL]"
- Kasutaja saab teksti muuta
- Saatmisel `POST /notifications/send` kõigile adminidele
- Kontribuutoril `+` nuppu ei kuvata

---

## Frontend: Maintenance leht

**Fail:** `src/pages/admin/Maintenance.tsx`

Uus "Arhiivide register" sektsioon lisatakse **enne** olemasolevaid refresh-aktsioone.

### Sektsioon struktuur

```
[ Arhiivide register ]                    [ + Lisa arhiiv ]

┌──────────┬─────────────────────────────┬───────────────┬──────────┐
│ Lühend   │ Nimi                        │ URL           │          │
├──────────┼─────────────────────────────┼───────────────┼──────────┤
│ RA       │ Rahvusarhiiv                │ ais.ra.ee  ↗  │ ✎  ×    │
│ TÜR      │ Tartu Ülikooli Raamatukogu  │ —             │ ✎  ×    │
└──────────┴─────────────────────────────┴───────────────┴──────────┘
```

### Lisa arhiiv

"+ Lisa arhiiv" nupul avaneb sektsioonitaseme vorm (inline, mitte modaal):
- Väljad: Lühend, Nimi, URL (valikuline) + Salvesta / Tühista
- Duplicate-kontroll: sama loogika mis `ArchiveSelect`-is

### Muutmine

Rea "muuda" nupul lähevad Nimi ja URL in-place muutmisväljakuteks (Lühend jääb lukku).

### Kustutamine

Esimene DELETE-päring ilma force'ita. Kui backend tagastab `409`, kuvatakse kinnitusdialoog backend-i sõnumiga. Kinnitamisel saadetakse `DELETE ?force=true`.

---

## Tõlked

Lisatavad võtmed `locales/et/admin.json` ja `locales/en/admin.json`:

```json
"archives": {
  "title": "Arhiivide register",
  "addArchive": "Lisa arhiiv",
  "id": "Lühend",
  "name": "Nimi",
  "url": "URL (valikuline)",
  "duplicateId": "Lühend '{{id}}' on juba kasutusel",
  "deleteConfirm": "Kustuta arhiiv '{{id}}'?",
  "deleteInUseWarning": "See arhiiv on kasutusel {{count}} teoses. Kustutamine ei eemalda viiteid teostest.",
  "requestTitle": "Taotle arhiivi lisamist",
  "requestBody": "Soovin lisada arhiivi registrisse: {{id}}, {{name}}{{url}}"
}
```

---

## Avatud küsimused

Puuduvad — disain on täielik.
