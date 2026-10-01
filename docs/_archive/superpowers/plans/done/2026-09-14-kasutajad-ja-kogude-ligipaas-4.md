# Etapp 4 — ühine „Kogud" sisenemiskoht (teostusplaan)

> **Agentidele:** KOHUSTUSLIK ALAMOSKUS: kasuta selle plaani täitmiseks
> `superpowers:subagent-driven-development` (soovitatud) või
> `superpowers:executing-plans`. Sammud on checkbox-kujul (`- [ ]`).

**Eesmärk:** kogude haldusel on üks sisenemiskoht („Kogud") tüübifiltri ja
nimeotsinguga; kollektsioonil on detailvaade kolme plokiga (Teosed / Ligipääs /
Seaded) vastavalt õigustele; vanad kirjutusteed (`update-collections`,
`update-edit-collections`) kaovad serverist; #318 kaks lahtist pisiasja saavad
lahenduse ja ADR 0043 üleminekumärkus eemaldatakse.

**Arhitektuur:** eri andmemudeleid EI liideta. Ühine on ainult
sisenemiskoht ja loend: puhas moodul `kogudeLoend.ts` ehitab kollektsioonidest
ja töökollektsioonidest ühe reaploendi (`kind`, `id`, `name`, `depth`),
tüübifilter ja otsing rakenduvad sellele. Rida viib olemasoleva halduse juurde:
kollektsioon uude detailimarsruuti (`CollectionEditor` juhitava valikuga +
olemasolev `CollectionAccessPanel`), töökollektsioon olemasolevasse
`WorkSets.tsx`-i deep-lingiga. Serverisse uusi endpointe ei lisandu — ainult
kaks vana eemaldatakse.

**Tehnoloogia:** FastAPI + pytest; React 19 + TypeScript + Tailwind, vitest,
i18next, react-router (`useSearchParams`, `useParams`).

**Spekk:** [`docs/superpowers/specs/2026-09-14-kasutajad-ja-kogude-ligipaas-design.md`](../specs/2026-09-14-kasutajad-ja-kogude-ligipaas-design.md) (§4, §3, §5)
**ADR:** [0043](../../decisions/0043-kogude-oiguste-uhised-toimingud.md), [0031](../../decisions/0031-contributor-kollektsiooni-ulatus.md), [0038](../../decisions/0038-kahe-peegli-vahel-peab-olema-ulimuslikkus.md), [0042](../../decisions/0042-tookollektsiooni-liikmesust-ei-indekseerita.md), [0007](../../decisions/0007-tuletatud-indeksid-on-read-modelid.md)
**Eelnevad etapid:** 1a (#361), 1b (#362), 2 (#363–#365), 3a (#366), 3b (#367) — kõik tootmises 2026-09-14.

## Üldised piirangud

- **Koodikommentaarid eesti keeles.** Kommentaar ütleb MIKS, mitte MIDA.
- **i18n (ADR 0011):** `fallbackLng` on VÄLJAS — iga uus võti lisatakse
  `et` JA `en` faili KORRAGA. Valvurid: `localeParity.test.ts`,
  `translationKeysResolve.test.ts`.
- **Peitmine ei ole autoriseerimine.** Kollektsiooni SEADED jäävad serveris
  `require_role("superadmin")` taha, kogude loend ja ligipääs on admin+,
  töökollektsiooni toimingud kontrollib server kogu kaupa. Vaate rollikontroll
  on mugavus, mitte kaitse.
- **Andmemudeleid ei liideta** (spekk §4). `collections.json` hierarhia ja
  `work_sets/{id}.json` jäävad eraldi; ühine on reaploend kuvamiseks.
- **Kollektsiooni „Teosed" EI OLE uus lugemistee.** Teoste kuuluvus elab
  `_metadata.json`-is ja otsingus (ADR 0007); detailis on LINK otsingusse
  selle kollektsiooni filtriga, mitte uus loend ega uus endpoint.
- **URL-i peeglit ei ehitata teist korda (ADR 0038).** Hubi tüübifilter ja
  otsing elavad AINULT URL-is; `useCollectionUrlSync`-i ei kutsuta ja aktiivne
  kogu ei muutu. Need on haldusfiltrid, mitte koguvalik.
- **Töökollektsiooni liikmesus ei jõua Meilisse (ADR 0042).** Hub ei tohi
  lisada ühtki uut päringut liikmete kohta; loendis on ainult see, mis
  `listWorkSets` juba annab.
- **Python 3.9** (`Optional[dict]`), blokeeriv I/O `async def` sees keelatud.
- **Väravad iga taski lõpus:** `npm run typecheck` · `npm test` (kliendi
  taskid), `.venv/bin/pytest tests/ -q` (serveri taskid). PR-i lõpus lisaks
  `npm run lint:ci` ja `npm run build`.
- **`npm run lint:ci` lävi on `--max-warnings 43`.** Läve ei tõsteta; kui
  hoiatusi jääb vähemaks, LANGETA arvu `package.json`-is.

## Kolm PR-i

| PR | Sisu | Sõltuvus |
|---|---|---|
| **4a** | server: vanad `update-collections` / `update-edit-collections` endpointid ja helperid maha, lukuvalvur delta peale | iseseisev, juurutatav üksi |
| **4b** | klient: ühine „Kogud" sisenemiskoht, tüübifilter, kollektsiooni detail, vanade URL-ide toimimine | eeldab 4a merge'i (mitte koodiliselt, vaid järjekorra pärast) |
| **4c** | klient: kaks lahtist pisiasja (`role_based` silt, 401 eristus) + ADR 0043 üleminekumärkuse eemaldamine | viimane |

## Failistruktuur

| Fail | Vastutus | Muudatus |
|---|---|---|
| `server/routers/admin.py` | kaks vana endpointi maha | muuda (4a) |
| `server/auth.py` | `update_user_allowed_collections`, `update_user_edit_collections` maha | muuda (4a) |
| `tests/test_users_lock.py` | lukuvalvur `apply_collection_rights_delta` peal | muuda (4a) |
| `tests/test_user_collections.py` | helperi ühiktestid | **kustuta** (4a) |
| `tests/test_user_collections_api.py` | endpoint kadunud → 404 valvur | kirjuta ümber (4a) |
| `src/utils/diacritics.ts` | `normalizeForSearch` | **uus** (4b) |
| `src/utils/userSearch.ts` | kasutab jagatud normaliseerijat | muuda (4b) |
| `src/pages/admin/kogudeLoend.ts` | kahe mudeli ühine reaploend + filter | **uus** (4b) |
| `src/pages/admin/__tests__/kogudeLoend.test.ts` | ülaltoodu kate | **uus** (4b) |
| `src/components/CollectionEditor.tsx` | juhitav valik (`selectedId`, `onSelectId`, `showPicker`) | muuda (4b) |
| `src/pages/admin/CollectionDetail.tsx` | kollektsiooni detail: Teosed / Ligipääs / Seaded | **uus** (4b) |
| `src/pages/admin/CollectionsHub.tsx` | `/admin/collections` — ühine loend | **uus** (4b) |
| `src/pages/admin/Collections.tsx` | asendub hubiga | **kustuta** (4b) |
| `src/pages/admin/WorkSets.tsx` | `?set=<id>` deep-link | muuda (4b) |
| `src/pages/Admin.tsx` | kaks kaarti → üks „Kogud" | muuda (4b) |
| `src/App.tsx` | marsruudid `/admin/collections/:id` | muuda (4b) |
| `src/pages/admin/collectionRightsDraft.ts` | `basisLabelVisible` | muuda (4c) |
| `src/components/CollectionAccessPanel.tsx`, `src/pages/admin/UserDetail.tsx` | sildi kuvamine ühest kohast | muuda (4c) |
| `src/utils/apiErrorText.ts` | `isSessionExpired` | **uus** (4c) |
| `src/components/CollectionPicker.tsx`, mõlemad ligipääsupaneelid | 401 ≠ „ei ole" | muuda (4c) |
| `docs/decisions/0043-…md`, `docs/decisions/README.md` | üleminekumärkus maha | muuda (4c) |

---

# Osa 4a — vanad kirjutusteed maha

Etapist 2 alates kirjutab klient kollektsiooniõigusi AINULT deltaga
(`POST /admin/users/collection-rights`). Etapist 3b alates ei kutsu ükski
klient enam vanu endpointe (`grep` kliendis puhas). Kaks kirjutusteed sama
välja peale on see, mida ADR 0043 p2 keelab — nüüd läheb vana maha.

### Task 0: haru

- [ ] **Samm 1: värske main**

```bash
git checkout main && git pull --ff-only && git log --oneline -1
```

Oodatud: `851c4604` (3b merge) või uuem.

- [ ] **Samm 2: haru**

```bash
git checkout -b feat/vanade-oiguste-teede-eemaldus-4a
```

---

### Task 1: lukuvalvur elava tee peale

`tests/test_users_lock.py` kontrollib 1a lepingut („loe-muuda-salvesta on
terve `users_lock` all; teine lõim ei loe poolikut cache'i"). Praegu juhib
seda `update_user_edit_collections`, mis on kohe kadumas. Valvur peab jääma —
ta kolib elava tee (`apply_collection_rights_delta`) peale.

**Failid:** Muuda: `tests/test_users_lock.py`

- [ ] **Samm 1: vaheta helper delta vastu**

Asenda mõlemas lõimefunktsioonis kutse. Vana:

```python
        ok, _sonum, _ = auth.update_user_edit_collections("contrib", ["sample"], admin)
```

Uus:

```python
        ok, _sonum, _ = auth.apply_collection_rights_delta(
            [{"username": "contrib", "collection_id": "sample",
              "field": "edit", "action": "add"}], admin)
```

ja teises lõimes sama `contrib_muu` peal. Lisa faili päisesse kommentaar:

```python
# Valvur käib ELAVA kirjutustee peal (ADR 0043 p2). Varem juhtis seda
# `update_user_edit_collections`; see eemaldati etapis 4a ja valvur, mis
# testib kadunud teed, ei kaitse midagi.
```

NB: delta valideerib kogu olemasolu `get_cached_collections()` kaudu — vaata,
kuidas `tests/test_collection_rights_delta.py` kogu `sample` olemasolevaks
teeb, ja kasuta sama võtet (monkeypatch), mitte päris konfiguratsiooni.

- [ ] **Samm 2: käivita — peab läbima VANA koodiga**

Käsk: `.venv/bin/pytest tests/test_users_lock.py -v`
Oodatud: PASS. See test ei ole punane-enne-rohelist tsükkel, vaid valvuri
kolimine; ta peab läbima nii enne kui pärast eemaldust. Kui ta ei läbi enne
eemaldust, ei testi ta lukku, vaid midagi muud — peatu ja ütle.

- [ ] **Samm 3: commit**

```bash
git add tests/test_users_lock.py
git commit -m "test: users_lock valvur elava delta-tee peale (#318)"
```

---

### Task 2: endpointid ja helperid maha

**Failid:**
- Muuda: `server/routers/admin.py`, `server/auth.py`
- Kustuta: `tests/test_user_collections.py`
- Kirjuta ümber: `tests/test_user_collections_api.py`

- [ ] **Samm 1: kirjuta valvurtest (kukub, sest endpoint veel vastab)**

Asenda `tests/test_user_collections_api.py` sisu:

```python
"""Vanad kollektsiooniõiguste endpointid on EEMALDATUD (#318, etapp 4a).

Kaks kirjutusteed sama välja peale on ADR 0043 p2 keeld: vana täisasendus
võis avalikuks muutunud kogu ID sanitiseerimisel vaikselt maha võtta. Alates
etapist 2 kirjutab klient ainult deltaga ja etapist 3b ei kutsu vanu teid enam
keegi. See test hoiab ära nende vaikse tagasitoomise.
"""


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_vana_update_collections_on_kadunud(client, login):
    token = login("admin", "adminpass")
    r = client.post("/admin/users/update-collections",
                    json={"username": "editor", "allowed_collections": []},
                    headers=_auth(token))
    assert r.status_code == 404, r.text


def test_vana_update_edit_collections_on_kadunud(client, login):
    token = login("admin", "adminpass")
    r = client.post("/admin/users/update-edit-collections",
                    json={"username": "editor", "edit_collections": []},
                    headers=_auth(token))
    assert r.status_code == 404, r.text


def test_delta_tee_toimib_edasi(client, login, monkeypatch):
    # Eemaldus ei tohi võtta ära ainsat allesjäänud kirjutusteed.
    from server import auth
    monkeypatch.setattr(auth, "get_cached_collections", lambda: {
        "r1": {"name": {"et": "R1"}, "visibility": "restricted"},
    })
    token = login("admin", "adminpass")
    r = client.post("/admin/users/collection-rights",
                    json={"changes": [{"username": "editor", "collection_id": "r1",
                                       "field": "allowed", "action": "add"}]},
                    headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["users"]["editor"]["allowed_collections"] == ["r1"]
```

- [ ] **Samm 2: käivita ja veendu, et kaks esimest kukuvad**

Käsk: `.venv/bin/pytest tests/test_user_collections_api.py -v`
Oodatud: kaks FAIL (`assert 200 == 404`), kolmas PASS.

- [ ] **Samm 3: eemalda endpointid**

`server/routers/admin.py`: kustuta `admin_update_collections` ja
`admin_update_edit_collections` funktsioonid koos dekoraatoritega ning
`update_user_allowed_collections` / `update_user_edit_collections` impordid
`..auth`-ist.

- [ ] **Samm 4: eemalda helperid**

`server/auth.py`: kustuta funktsioonid `update_user_allowed_collections` ja
`update_user_edit_collections`. Kontrolli enne:

```bash
grep -rn "update_user_allowed_collections\|update_user_edit_collections" server/ tests/ scripts/ mcp/
```

Ainsad allesjäänud vasted tohivad olla KOMMENTAARIDES (nt `server/auth.py`
`_RIGHTS_FIELDS` juures ja `tests/test_admin_role_endpoints.py` selgituses).
Kui leiad kutsuja, peatu ja ütle — see tähendab, et tee ei ole surnud.
**Kontrolli ka `server/__init__.py` re-eksporte** (CLAUDE.md: funktsiooni
eemaldamisel on see juba korra unustatud).

- [ ] **Samm 5: kustuta helperi ühiktestid**

```bash
git rm tests/test_user_collections.py
```

Need testivad ainult kadunud funktsiooni sisendikontrolli. Delta oma
valideerimine on kaetud failis `tests/test_collection_rights_delta.py` —
vaata see enne kustutamist üle ja ütle aruandes, kui mõni kontroll
(nt tühja kasutajanime tagasilükkamine) jääb katmata.

- [ ] **Samm 6: käivita kogu serveri komplekt**

Käsk: `.venv/bin/pytest tests/ -q`
Oodatud: PASS. `test_user_collections_api.py` kolm testi rohelised.

- [ ] **Samm 7: commit**

```bash
git add -A server/ tests/
git commit -m "refactor(admin): eemalda vanad kollektsiooniõiguste endpointid ja helperid (#318)"
```

---

### Task 3: 4a väravad ja PR

- [ ] **Samm 1: väravad**

```bash
.venv/bin/pytest tests/ -q && npm run typecheck && npm test && npm run lint:ci && npm run build
```

- [ ] **Samm 2: PR**

```bash
git push -u origin feat/vanade-oiguste-teede-eemaldus-4a
gh pr create --base main --title "Vanad kollektsiooniõiguste kirjutusteed maha (#318, etapp 4a)" --body "$(cat <<'BODY'
ADR 0043 p2: üks kirjutustee. `POST /admin/users/update-collections` ja `/update-edit-collections` on eemaldatud koos `auth.update_user_*_collections` helperitega; ainus tee on delta `POST /admin/users/collection-rights`.

- Klient ei kutsunud neid enam alates etapist 3b (PR #367).
- `tests/test_users_lock.py` valvur kolis elava delta-tee peale — valvur, mis testib kadunud teed, ei kaitse midagi.
- Uus valvurtest hoiab ära vaikse tagasitoomise (404) ja kontrollib, et delta-tee töötab edasi.

**Murdev ainult vana kliendi jaoks** — tootmises sellist klienti ei ole, aga juurutus peab olema pärast PR #367 juurutust (see on juba tootmises).
BODY
)"
```

---

# Osa 4b — ühine „Kogud" sisenemiskoht

### Task 4: jagatud otsingu-normaliseerija

Hubi otsing peab leidma „Vennaste" ka päringuga „vennaste" ja „Jõgi" päringuga
„jogi". Sama normaliseerija on juba `userSearch.ts`-i sees privaatsena; kolmas
koopia lahkneks (nii nagu kaks kasutajaotsingut juba korra lahknesid, #318).

**Failid:**
- Loo: `src/utils/diacritics.ts`
- Muuda: `src/utils/userSearch.ts`
- Test: `src/utils/__tests__/diacritics.test.ts`

**Liidesed:** Toodab `normalizeForSearch(s: string): string`.

- [ ] **Samm 1: kirjuta kukkuv test**

```ts
import { describe, expect, it } from 'vitest';
import { normalizeForSearch } from '../diacritics';

describe('normalizeForSearch', () => {
  it('eemaldab diakriitikud ja väiketähestab', () => {
    expect(normalizeForSearch('Jõgi')).toBe('jogi');
    expect(normalizeForSearch('VENNASTEKOGUDUS')).toBe('vennastekogudus');
  });

  it('lõikab servatühikud ja talub tühja sisendit', () => {
    expect(normalizeForSearch('  Tartu  ')).toBe('tartu');
    expect(normalizeForSearch('')).toBe('');
  });
});
```

- [ ] **Samm 2: käivita, veendu et kukub**

Käsk: `npx vitest run src/utils/__tests__/diacritics.test.ts`
Oodatud: FAIL — `Failed to resolve import "../diacritics"`.

- [ ] **Samm 3: teostus**

`src/utils/diacritics.ts`:

```ts
/**
 * Diakriitikatundetu otsingutekst.
 *
 * NFD + kombineerivate märkide eemaldus: „Jõgi" ja „Jogi" peavad leidma
 * teineteist MÕLEMAS suunas. Eraldi moodul, sest sama normaliseerimist vajavad
 * kasutajaotsing ja kogude otsing — kaks koopiat lahknesid juba korra (#318).
 */
export function normalizeForSearch(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
```

`src/utils/userSearch.ts`: kustuta privaatne `normaliseeri` ja impordi
`normalizeForSearch` — käitumine ei muutu, olemasolevad testid peavad läbima
muutmata kujul.

- [ ] **Samm 4: testid ja commit**

```bash
npx vitest run src/utils/__tests__/diacritics.test.ts
npm run typecheck && npm test
git add src/utils/diacritics.ts src/utils/userSearch.ts src/utils/__tests__/diacritics.test.ts
git commit -m "refactor: jagatud diakriitikatundetu otsingu-normaliseerija (#318)"
```

---

### Task 5: `kogudeLoend.ts` — kahe mudeli ühine reaploend

**Failid:**
- Loo: `src/pages/admin/kogudeLoend.ts`
- Test: `src/pages/admin/__tests__/kogudeLoend.test.ts`

**Liidesed:**
- Tarbib: `normalizeForSearch` (Task 4), `Collections` tüüp
  (`../../services/collectionService`), `WorkSetSummary`
  (`../../services/workSetService`).
- Toodab: `KoguRida`, `KoguTyyp`, `buildKoguRows(...)`,
  `tyypFromParam(p)`, `paramFromTyyp(t)`.

- [ ] **Samm 1: kirjuta kukkuv test**

```ts
import { describe, expect, it } from 'vitest';
import { buildKoguRows, tyypFromParam } from '../kogudeLoend';
import { WorkSetSummary } from '../../../services/workSetService';

const KOGUD = {
  juur: { name: { et: 'Juurkogu', en: 'Root' }, visibility: 'public' as const },
  laps: { name: { et: 'Lapskogu', en: 'Child' }, parent: 'juur', visibility: 'restricted' as const },
  ruhm: { name: { et: 'Rühm', en: 'Group' }, type: 'virtual_group' as const },
};

// Ainult buildKoguRows'i loetavad väljad; ülejäänud WorkSetSummary väljad ei
// puutu siia asjasse.
const KOGUMID = [
  { id: 's1', name: { et: 'Vennastekogudus', en: 'Moravian' }, status: 'active' },
  { id: 's2', name: { et: 'Arhiveeritud', en: 'Archived' }, status: 'archived' },
] as unknown as WorkSetSummary[];

describe('buildKoguRows', () => {
  it('hierarhia säilib: laps tuleb vanema järel ja on sügavamal', () => {
    const read = buildKoguRows(KOGUD, [], { tyyp: 'collections', q: '' }, 'et');
    const idd = read.map(r => r.id);
    expect(idd.indexOf('laps')).toBe(idd.indexOf('juur') + 1);
    expect(read.find(r => r.id === 'laps')!.depth).toBe(1);
    expect(read.find(r => r.id === 'juur')!.depth).toBe(0);
  });

  it('tüübifilter eraldab mudelid', () => {
    expect(buildKoguRows(KOGUD, KOGUMID, { tyyp: 'work_sets', q: '' }, 'et')
      .every(r => r.kind === 'work_set')).toBe(true);
    expect(buildKoguRows(KOGUD, KOGUMID, { tyyp: 'collections', q: '' }, 'et')
      .every(r => r.kind === 'collection')).toBe(true);
    expect(buildKoguRows(KOGUD, KOGUMID, { tyyp: 'all', q: '' }, 'et')).toHaveLength(5);
  });

  it('otsing on diakriitikatundetu ja käib kuvatava nime järgi', () => {
    const read = buildKoguRows(KOGUD, KOGUMID, { tyyp: 'all', q: 'ruhm' }, 'et');
    expect(read.map(r => r.id)).toEqual(['ruhm']);
  });

  it('otsing lamendab hierarhia: vaste ilma vanemata on depth 0', () => {
    // Muidu ripuks „Lapskogu" tühjas õhus taande all, mille vanemat ei kuvata.
    const read = buildKoguRows(KOGUD, [], { tyyp: 'all', q: 'laps' }, 'et');
    expect(read).toHaveLength(1);
    expect(read[0].depth).toBe(0);
  });

  it('keel valib kuvanime, puuduv langeb eesti keelele', () => {
    const [juur] = buildKoguRows(KOGUD, [], { tyyp: 'collections', q: 'root' }, 'en');
    expect(juur.name).toBe('Root');
  });

  it('töökollektsiooni arhiveeritud staatus tuleb kaasa', () => {
    const read = buildKoguRows({}, KOGUMID, { tyyp: 'work_sets', q: '' }, 'et');
    expect(read.find(r => r.id === 's2')!.archived).toBe(true);
    expect(read.find(r => r.id === 's1')!.archived).toBe(false);
  });
});

describe('tyypFromParam', () => {
  it('tundmatu väärtus tähendab „kõik", mitte tühja loendit', () => {
    expect(tyypFromParam('jama')).toBe('all');
    expect(tyypFromParam(null)).toBe('all');
    expect(tyypFromParam('work_sets')).toBe('work_sets');
  });
});
```

- [ ] **Samm 2: käivita, veendu et kukub**

Käsk: `npx vitest run src/pages/admin/__tests__/kogudeLoend.test.ts`
Oodatud: FAIL — `Failed to resolve import "../kogudeLoend"`.

- [ ] **Samm 3: teostus**

`src/pages/admin/kogudeLoend.ts`:

```ts
/**
 * Kogude haldusloendi read (#318, spekk §4).
 *
 * Kaks andmemudelit — hierarhilised kollektsioonid (`collections.json`) ja
 * lamedad töökollektsioonid (`work_sets/{id}.json`) — EI OLE liidetud. Siin
 * tehakse neist ainult ühine KUVAMISE reaploend; kuuluvus, õigused ja
 * salvestus jäävad kumbki oma teele.
 *
 * Otsing lamendab hierarhia meelega: kui vaste vanemat ei kuvata, ripuks
 * taandega rida tühjas õhus.
 */
import { normalizeForSearch } from '../../utils/diacritics';
import { Collections } from '../../services/collectionService';
import { WorkSetSummary } from '../../services/workSetService';

export type KoguTyyp = 'all' | 'collections' | 'work_sets';

export interface KoguRida {
  kind: 'collection' | 'work_set';
  id: string;
  name: string;
  /** Taandetase hierarhias; otsingu ajal alati 0. */
  depth: number;
  /** Kollektsioonil: virtuaalne rühm. Töökollektsioonil: alati false. */
  isVirtual: boolean;
  /** Kollektsioonil: piiratud nähtavus. Töökollektsioonil: alati false. */
  restricted: boolean;
  /** Töökollektsioonil: arhiveeritud. Kollektsioonil: alati false. */
  archived: boolean;
}

export interface KoguFilter {
  tyyp: KoguTyyp;
  q: string;
}

/** URL → tüüp. Tundmatu väärtus tähendab „kõik", mitte tühja loendit. */
export function tyypFromParam(p: string | null): KoguTyyp {
  return p === 'collections' || p === 'work_sets' ? p : 'all';
}

/** Tüüp → URL. Vaikimisi „kõik" ei lähe URL-i, et link jääks puhtaks. */
export function paramFromTyyp(t: KoguTyyp): Record<string, string> {
  return t === 'all' ? {} : { type: t };
}

function kogudeRead(
  collections: Collections, lang: 'et' | 'en', flat: boolean,
): KoguRida[] {
  const nimi = (id: string) =>
    collections[id]?.name?.[lang] || collections[id]?.name?.et || id;

  const rida = (id: string, depth: number): KoguRida => ({
    kind: 'collection',
    id,
    name: nimi(id),
    depth,
    isVirtual: collections[id]?.type === 'virtual_group',
    restricted: collections[id]?.visibility === 'restricted',
    archived: false,
  });

  const koik = Object.keys(collections);
  if (flat) {
    return koik.map(id => rida(id, 0))
      .sort((a, b) => a.name.localeCompare(b.name, 'et'));
  }

  // Hierarhia: juured nime järgi, iga vanema järel tema lapsed.
  const lapsed = (parent: string | undefined) => koik
    .filter(id => (collections[id]?.parent || undefined) === parent)
    .sort((a, b) => nimi(a).localeCompare(nimi(b), 'et'));

  const out: KoguRida[] = [];
  const lisa = (id: string, depth: number) => {
    out.push(rida(id, depth));
    // Sügavuse lagi 10: katkine `parent`-ahel (kogu viitab iseendale või
    // ringi) ei tohi lehte külmutada.
    if (depth < 10) lapsed(id).forEach(alam => lisa(alam, depth + 1));
  };
  lapsed(undefined).forEach(id => lisa(id, 0));

  // Orvud (vanem on kustutatud) EI TOHI loendist kaduda — muidu ei saa neid
  // enam hallata. Need lähevad lõppu juuretasemele.
  const nahtud = new Set(out.map(r => r.id));
  koik.filter(id => !nahtud.has(id)).forEach(id => out.push(rida(id, 0)));
  return out;
}

function kogumiteRead(sets: WorkSetSummary[], lang: 'et' | 'en'): KoguRida[] {
  return sets.map(ws => ({
    kind: 'work_set' as const,
    id: ws.id,
    name: ws.name?.[lang] || ws.name?.et || ws.name?.en || ws.id,
    depth: 0,
    isVirtual: false,
    restricted: false,
    archived: ws.status === 'archived',
  })).sort((a, b) => a.name.localeCompare(b.name, 'et'));
}

export function buildKoguRows(
  collections: Collections,
  workSets: WorkSetSummary[],
  filter: KoguFilter,
  lang: 'et' | 'en',
): KoguRida[] {
  const q = normalizeForSearch(filter.q);
  const otsib = q !== '';

  const read: KoguRida[] = [];
  if (filter.tyyp !== 'work_sets') read.push(...kogudeRead(collections, lang, otsib));
  if (filter.tyyp !== 'collections') read.push(...kogumiteRead(workSets, lang));

  if (!otsib) return read;
  return read.filter(r => normalizeForSearch(r.name).includes(q)
    || normalizeForSearch(r.id).includes(q));
}
```

- [ ] **Samm 4: testid ja commit**

```bash
npx vitest run src/pages/admin/__tests__/kogudeLoend.test.ts
npm run typecheck && npm test
git add src/pages/admin/kogudeLoend.ts src/pages/admin/__tests__/kogudeLoend.test.ts
git commit -m "feat(admin): kogude ühine reaploend tüübifiltri ja otsinguga (#318)"
```

---

### Task 6: `CollectionEditor` juhitava valikuga

Hubi loend võtab üle selle, mida `CollectionEditor` praegu ise teeb — kogu
valimise. Editor jääb seadete vormiks; valik tuleb väljastpoolt.

**Failid:** Muuda: `src/components/CollectionEditor.tsx`

**Liidesed:**
- Toodab: `CollectionEditorProps` laieneb —
  `selectedId?: string` (juhitav valik), `onSelectId?: (id: string) => void`,
  `showPicker?: boolean` (vaikimisi `true`).

- [ ] **Samm 1: lisa juhitav valik**

`selectedId` on praegu sisemine `useState`. Muuda nii, et:

```tsx
interface CollectionEditorProps {
  // … olemasolevad väljad
  canEditSettings?: boolean;
  /** Juhitav valik. Kui antud, ei hoia editor oma valikut. */
  selectedId?: string;
  onSelectId?: (id: string) => void;
  /** Kas näidata editori enda kogu-valijat? Hubis valib rida. */
  showPicker?: boolean;
}
```

```tsx
  // Juhitav/juhtimata muster: ilma `selectedId` propita töötab editor edasi
  // täpselt nagu enne (oma valik, oma valija) — see hoiab olemasoleva
  // kasutuskoha muutmatuna, kuni hub on valmis.
  const [omaValik, setOmaValik] = useState<string>('');
  const juhitud = selectedId !== undefined;
  const valitud = juhitud ? selectedId : omaValik;
  const vahetaValik = (id: string) => {
    if (!juhitud) setOmaValik(id);
    onSelectId?.(id);
  };
```

Asenda kõik `selectedId` lugemised `valitud`-iga ja kõik `setSelectedId(...)`
kutsed `vahetaValik(...)`-iga. Kogu valiku plokk (2B tabeli järgi rida ~279,
kommentaariga märgitud) renderdatakse ainult siis, kui `showPicker !== false`.

**NB:** pärast kogu LOOMIST ja KUSTUTAMIST seab editor praegu valiku ise
(`setSelectedId(uusId)` / `setSelectedId('')`). Need peavad käima
`vahetaValik`-i kaudu, muidu jääb hub vana rea peale.

- [ ] **Samm 2: väravad**

Käsk: `npm run typecheck && npm test`
Oodatud: PASS. `/admin/collections` käitub endiselt samamoodi — seda lehte ei
ole veel muudetud ja uusi proppe ta ei anna.

- [ ] **Samm 3: commit**

```bash
git add src/components/CollectionEditor.tsx
git commit -m "refactor(admin): CollectionEditor toetab juhitavat kogu-valikut (#318)"
```

---

### Task 7: kollektsiooni detailvaade

**Failid:**
- Loo: `src/pages/admin/CollectionDetail.tsx`
- Muuda: `src/App.tsx`, `src/locales/{et,en}/admin.json`

**Liidesed:**
- Tarbib: `CollectionEditor` (Task 6, `selectedId` + `showPicker={false}`),
  `CollectionAccessPanel` (olemasolev), `useCollection`, `useUser`.
- Toodab: marsruut `/admin/collections/:id`.

- [ ] **Samm 1: i18n MÕLEMASSE keelde**

`admin.json` → `collections` objekti sisse:

```json
"hub": {
  "title": "Kogud",
  "typeAll": "Kõik",
  "typeCollections": "Kollektsioonid",
  "typeWorkSets": "Töökollektsioonid",
  "searchPlaceholder": "Otsi kogu nime järgi",
  "noMatches": "Ükski kogu ei vasta otsingule",
  "badgeCollection": "Kollektsioon",
  "badgeWorkSet": "Töökollektsioon",
  "badgeVirtual": "Rühm",
  "badgeRestricted": "Piiratud",
  "badgeArchived": "Arhiveeritud",
  "empty": "Kogusid ei ole",
  "notFound": "Kollektsiooni ei leitud",
  "tabWorks": "Teosed",
  "tabAccess": "Ligipääs",
  "tabSettings": "Seaded",
  "worksLink": "Ava selle kogu teosed otsingus",
  "settingsSuperadminOnly": "Kogu seadeid muudab superadmin."
}
```

Inglise pool sama võtmestikuga (`"title": "Collections"`, `"tabWorks": "Works"`,
`"worksLink": "Open this collection's works in search"` jne).

- [ ] **Samm 2: kirjuta `CollectionDetail.tsx`**

```tsx
/**
 * Kollektsiooni detailvaade (#318, spekk §4).
 *
 * Kolm plokki rollide järgi: „Teosed" (LINK otsingusse — teoste kuuluvus elab
 * `_metadata.json`-is ja otsingus, ADR 0007, siia uut lugemisteed ei tehta),
 * „Ligipääs" (admin+, olemasolev `CollectionAccessPanel`) ja „Seaded"
 * (superadmin, olemasolev `CollectionEditor` ilma oma valijata).
 *
 * Peitmine ei ole autoriseerimine: server hoiab seadete endpointidel
 * `require_role("superadmin")`-i.
 */
```

Nõuded:

- Marsruudi parameeter `:id`; kogu andmed `useCollection()`-i `collections`
  kaardist. Tundmatu ID → `collections.hub.notFound` + tagasilink hubisse.
  **Aga:** kui `isLoading` on `true`, näita spinnerit — laadimata kontekst ei
  tähenda „kollektsiooni ei ole".
- Päis: kogu nimi (keele järgi), tüübisildid (`badgeVirtual`, `badgeRestricted`)
  ja tagasilink `/admin/collections`.
- Tabid `?tab=works|access|settings` URL-is (vaikimisi `access` adminile,
  `works` mitte-adminile). Tabi vahetus on ainus URL-i kirjutaja selles vaates
  (ADR 0038: teist peeglit ei ehitata).
- **Teosed:** `<Link to={'/search?collection=' + encodeURIComponent(id)}>`
  tekstiga `collections.hub.worksLink`. Parameeter on **`collection`
  ainsuses ja paljas id** (mitte `c:<id>`, mitte `collections`) — seda loeb
  `useCollectionUrlSync` → `decideCollectionSync` (ADR 0038). Uut otsingu-URL-i
  lepingut EI leiutata.
  NB: see link MUUDAB aktiivset kogu — see on otsingulehe enda leping
  (omaksvõtt URL-ist), mitte admin-filter. Kaks asja ei ole vastuolus:
  keelatud on admin-lehel oma vastassuunalise peegli ehitamine, mitte
  otsingusse navigeerimine.
- **Ligipääs** (`isAtLeast(user.role, 'admin')`): olemasolev
  `<CollectionAccessPanel collectionId={id} users={…} usersKnown={…} actor={…} />`.
  Kasutajate loend tuleb `POST /admin/users` kaudu nagu `WorkSets.tsx`-is;
  **tühi loend ja laadimata loend on eri asjad** — `usersKnown` lipp on
  kohustuslik (1b õppetund).
- **Seaded** (`isAtLeast(user.role, 'superadmin')`):
  `<CollectionEditor canEditSettings selectedId={id} showPicker={false} />`.
  Adminile näita tabi asemel selgitust `collections.hub.settingsSuperadminOnly`.
- Marsruut `src/App.tsx`-i olemasoleva laisa laadimise mustriga:

```tsx
const AdminCollectionDetail = lazyRetry(() => import('./pages/admin/CollectionDetail'));
```

```tsx
  {
    path: "/admin/collections/:id",
    element: <Lazy><AdminCollectionDetail /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
```

- [ ] **Samm 3: väravad ja commit**

```bash
npm run typecheck && npm test
git add src/pages/admin/CollectionDetail.tsx src/App.tsx src/locales/et/admin.json src/locales/en/admin.json
git commit -m "feat(admin): kollektsiooni detailvaade kolme plokiga (#318)"
```

---

### Task 8: hub, deep-link ja üks admin-kaart

**Failid:**
- Loo: `src/pages/admin/CollectionsHub.tsx`
- Kustuta: `src/pages/admin/Collections.tsx`
- Muuda: `src/App.tsx`, `src/pages/admin/WorkSets.tsx`, `src/pages/Admin.tsx`,
  `src/locales/{et,en}/admin.json`

- [ ] **Samm 1: kirjuta `CollectionsHub.tsx`**

```tsx
/**
 * Kogude ühine sisenemiskoht (#318, spekk §4).
 *
 * Üks loend, kaks mudelit: kollektsioonid hierarhias ja töökollektsioonid
 * lamedalt, tüüp igal real nähtav. Andmemudeleid ei liideta — read tulevad
 * puhtast moodulist `kogudeLoend.ts` ja rida viib olemasoleva halduse juurde.
 *
 * Tüübifilter ja otsing elavad AINULT URL-is (`?type=&q=`) ega puutu
 * `CollectionContext`-i: need on haldusfiltrid, mitte koguvalik (ADR 0038).
 */
```

Nõuded:

- Marsruut `/admin/collections` (asendab senise `Collections.tsx` lehe).
- **Ligipääs:** sisse logitud kasutaja. Kollektsioonide pool nõuab admin+
  (`isAtLeast(user.role, 'admin')`); ilma selleta jäetakse tüübifiltrist
  „Kollektsioonid" välja ja loendisse lähevad ainult töökollektsioonid.
  Nii jõuab töökollektsiooni HALDUR (editor/contributor) siia ilma üldise
  kasutajahalduseta, nagu spekk §4 nõuab.
- Andmed: `useCollection()` (`collections`) ja `listWorkSets(true)`.
  **Uut päringut liikmete kohta EI tehta** (ADR 0042).
- Filtririba: tüübi `<select>` (`hub.typeAll` / `typeCollections` /
  `typeWorkSets`) ja otsinguväli (`hub.searchPlaceholder`, `autoFocus`).
  Mõlemad kirjutavad URL-i ühe funktsiooni kaudu
  (`setSearchParams({ ...paramFromTyyp(t), ...(q ? { q } : {}) }, { replace: true })`).
  Paralleelset `useState`-koopiat EI hoita.
- Read: `buildKoguRows(collections, workSets, { tyyp, q }, lang)`.
  Iga rida: taane `depth * 1rem`, nimi, tüübisilt (`badgeCollection` /
  `badgeWorkSet`) ja asjakohased lisasildid (`badgeVirtual`, `badgeRestricted`,
  `badgeArchived`). Sihtkoht:
  - `kind === 'collection'` → `/admin/collections/{id}`
  - `kind === 'work_set'` → `/admin/work-sets?set={id}`
- Tühjad olekud: loend tühi → `hub.empty`; otsing ei anna vastet →
  `hub.noMatches` + „Tühjenda filtrid".
- Mobiil (~400 px): sildid `flex-wrap`, ilma horisontaalse kerimiseta.

- [ ] **Samm 2: marsruut ja vana leht**

`src/App.tsx`: `AdminCollections` osutab nüüd hubile
(`import('./pages/admin/CollectionsHub')`); `git rm src/pages/admin/Collections.tsx`.
Vana URL `/admin/collections` toimib edasi — ta ongi hub.

- [ ] **Samm 3: `?set=` deep-link `WorkSets.tsx`-is**

Loe `useSearchParams()`-ist `set` ja ava mount'il selle kogu paneelid
(olemasolev `accessOpenId` / `openId` olek). Nõuded:

- Ainult ESIMESEL renderdusel (või `set` väärtuse muutumisel), mitte igal
  renderdusel — muidu ei saa kasutaja paneeli sulgeda.
- Tundmatu `set` ei tohi anda viga ega tühja lehte: loend renderdub tavaliselt.
- URL-i tagasi EI kirjutata, kui kasutaja paneeli käsitsi avab/sulgeb — see
  oleks teine peegel (ADR 0038). `?set=` on ühesuunaline sisenemispunkt.

- [ ] **Samm 4: üks admin-kaart kahe asemel**

`src/pages/Admin.tsx`: `collections` ja `workSets` kaardid asendab üks kaart
võtmega `collections` (`href: '/admin/collections'`, grupp
`admin:groups.content`), sildiks `admin:cards.collections` = „Kogud" /
„Collections". Vana `admin:cards.workSets` võti eemalda MÕLEMAST keelest, kui
teda enam kusagil ei kasutata (`grep -rn "cards.workSets" src/`).
`/admin/work-sets` marsruut JÄÄB alles (deep-link ja vanad järjehoidjad).

- [ ] **Samm 5: väravad ja commit**

```bash
npm run typecheck && npm test && npm run lint:ci
git add -A src/pages src/App.tsx src/locales
git commit -m "feat(admin): kogude ühine sisenemiskoht tüübifiltriga (#318)"
```

---

### Task 9: 4b väravad ja PR

- [ ] **Samm 1: väravad**

```bash
npm run typecheck && npm test && npm run lint:ci && npm run build && .venv/bin/pytest tests/ -q
```

- [ ] **Samm 2: PR**

```bash
git push -u origin feat/kogude-uhine-sisenemiskoht-4b
gh pr create --base main --title "Kogude ühine sisenemiskoht (#318, etapp 4b)" --body "$(cat <<'BODY'
Spekk §4. `/admin/collections` on nüüd ühine „Kogud" loend: tüübifilter (kõik / kollektsioonid / töökollektsioonid), nimeotsing, tüüp igal real nähtav. Andmemudeleid ei liidetud — ühine on ainult reaploend (`kogudeLoend.ts`, vitestiga kaetud).

- Kollektsiooni rida → `/admin/collections/:id` kolme plokiga: Teosed (link otsingusse, uut lugemisteed ei tehtud — ADR 0007), Ligipääs (admin+), Seaded (superadmin).
- Töökollektsiooni rida → `/admin/work-sets?set=<id>`; vana URL toimib edasi.
- `CollectionEditor` toetab juhitavat valikut; hubis valib rida.
- Admin-lehel on kahe kaardi asemel üks „Kogud".

Filtrid elavad ainult URL-is (`?type=&q=`) ega muuda aktiivset kogu (ADR 0038).

**Tootmises kontrollida** (et+en): tüübifilter ja otsing; hierarhia taane; töökollektsiooni haldur (editor/contributor) näeb hubis ainult töökollektsioone; admin ei näe Seaded-plokki; superadmin näeb; vanad URL-id `/admin/collections` ja `/admin/work-sets`; ~400 px laius.
BODY
)"
```

---

# Osa 4c — kaks lahtist pisiasja ja ADR-i lõpetamine

### Task 10: TEHTUD eraldi PR-is

**See task on juba teostatud** (PR #368, arutelu kasutajaga 2026-09-14) ja
lahendus on plaanitust TUGEVAM — ära tee seda uuesti.

Plaan pakkus `basisLabelVisible`-i: sildi peitmine seal, kus ta midagi ei ütle.
Kasutaja tähelepanek oli, et probleem ei ole sildis, vaid LÜLITIS: hall
märkeruut, mida ei saa lülitada, tekitab segadust ka ilma sildita. Reegel on
nüüd „lüliti ainult seal, kus lülitamine muudab tegelikku ligipääsu" ja seda
otsustab `rightsControl` (`collectionRightsDraft.ts`, vitestiga kaetud):

```
!canManage            → checked ? 'fact'    : 'hidden'
basis === 'assigned'  → (checked || canAdd) ? 'toggle' : 'hidden'
role_based | inert    → checked ? 'remnant' : 'hidden'
```

Kasutusel mõlemas vaates (`CollectionAccessPanel`, `UserDetail`); lülitite
sildid ütlevad tegevust („Näeb teoseid" / „Tohib teoseid muuta").

### Task 11: sessiooni aegumine ei paista andmekaona

Backend hoiab sessioone mälus, seega iga juurutus logib kõik välja. Praegu
näeb väljalogitud kasutaja „Ligipääsu laadimine ebaõnnestus" (401 paneelis) ja
„Töökollektsioone ei ole" (anonüümne `GET /work-sets` annab ainult avalikud) —
mõlemad loevad nagu andmekadu.

**Failid:**
- Loo: `src/utils/apiErrorText.ts`, `src/utils/__tests__/apiErrorText.test.ts`
- Muuda: `src/components/CollectionAccessPanel.tsx`,
  `src/pages/admin/WorkSetAccessPanel.tsx`, `src/components/CollectionPicker.tsx`,
  `src/locales/{et,en}/common.json`

- [ ] **Samm 1: kirjuta kukkuv test**

```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../services/apiClient';
import { isSessionExpired } from '../apiErrorText';

describe('isSessionExpired', () => {
  it('401 tähendab surnud sessiooni', () => {
    expect(isSessionExpired(new ApiError('Autentimine nõutud', 401))).toBe(true);
  });

  it('muu staatus ei ole sessiooni aegumine', () => {
    expect(isSessionExpired(new ApiError('Keelatud', 403))).toBe(false);
    expect(isSessionExpired(new ApiError('Serveri viga', 500))).toBe(false);
  });

  it('võrguviga ilma staatuseta ei ole sessiooni aegumine', () => {
    // Võrgukatkestus ja väljalogimine vajavad ERI vastust: esimesel tasub
    // uuesti proovida, teisel uuesti sisse logida.
    expect(isSessionExpired(new Error('Failed to fetch'))).toBe(false);
    expect(isSessionExpired(null)).toBe(false);
  });
});
```

- [ ] **Samm 2: käivita, veendu et kukub**

Käsk: `npx vitest run src/utils/__tests__/apiErrorText.test.ts`
Oodatud: FAIL — `Failed to resolve import "../apiErrorText"`.

- [ ] **Samm 3: teostus**

`src/utils/apiErrorText.ts`:

```ts
/**
 * Sessiooni aegumise eristamine muust veast (#318).
 *
 * Backend hoiab sessioone MÄLUS, seega iga juurutus logib kõik välja. Ilma
 * eristuseta näeb väljalogitud kasutaja oma valdkonna veateadet („ligipääsu
 * laadimine ebaõnnestus", „töökollektsioone ei ole") ja otsib viga andmetest,
 * mitte sessioonist. `apiClient` teatab 401-st juba `sessionExpiredHandler`-iga;
 * siin on sama fakt VAATE jaoks.
 */
export function isSessionExpired(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && (e as { status?: number }).status === 401);
}
```

`common.json` MÕLEMASSE keelde:

```json
"errors": { "sessionExpired": "Sessioon on aegunud — logi uuesti sisse. Andmed on alles." }
```

(inglise: `"Your session has expired — please log in again. Your data is intact."`)

Kasutuskohad:

- `CollectionAccessPanel.tsx` ja `WorkSetAccessPanel.tsx`: `catch (e)` harudes
  (nii laadimisel kui salvestamisel) `setViga(isSessionExpired(e)
  ? t('common:errors.sessionExpired') : t('…loadFailed'))`.
  **Laadimisviga jääb endiselt tühjaks mustandiks muutmata** — muutub ainult
  TEKST, mitte olek.
- `CollectionPicker.tsx` (rida ~345): kui `workSetsError` on seatud, näita
  selle asemel, et „Töökollektsioone ei ole", kas
  `common:errors.sessionExpired` (kui `isSessionExpired(workSetsError)`) või
  olemasolevat üldist veateadet. Tühi loend ilma veata tähendab endiselt
  „ei ole ühtki kogu".
  `workSetsError` tuleb `useCollection()`-ist ja on juba olemas — uut olekut
  ei lisata.

- [ ] **Samm 4: testid ja commit**

```bash
npx vitest run src/utils/__tests__/apiErrorText.test.ts
npm run typecheck && npm test
git add src/utils/apiErrorText.ts src/utils/__tests__/apiErrorText.test.ts src/components/CollectionAccessPanel.tsx src/pages/admin/WorkSetAccessPanel.tsx src/components/CollectionPicker.tsx src/locales/et/common.json src/locales/en/common.json
git commit -m "fix: sessiooni aegumine ei paista andmekaona (#318)"
```

---

### Task 12: ADR-i lõpetamine, väravad ja PR

- [ ] **Samm 1: eemalda ADR 0043 üleminekumärkus**

`docs/decisions/0043-kogude-oiguste-uhised-toimingud.md`:
- Staatusrida: `**Staatus:** kehtib (teostatud 2026-09-14, #318)`.
- „Tagajärjed" all olev üleminekumärkus („Veel lahtised: etapp 4 … Kuni etapp 4
  pole tehtud …") **eemaldatakse tervikuna** — ADR ise ütleb, et seda tehakse
  teostuse lõpus. Asemele üks lause: kõik neli etappi on tootmises.

`docs/decisions/README.md`: rea 0043 staatuseks `kehtib`.

- [ ] **Samm 2: väravad**

```bash
npm run typecheck && npm test && npm run lint:ci && npm run build && .venv/bin/pytest tests/ -q
```

- [ ] **Samm 3: PR**

```bash
git push -u origin feat/oiguste-vaate-koristus-4c
gh pr create --base main --title "Õiguste vaate koristus ja ADR 0043 lõpetamine (#318, etapp 4c)" --body "$(cat <<'BODY'
Kaks lahtist pisiasja #318-st ja ADR 0043 üleminekumärkuse eemaldamine.

1. **„Rollist tulenev" silt** kandis kahte eri olukorda. Nüüd otsustab üks funktsioon (`basisLabelVisible`, vitestiga kaetud): märkimata kastike editoril/adminil on müra ja peidetakse; märgitud kastike on inertne salvestatud jäänuk ja jääb nähtavaks koos koristusteega (ADR 0043 nõue). Sama funktsiooni kasutavad nüüd mõlemad vaated — reegel elab ühes kohas.
2. **Sessiooni aegumine** ei paista enam andmekaona: 401 saab oma teate („sessioon on aegunud, andmed on alles") nii ligipääsupaneelides kui koguvalijas. Laadimisvea OLEK ei muutu — muutub tekst.
3. ADR 0043 staatus „kehtib"; üleminekumärkus eemaldatud, sest etapid 1a–4 on tootmises.

**Tootmises kontrollida** (et+en): editor ilma salvestatud ulatuseta ei näita enam „rollist tulenev" silti; editor salvestatud ulatusega näitab ja eemaldamine töötab; pärast backendi juurutust (sessioonid surnud) näitab koguvalija ja ligipääsupaneel sessiooniteadet, mitte „töökollektsioone ei ole".
BODY
)"
```

---

## Teadlikult väljas

- **Teoste loend kollektsiooni detailis** — kuuluvus elab `_metadata.json`-is
  ja otsingus (ADR 0007). Detailis on link otsingusse; uut lugemisteed ega
  read-modelit ei ehitata.
- **Pagineerimine** kogude loendis — kogusid on kümneid, mitte tuhandeid.
- **Kollektsioonide struktuuri sisuline ümberkorraldus** (#319) — see on
  andmetöö, mitte vaate töö.
- **Töökollektsiooni paneelide väljatõstmine `WorkSets.tsx`-ist** eraldi
  detailimarsruudiks. Hub viib `?set=` deep-lingiga olemasolevasse vaatesse;
  teine ümbertõstmine samas PR-is teeks ülevaatuse võimatuks.
- **Halduri lugemisvaate kuvanimed** (halduril ei ole kasutajaloendit, seega
  näeb ta kasutajanimesid) — vajab uut serveri-lepingut, vt #318 märkus.
