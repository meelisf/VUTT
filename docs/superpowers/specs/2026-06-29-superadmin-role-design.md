# Superadmin-roll — disain

**Kuupäev:** 2026-06-29
**Staatus:** kinnitatud disain, ootab implementatsiooniplaani

## Probleem

Praegu on kolm rolli: `contributor(0) < editor(1) < admin(2)`. Adminide vahel on
**horisontaalse privileegi-eskaleerimise auk**:

1. Iga admin saab teise adminni alandada editoriks (`update_user_role` / `delete_user`
   ei kontrolli sihtmärgi taset).
2. Editoriks alandatud kasutaja parooli saab seejärel resettida (`admin_reset_password`
   lubab `target_level < acting_level`).

→ Iga admin saab kahe sammuga üle võtta teise adminni konto.

Parooli-reset ise on JUBA kaitstud (`routers/admin.py:100-103`: `target_level >= acting_level`
blokeerib), aga `update_user_role` ja `delete_user` **ei ole** — seal ongi auk.

Lisaks on "superadmin" praegu **kõvakodeeritud häkk**: `auth.py:278` ja `:319` keelavad
`username == "meelis"` rolli muutmise/kustutamise erikorras, ilma päris rollita.

## Eesmärk

Lisada neljas tasand `superadmin`, mis:
- Annab ühele kasutajale (praegu Meelis) unikaalse autoriteedi hallata adminne.
- Sulgeb eskaleerimise augu üldise invariandiga.
- Koristab kõvakodeeritud `meelis`-erandid.
- Viib kollektsioonide **struktuurse** halduse superadminni taha.

## Mitte-eesmärgid (YAGNI)

- **Ei** nihutata olemasolevaid rolle ümber (editor→contributor jne). See muudaks iga
  `require_role(...)` värava semantikat kogu koodibaasis — suur plahvatusraadius. Lükatud
  tagasi.
- **Ei** tehta in-app "tõsta superadminniks" nuppu. Range invariant ei lubaks superadminnil
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

## Autoriseerimise invariant (tuum)

Üks jagatud helper `auth.py`-s:

```python
def can_manage(actor_role, target_current_role, new_role=None):
    """Kas actor tohib hallata target-kasutajat (rolli muutus / kustutus / reset)?
    Reegel 1 (sihtmärk): target praegune tase peab olema RANGELT madalam actor tasemest.
    Reegel 2 (määramise lagi): kui new_role antud, peab see olema RANGELT madalam actor tasemest.
    """
    a = ROLE_HIERARCHY.get(actor_role, 0)
    if ROLE_HIERARCHY.get(target_current_role, 0) >= a:
        return False
    if new_role is not None and ROLE_HIERARCHY.get(new_role, 0) >= a:
        return False
    return True
```

Tagajärjed:
- Admin (2) saab hallata contributor/editor (0,1), määrata rolle kuni editor (1). **Ei saa**
  kedagi adminniks tõsta ega adminni puutuda.
- Superadmin (3) saab hallata adminne (2), määrata rolle kuni admin (2). **Ei saa** teist
  superadminni luua (võrdne tase) — see on tahtlik, vt mitte-eesmärgid.
- Keegi ei saa puutuda superadminni → kõvakodeeritud `meelis`-erandid muutuvad üleliigseks.

### Rakenduskohad

| Funktsioon | Praegu | Muudatus |
|-----------|--------|----------|
| `update_user_role` (`auth.py:256`) | ei kontrolli sihtmärki | lisa `can_manage(actor, target_current, new_role)` |
| `delete_user` (`auth.py:303`) | ei kontrolli sihtmärki | lisa `can_manage(actor, target_current)` |
| `admin_reset_password` (`routers/admin.py:84`) | inline `target_level >= acting_level` | asenda `can_manage(actor, target_current)` |
| `auth.py:278` (`meelis` rolli-keeld) | kõvakood | **kustuta** (invariant katab) |
| `auth.py:319` (`meelis` delete-keeld) | kõvakood | **kustuta** (invariant katab) |

Säilib: `username == admin_user["username"]` keeld (ei saa muuta/kustutada iseennast) —
see lukustumis-kaitse jääb mõlemasse funktsiooni.

`update_user_role` `valid_roles` peab nüüd sisaldama `superadmin`-i (et seemendatud
superadmin oleks valiidne väärtus), aga `can_manage` lagi takistab tavaadminnil seda määrata.

## Seemendamine / migratsioon

- Meelis → `superadmin`: **ühekordne `users.json` käsitsi-muudatus serveris**. Üks väli,
  migratsiooniskripti pole vaja. (Roll tuleb niikuinii sealt.)
- Tulevikus teine superadmin: sama seemendamine serveris.
- Lukustumis-kaitse: superadmin ei saa iseennast alandada (olemasolev `username == self` keeld).

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

## Frontend (`src/pages/admin/Users.tsx`)

Ehitatakse olemasoleva committimata WIP **peale** (kebab-menüü portal/fixed-positsioneerimine —
rolliteemaga mitteseotud, ei klobestata).

- Rolli-dropdown näitab ainult valikuid `level < minu_tase` (admin: contributor/editor;
  superadmin: +admin). `superadmin` valikut dropdownis **ei ole** (ei saa määrata).
- Rea tegevused (rolli muutus / kustuta / reset) **disabled**, kui
  `target_level >= minu_tase`.
- `superadmin` rolli-badge.
- i18n: `et` + `en`, rolli-nimi ja badge.

Kasutaja taseme võrdluseks on frontendil vaja sama hierarhiat — väike konstant
(`ROLE_LEVELS`) frontendi pool, peegeldab backendi oma.

## Testid

`pytest` invariandi-maatriks (`can_manage`):
- Iga `(actor_role × target_current_role × new_role)` lubatud/keelatud kombinatsioon.
- Regressioon: admin **ei saa** adminni alandada ega kustutada (augu sulgemine).
- Superadmin saab adminni hallata; ei saa superadminni puutuda.
- Iseenda haldamise keeld säilib.

## Plahvatusraadius

Väike ja lokaalne:
- `auth.py`: hierarhia tsentraliseerimine, `can_manage`, kahe kõvakood-erandi kustutus,
  `update_user_role`/`delete_user` valvurid.
- `routers/admin.py`: reset kasutab `can_manage`-i.
- `routers/collections.py`: kolm väravat → `superadmin`.
- `src/pages/admin/Users.tsx` + i18n: UI-piirangud.
- Andmed: üks `users.json` väli serveris (käsitsi).
