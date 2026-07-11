# Superadmin-roll — disain

**Kuupäev:** 2026-06-29
**Staatus:** kinnitatud disain, ootab implementatsiooniplaani

## Probleem

Praegu on kolm rolli: `contributor(0) < editor(1) < admin(2)`. Adminide vahel on
**horisontaalse privileegi-eskaleerimise auk**:

1. Iga admin saab teise admini alandada editoriks (`update_user_role` / `delete_user`
   ei kontrolli sihtmärgi taset).
2. Editoriks alandatud kasutaja parooli saab seejärel resettida (`admin_reset_password`
   lubab `target_level < acting_level`).

→ Iga admin saab kahe sammuga üle võtta teise admini konto.

Parooli-reset ise on JUBA kaitstud (`routers/admin.py:100-103`: `target_level >= acting_level`
blokeerib), aga `update_user_role` ja `delete_user` **ei ole** — seal ongi auk.

Lisaks on "superadmin" praegu **kõvakodeeritud häkk**: `auth.py:278` ja `:319` keelavad
`username == "meelis"` rolli muutmise/kustutamise erikorras, ilma päris rollita.

## Eesmärk

Lisada neljas tasand `superadmin`, mis:
- Annab ühele kasutajale (praegu Meelis) unikaalse autoriteedi hallata admine.
- Sulgeb eskaleerimise augu üldise invariandiga.
- Koristab kõvakodeeritud `meelis`-erandid.
- Viib kollektsioonide **struktuurse** halduse superadmini taha.

## Mitte-eesmärgid (YAGNI)

- **Ei** nihutata olemasolevaid rolle ümber (editor→contributor jne). See muudaks iga
  `require_role(...)` värava semantikat kogu koodibaasis — suur plahvatusraadius. Lükatud
  tagasi.
- **Ei** tehta in-app "tõsta superadminiks" nuppu. Range invariant ei lubaks superadminil
  võrdset taset luua. Teine superadmin seemendatakse vajadusel serveris (`users.json`).
- **Ei** muudeta süsteemi-konfiguratsiooni (taksonoomiad, sõnavarad) — see on niikuinii
  serveri/koodi tasemel, ei puuduta kasutaja-õigusi.

## Rollimudel

```
contributor(0) < editor(1) < admin(2) < superadmin(3)
```

Hierarhia on praegu defineeritud inline mitmes kohas (`auth.py:217` `require_token`,
`auth.py:269` `valid_roles`, `routers/admin.py:100` `admin_reset_password`). **Tsentraliseeri**
üheks tõeallikaks `auth.py`-s:

```python
ROLE_HIERARCHY = {"contributor": 0, "editor": 1, "admin": 2, "superadmin": 3}
```

Kõik kohad loevad sellest. `require_role` (`deps.py`) delegeerib `require_token`-ile, mis
kasutab `ROLE_HIERARCHY`-t → automaatselt toetab `min_role="superadmin"`.

### Range taseme-lahendus (KRIITILINE)

**Ära kasuta `.get(role, 0)`-t taseme leidmiseks.** Tundmatu roll EI TOHI vaikselt
muutuda contributor-tasemeks (0) — see tekitab ohtlikke servajuhte, eriti `new_role`
puhul, kui mõni `valid_roles` kontroll vahele jääks. Range helper:

```python
def role_level(role: str) -> int:
    try:
        return ROLE_HIERARCHY[role]
    except KeyError:
        raise ValueError(f"Tundmatu roll: {role!r}")

def is_valid_role(role: str) -> bool:
    return role in ROLE_HIERARCHY
```

- `valid_roles` tuleb **otse** `ROLE_HIERARCHY.keys()`-ist, mitte eraldi käsitsi-nimekirjana
  (`auth.py:269` praegune `['contributor','editor','admin']` kustutatakse).
- Endpointid valideerivad sissetuleva `new_role` enne `role_level`-i kutsumist
  (`is_valid_role` → 400, kui vigane), et `role_level` ei viskaks kasutaja-sisendi peal.
- Salvestatud andmete tundmatu roll (`users.json` rikutud/legacy) → `role_level` viskab →
  500 + log, mitte vaikne madal õigus.

**Latentne bug, mille range helper paljastab:** `verify_user` (`auth.py:140`) tagastab
vaikimisi `role="user"` — see **pole hierarhias**. Paranda default → `"contributor"`.
Sama `auth.py:64` näiteprint ja kõik `.get("role", ...)` defaultid ühtlustada
`"contributor"`-iks (valiidne, madalaim).

## Autoriseerimise invariant (tuum)

**Üks `can_manage` asemel kolm fokuseeritud helperit** — turvaloogika on loetavam, kui
"kas tohib puutuda" ja "kas tohib määrata rolli" on lahus:

```python
def can_manage_user(actor_role, target_role) -> bool:
    """Kas actor tohib target-kasutajat üldse puutuda (reset / kustutus / rollimuutus)?
    Sihtmärgi praegune tase peab olema RANGELT madalam actor tasemest."""
    return role_level(target_role) < role_level(actor_role)

def can_assign_role(actor_role, new_role) -> bool:
    """Kas actor tohib MÄÄRATA rolli new_role? Lagi: rangelt madalam actor tasemest."""
    return role_level(new_role) < role_level(actor_role)

def can_change_role(actor_role, target_role, new_role) -> bool:
    """Rollimuutus = mõlemad: tohib target-i puutuda JA tohib uut rolli määrata."""
    return can_manage_user(actor_role, target_role) and can_assign_role(actor_role, new_role)
```

Endpointides selge:
- **reset / delete:** `can_manage_user(actor, target_current)`
- **rollimuutus:** `can_change_role(actor, target_current, new_role)`
- **kasutaja loomine rolli-valikuga** (kui selline tee tekib): `can_assign_role(actor, new_role)`

Tagajärjed:
- Admin (2) saab hallata contributor/editor (0,1), määrata rolle kuni editor (1). **Ei saa**
  kedagi admini-tasemele tõsta ega admini puutuda.
- Superadmin (3) saab hallata admine (2), määrata rolle kuni admin (2). **Ei saa** teist
  superadmini luua (võrdne tase) — see on tahtlik, vt mitte-eesmärgid.
- Keegi ei saa puutuda superadmini → kõvakodeeritud `meelis`-erandid muutuvad üleliigseks.
  **Nimi ise ei anna enam ühtegi eriõigust — eriõigus tuleb AINULT rollist.**

### Kasutaja-loomise / impordi / kutse teede audit

Verifitseeritud: ainus kasutaja-loomise tee on `approve_registration`
(`registration.py:322`), mis **kõvakodeeritult** seab `role="editor"` — admin EI vali
rolli loomisel. Seega ükski praegune tee ei luba admini ega superadmini **luua**;
rolli tõstmine käib ainult `update_user_role`-i kaudu, mille invariant valvab.
**Kui** loomine muutub tulevikus rolli-valitavaks (nt admini-loodud kasutaja rolliga),
peab seal olema `can_assign_role(actor, new_role)` lagi. Märgitud, et mitte unustada.

### Rakenduskohad

| Funktsioon | Praegu | Muudatus |
|-----------|--------|----------|
| `update_user_role` (`auth.py:256`) | ei kontrolli sihtmärki | `is_valid_role(new_role)` → muidu 400; siis `can_change_role(actor, target_current, new_role)` |
| `delete_user` (`auth.py:303`) | ei kontrolli sihtmärki | lisa `can_manage_user(actor, target_current)` |
| `admin_reset_password` (`routers/admin.py:84`) | inline `target_level >= acting_level` | asenda `can_manage_user(actor, target_current)` |
| `auth.py:278` (`meelis` rolli-keeld) | kõvakood | **kustuta** (invariant katab) |
| `auth.py:319` (`meelis` delete-keeld) | kõvakood | **kustuta** (invariant katab) |

Säilib: `username == admin_user["username"]` keeld (ei saa muuta/kustutada iseennast) —
see lukustumis-kaitse jääb mõlemasse funktsiooni.

`valid_roles` tuleb `ROLE_HIERARCHY.keys()`-ist → sisaldab automaatselt `superadmin`-i
(seemendatud väärtus on valiidne), aga `can_assign_role` lagi takistab tavaadminil seda
määrata.

### Tokeni / sessiooni roll ja värskus

Verifitseeritud käitumine: sessioon hoiab kasutaja **hetktõmmist** (`create_session`
salvestab `user` dicti; `require_token` loeb `session["user"]`-ist, **mitte** igal päringul
värskelt `users.json`-ist). Roll ei ole krüpteeritud tokeni sees — token on läbipaistmatu
UUID, mis viitab serveri-poolsele sessioonile.

Staleness on kaetud: `update_user_role` JA `delete_user` kutsuvad
`delete_user_sessions(username)` → sihtkasutaja **kõik** aktiivsed sessioonid
invalideeritakse kohe, sunnib re-login'i. Seega:
- Admini → editori alandamisel lõppeb tema kõrgema rolliga sessioon **otsekohe** (mitte
  kuni 24h tokeni-aegumiseni).
- Sama kehtib reset-tokenite kohta: `revoke_user_reset_tokens(..., "role_changed")` juba
  tühistab pooleliolevad reset-tokenid rolli muutusel (race-kaitse).

Järeldus: eraldi `token_version`-it ega tokeni lühendamist ei ole vaja — sessiooni-
invalideerimine täidab sama eesmärgi. Dokumenteeritud, et invariant ei sõltu sellest,
et keegi tuleviku-refaktoris session-snapshot'i fresh-lookup'iks vahetaks ilma
invalideerimist säilitamata.

## Seemendamine / migratsioon

- Meelis → `superadmin`: **ühekordne `users.json` käsitsi-muudatus serveris**. Üks väli,
  migratsiooniskripti pole vaja. (Roll tuleb niikuinii sealt.)
- Tulevikus teine superadmin: sama seemendamine serveris.
- Lukustumis-kaitse: superadmin ei saa iseennast alandada (olemasolev `username == self` keeld).

### Deploy-järjekord (KRIITILINE — locked-out risk)

Kui uus kood läheb peale **enne** `users.json` muutmist, ei pruugi süsteemis olla ühtegi
superadmini → keegi ei saa enam admine ega kollektsioonide struktuuri hallata. Õige
järjekord:

1. **Backup** `state/users.json` (host).
2. **Muuda** Meelise `role` → `superadmin` (`users.json`), atomic.
3. **Deploy** uus backend (`docker compose build --no-cache backend && up -d backend`).
4. **Kontrolli:** Meelis login OK; `/admin/users` laeb; rolli-muutus admini peal annab 403;
   superadmin näeb admini-halduse valikuid.
5. **Kontrolli invariant:** vähemalt üks superadmin eksisteerib.

### Startup-check

Serveri stardil (nt `rebuild_indices()` kõrval või `load_users` järel) **logi WARNING/ERROR**,
kui `users.json`-is pole ühtegi `superadmin` rolliga kasutajat. Ei paranda automaatselt —
annab operaatorile kohe märku, et superadmini halduse-funktsioonid on lukus.

## Kollektsioonid

Eralda struktuur sisust:

| Endpoint | Praegu | Muudatus |
|----------|--------|----------|
| `PUT /admin/collections/{id}` (`collections.py:92`) | `require_role("admin")` | `require_role("superadmin")` |
| `POST /admin/collections` (`collections.py:196`) | `require_role("admin")` | `require_role("superadmin")` |
| `DELETE /admin/collections/{id}` (`collections.py:298`) | `require_role("admin")` | `require_role("superadmin")` |
| `POST /works/bulk-collection` (`editing.py:196`) | `require_role("admin")` | **jääb admin** (sisu-kureerimine) |
| `GET /admin/collections/{id}/users` (`collections.py:176`) | `require_role("admin")` | jääb admin (luge-abi) |
| `GET .../works-count` (`collections.py:288`) | `require_role("admin")` | jääb admin (luge-abi) |

**PUT-i ulatus (leid):** `admin_update_collection` ei muuda ainult struktuuri (description,
description_long, color, visibility) — see haldab read 153-171 ka **`allowed_users`-t**,
st kes pääseb piiratud kollektsioonile ligi (kirjutab `users.json` `allowed_collections`,
invalideerib sessioonid). See on **ligipääsu-kontroll**, mis on superadmini taha viimist
veelgi rohkem õigustatud. Kõrvalmõju: tavaadmin ei saa enam kollektsiooni description/color
muuta. **Aktsepteeritud kompromiss v1-s** (kogu PUT → superadmin). Kui kosmeetiliste
väljade (description/color) muutmine peab jääma adminile, eraldatakse need omaette
endpointiks hilisemas iteratsioonis — praegu YAGNI.

**`POST /works/bulk-collection` jääb teadlikult adminile:** tööde lisamine olemasolevasse
kollektsiooni on sisu-kureerimine, mitte kollektsioonistruktuuri haldus.

## Frontend (`src/pages/admin/Users.tsx`)

Ehitatakse olemasoleva committimata WIP **peale** (kebab-menüü portal/fixed-positsioneerimine —
rolliteemaga mitteseotud, ei klobestata).

**Backend on ainutõde.** Frontend-piirangud on AINULT kasutusmugavuse jaoks; kõik reeglid
dubleeritakse backendis (`can_manage_user` / `can_change_role`). Frontendi keelu möödaminek
(nt käsitsi API-päring) lööb backendi 403-sse.

- Rolli-dropdown näitab ainult valikuid `level < minu_tase` (admin: contributor/editor;
  superadmin: +admin). `superadmin` valikut dropdownis **ei ole** (ei saa määrata).
- Rea tegevused (rolli muutus / kustuta / reset) **disabled**, kui
  `target_level >= minu_tase`.
- **Disabled tegevus näitab tooltip'i/seletust**, nt "Sul ei ole õigust hallata sama või
  kõrgema taseme kasutajat" — muidu admin näeb halli nuppu ega tea, kas see on bug või
  õiguste piirang.
- `superadmin` rolli-badge.
- i18n: `et` + `en`, rolli-nimi, badge ja tooltip-tekst.

Kasutaja taseme võrdluseks on frontendil vaja sama hierarhiat — väike konstant
(`ROLE_LEVELS`) frontendi pool, peegeldab backendi oma.

## Testid

`pytest` invariandi-maatriks (`role_level` / `can_manage_user` / `can_assign_role` /
`can_change_role`):

**Tuum-invariant:**
- Iga `(actor_role × target_current_role × new_role)` lubatud/keelatud kombinatsioon.
- Regressioon (augu sulgemine): admin **ei saa** admini alandada ega kustutada.
- Superadmin saab admini hallata/resettida; **ei saa** superadmini puutuda.
- Superadmin **ei saa** määrata `superadmin` rolli (võrdne tase).
- Iseenda haldamise keeld säilib (`username == self`).

**Range taseme-käsitlus:**
- Tundmatu roll `users.json`-is → `role_level` viskab; ei anta vaikimisi contributor-õigusi
  (käitumine: 500 + log, mitte vaikne madal õigus).
- Tundmatu `new_role` API payloadis → 400 (`is_valid_role` enne `role_level`-i).
- `verify_user` default → `"contributor"` (mitte `"user"`), kontrollitud.

**`meelis`-erandi regressioon:**
- Kasutajanimi ise ei anna enam ühtegi eriõigust — eriõigus tuleb ainult rollist
  (test: `admin` rolliga "meelis" käitub nagu tavaadmin; `superadmin` rolliga suvaline nimi
  käitub nagu superadmin).

**Endpoint-tasand:**
- Kollektsioonide create/update/delete: admin → 403, superadmin → läbi.
- `bulk-collection`: admin → läbi (jääb adminile).
- Reset: admin saab editorit resettida, admini mitte; superadmin saab admini resettida,
  superadmini mitte.

**Tokeni staleness:**
- Rolli muutus → sihtkasutaja sessioonid invalideeritud (kõrgema rolliga sessioon lõpeb
  kohe). Teadlikult testitud/dokumenteeritud käitumine.

## Plahvatusraadius

Väike ja lokaalne:
- `auth.py`: hierarhia tsentraliseerimine, `can_manage`, kahe kõvakood-erandi kustutus,
  `update_user_role`/`delete_user` valvurid.
- `routers/admin.py`: reset kasutab `can_manage`-i.
- `routers/collections.py`: kolm väravat → `superadmin`.
- `src/pages/admin/Users.tsx` + i18n: UI-piirangud.
- Andmed: üks `users.json` väli serveris (käsitsi).
