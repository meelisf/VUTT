# Code Review Fixes — Implementatsiooniplaani

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lahendada 2026-03-25 koodibaasi review leitud probleemid prioriteedi järjekorras — kriitilisest vähetähtsani.

**Architecture:** Muudatused on suuresti sõltumatud üksteisest. Erandiks Task 7 (ErrorBanner komponent), mille tulemus kasutatakse Task 8-s (alert() asendamine). Kõik muud taskid saab täita mis tahes järjekorras.

**Tech Stack:** React 19 + TypeScript + Vite (frontend), FastAPI + Python 3.12 (backend), i18next (tõlked), react-i18next `useTranslation`. Verificeerimine: `npm run build` (TypeScript kompileerimine).

**Review source:** `docs/code_review_2026-03-25.md`

---

## Task 1: Triviaalsed 1-reajad backend-is (K2, O1, E4)

Kolm täiesti sõltumatut mikrofixti Python backend-is. Iga fix on 1–3 rida.

**Files:**
- Modify: `server/main.py`

### Fix K2 — `asyncio.get_event_loop()` → `get_running_loop()`

- [ ] **Loe fail ja leia rida 836**

  ```bash
  grep -n "get_event_loop" server/main.py
  ```
  Eeldatav väljund: üks rida number ~836

- [ ] **Asenda**

  ```python
  # Praegu:
  loop = asyncio.get_event_loop()
  # Peale:
  loop = asyncio.get_running_loop()
  ```

### Fix O1 — Lisa kommentaar `/verify-token` erandile

- [ ] **Leia rida**

  ```bash
  grep -n "verify-token\|data.get.*token" server/main.py | head -10
  ```

- [ ] **Lisa kommentaar** endpointi algusesse (rida ~119):

  ```python
  # NB: See endpoint kasutab tahtlikult POST body tokenit, mitte Bearer päist.
  # Põhjus: endpoint verifitseerib tokenit iseennast — get_user() dependency
  # nõuaks kehtivat tokenit, mida me just kontrollima hakkame.
  ```

### Fix E4 — Eemalda ripuv `ocr_requested` kommentaar

- [ ] **Leia rida**

  ```bash
  grep -n "ocr_requested" server/main.py
  ```

- [ ] **Kustuta kommentaarrida** (rida ~449):

  ```python
  # ocr_requested = form.get('ocr_requested', 'false').lower() == 'true'  # tulevikuks
  ```
  See rida eemaldatakse täielikult — funktsionaalsust pole, vaid segadus.

- [ ] **Commit**

  ```bash
  git add server/main.py
  git commit -m "fix: asyncio.get_running_loop(), verify-token kommentaar, ripuv kommentaar"
  ```

---

## Task 2: Lisa O5 — HistoryTab hardcoded string tõlgete süsteemi

`HistoryTab.tsx` real 284 on hardcoded eesti string, mis ei kasuta i18n süsteemi.

**Files:**
- Modify: `src/components/editor/HistoryTab.tsx`
- Modify: `src/locales/et/workspace.json`
- Modify: `src/locales/en/workspace.json`

- [ ] **Leia täpne rida**

  ```bash
  grep -n "Ainult tehnilised" src/components/editor/HistoryTab.tsx
  ```

- [ ] **Lisa tõlkevõtmed** — `src/locales/et/workspace.json` `history` plokki:

  ```json
  "onlyTimestampChanges": "Ainult tehnilised muudatused (ajatempleid uuendatud)"
  ```

- [ ] **Lisa tõlkevõtmed** — `src/locales/en/workspace.json` `history` plokki:

  ```json
  "onlyTimestampChanges": "Only technical changes (timestamps updated)"
  ```

- [ ] **Asenda string komponentis** (`src/components/editor/HistoryTab.tsx:284`):

  ```tsx
  // Praegu:
  Ainult tehnilised muudatused (ajatempleid uuendatud)

  // Peale (kasuta t() — hook on komponendis juba olemas):
  {t('history.onlyTimestampChanges')}
  ```

- [ ] **Verifitseeri**

  ```bash
  npm run build
  ```
  Ei tohi olla TypeScript vigu.

- [ ] **Commit**

  ```bash
  git add src/components/editor/HistoryTab.tsx src/locales/et/workspace.json src/locales/en/workspace.json
  git commit -m "fix: tõlgi HistoryTab hardcoded string i18n-i (O5)"
  ```

---

## Task 3: Kustuta O3 — `getWorkFullText` surnud kood

`searchService.ts` read 764–794 sisaldavad eksporteeritud funktsiooni, mida pole kusagil kasutatud.

**Files:**
- Modify: `src/services/searchService.ts`

- [ ] **Verifitseeri et funktsioon tõepoolest kasutamata**

  ```bash
  grep -rn "getWorkFullText" src/
  ```
  Eeldatav väljund: ainult `searchService.ts` ise (definitsioon), mitte impordid mujal.

- [ ] **Kustuta read 764–794** (funktsioon `getWorkFullText` koos kommentaariga)

- [ ] **Verifitseeri**

  ```bash
  npm run build
  ```
  Ei tohi olla TypeScript vigu.

- [ ] **Commit**

  ```bash
  git add src/services/searchService.ts
  git commit -m "chore: eemalda kasutamata getWorkFullText (O3)"
  ```

---

## Task 4: Paranda K3 — `localStorage.getItem('vutt_token')` → `useUser()`

Viis komponenti loevad tokenit otse localStorage-ist, möödudes `UserContext`-ist. `UserContext` ekspordib `authToken` — see on õige viis.

**Files:**
- Modify: `src/hooks/useMetadataSuggestions.ts`
- Modify: `src/components/BulkTagsPicker.tsx`
- Modify: `src/components/CollectionEditor.tsx`
- Modify: `src/pages/Dashboard.tsx`

**Muster igas failis:**

```tsx
// Praegu (vale):
const token = localStorage.getItem('vutt_token');

// Peale (õige):
const { authToken } = useUser();
// ... seejärel kasuta `authToken` igas kohas kus kasutati `token`
```

`useUser` hook on kättesaadav importiga:
```tsx
import { useUser } from '../contexts/UserContext';
// (kohandada tee vastavalt faili asukohale)
```

- [ ] **Uuri `useMetadataSuggestions.ts`**

  ```bash
  grep -n "localStorage\|vutt_token\|useUser" src/hooks/useMetadataSuggestions.ts
  ```
  Loe ümbritsev kontekst (~10 rida) et mõista kasutust.

- [ ] **Paranda `useMetadataSuggestions.ts`** — asenda `localStorage.getItem` → `useUser().authToken`

  NB: kui hook saab `authToken` props-ina või parameetrina, on see parem variant kui `useUser()` otse hookis — vaata kuidas seda kutsutakse.

- [ ] **Uuri `BulkTagsPicker.tsx`**

  ```bash
  grep -n "localStorage\|vutt_token\|useUser" src/components/BulkTagsPicker.tsx
  ```

- [ ] **Paranda `BulkTagsPicker.tsx`** (rida ~183)

- [ ] **Uuri `CollectionEditor.tsx`**

  ```bash
  grep -n "localStorage\|vutt_token\|useUser" src/components/CollectionEditor.tsx
  ```

- [ ] **Paranda `CollectionEditor.tsx`** (rida ~118)

- [ ] **Uuri `Dashboard.tsx` kolm kohta**

  ```bash
  grep -n "localStorage\|vutt_token" src/pages/Dashboard.tsx
  ```

- [ ] **Paranda `Dashboard.tsx`** (read ~408, 446, 481) — Dashboard kasutab tõenäoliselt `useUser()` juba, kontrolli importi.

- [ ] **Verifitseeri**

  ```bash
  npm run build
  ```

- [ ] **Commit**

  ```bash
  git add src/hooks/useMetadataSuggestions.ts src/components/BulkTagsPicker.tsx src/components/CollectionEditor.tsx src/pages/Dashboard.tsx
  git commit -m "fix: asenda localStorage token → useUser() authToken kõigis komponentides (K3)"
  ```

---

## Task 5: Paranda O2 — bare `except:` → `except Exception:` backend-is

16 bare `except:` klauslit 7 Python failis. Bare `except` püüab ka `SystemExit` ja `KeyboardInterrupt`, mis raskendab serveri puhast sulgemist.

**Files:**
- Modify: `server/git_ops.py`
- Modify: `server/meilisearch_ops.py`
- Modify: `server/utils.py`
- Modify: `server/people_ops.py`
- Modify: `server/metadata_handler.py`
- Modify: `server/cache.py`
- Modify: `server/main.py`

- [ ] **Leia kõik asukohad**

  ```bash
  grep -n "^\s*except:\s*$" server/git_ops.py server/meilisearch_ops.py server/utils.py server/people_ops.py server/metadata_handler.py server/cache.py server/main.py
  ```
  Peaks leidma ~16 rida.

- [ ] **Asenda igas failis** — loe iga faili, veendu kontekstis, asenda `except:` → `except Exception:`.

  Kõige mugavam viis per-faili:
  ```bash
  # Näide git_ops.py jaoks:
  sed -n '278,282p' server/git_ops.py  # vaata konteksti
  ```
  Siis kasuta Edit tööriista täpseks asendamiseks (mitte blind replace-all, sest taandus võib erineda).

- [ ] **Verifitseeri et muud `except` klauslid on puutumata**

  ```bash
  grep -n "except" server/git_ops.py server/meilisearch_ops.py | grep -v "except Exception\|except.*Error\|except.*Warning\|#"
  ```
  Peaks tagastama tühja (bare `except:` pole enam).

- [ ] **Commit**

  ```bash
  git add server/git_ops.py server/meilisearch_ops.py server/utils.py server/people_ops.py server/metadata_handler.py server/cache.py server/main.py
  git commit -m "fix: asenda bare except: → except Exception: kõigis backend failides (O2)"
  ```

---

## Task 6: Paranda O7 — `print()` → `logger` backend-is

~35 `print()` kõnet nelja põhifailis ei jõua `logs/vutt.log` faili — ainult Docker stdout-i. `config.py` `get_logger()` on olemas ja valmis kasutamiseks.

**Files:**
- Modify: `server/people_ops.py`
- Modify: `server/meilisearch_ops.py`
- Modify: `server/registration.py`
- Modify: `server/utils.py`

**Muster igas failis:**

```python
# NB: Kontrolli õiget import-teed enne kasutamist:
#   grep -n "get_logger" server/git_ops.py | head -2
# Kasuta täpselt sama importi mis git_ops.py-s töötab.
# Tüüpiliselt: from config import get_logger (Docker/skript kontekstis)

from config import get_logger  # kohandada vastavalt git_ops.py mustril
logger = get_logger(__name__)

# Asenda:
print("Mingi info")          →  logger.info("Mingi info")
print(f"Viga: {e}")          →  logger.error(f"Viga: {e}")
print("Hoiatus", ...)        →  logger.warning("Hoiatus ...")
```

- [ ] **Leia kõik print-id `people_ops.py`-s**

  ```bash
  grep -n "^    print\|^print" server/people_ops.py
  ```
  Asenda kõik ~12 print-i. Info-tüüpi sõnumid → `logger.info`, veateated → `logger.error`.

- [ ] **Leia kõik print-id `meilisearch_ops.py`-s**

  ```bash
  grep -n "print(" server/meilisearch_ops.py
  ```
  Asenda kõik ~15 print-i.

- [ ] **Leia kõik print-id `registration.py`-s**

  ```bash
  grep -n "print(" server/registration.py
  ```

- [ ] **Leia kõik print-id `utils.py`-s**

  ```bash
  grep -n "print(" server/utils.py
  ```

- [ ] **Verifitseeri et import on olemas igas failis**

  ```bash
  grep -n "get_logger\|from.*config" server/people_ops.py server/meilisearch_ops.py server/registration.py server/utils.py
  ```

- [ ] **Commit**

  ```bash
  git add server/people_ops.py server/meilisearch_ops.py server/registration.py server/utils.py
  git commit -m "fix: asenda print() → logger igas backend failis (O7)"
  ```

---

## Task 7: Paranda E2 — `aria-label` tõlkimine kolmes komponendis

Kolm komponenti kasutavad hardcoded `aria-label="Tühjenda otsing"` — ingliskeelne kasutaja saab eestikeelse labeli.

**Files:**
- Modify: `src/locales/et/common.json`
- Modify: `src/locales/en/common.json`
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/SearchPage.tsx`
- Modify: `src/prosopography/pages/PersonsPage.tsx`

- [ ] **Vaata `common.json` olemasolevat `form` sektsiooni**

  ```bash
  grep -n "form\|clear\|search" src/locales/et/common.json
  ```
  Vaata kas sobiv võti juba eksisteerib (nt `buttons.clear` on olemas).

- [ ] **Lisa tõlkevõti** `src/locales/et/common.json` — `form` sektsiooni. Kui `form` sektsiooni pole, loo see:

  ```json
  "form": {
    "clearSearch": "Tühjenda otsing"
  }
  ```
  Kui `form` juba eksisteerib, lisa ainult `clearSearch` võti selle sisse.

- [ ] **Lisa tõlkevõti** `src/locales/en/common.json`:

  ```json
  "clearSearch": "Clear search"
  ```

- [ ] **Asenda `Dashboard.tsx:550`** — leia ja asenda:

  ```tsx
  // Praegu:
  aria-label="Tühjenda otsing"
  // Peale (eeldab et `t` on `useTranslation(['common'])` kaudu saadaval):
  aria-label={t('common:form.clearSearch')}
  ```

  Vaata enne millist namespace'i Dashboard kasutab:
  ```bash
  grep -n "useTranslation" src/pages/Dashboard.tsx | head -3
  ```

- [ ] **Asenda `SearchPage.tsx:103`** — sama muster

- [ ] **Asenda `PersonsPage.tsx:242`** — sama muster

- [ ] **Verifitseeri**

  ```bash
  npm run build
  ```

- [ ] **Commit**

  ```bash
  git add src/locales/et/common.json src/locales/en/common.json src/pages/Dashboard.tsx src/pages/SearchPage.tsx src/prosopography/pages/PersonsPage.tsx
  git commit -m "fix: tõlgi aria-label Tühjenda otsing kõigis komponentides (E2)"
  ```

---

## Task 8: Paranda O4 — `availableWorks` deduplikatsioon SearchPage-is

`SearchPage.tsx` arvutab `uniqueWorkIds` Set-i, kuid ei kasuta seda `availableWorks` massiivi filtreerimisel — sama teos võib esineda mitu korda.

**Files:**
- Modify: `src/pages/SearchPage.tsx` (rida ~63–71)

- [ ] **Loe hetkel olemasolev kood**

  Read 59–75:
  ```tsx
  const workHitCounts = results?.facetDistribution?.['work_id'] || {};
  const uniqueWorkIds = new Set(results?.hits?.map(h => h.work_id) || []);
  const availableWorks = (results?.hits && !urlParams.workId && !loading && uniqueWorkIds.size > 1)
      ? results.hits.map(hit => ({
          id: hit.work_id,
          title: hit.title || hit.work_id,
          ...
      }))
      : [];
  ```

- [ ] **Asenda** `results.hits.map(...)` nii et iga `work_id` esineb ainult üks kord:

  ```tsx
  const workHitCounts = results?.facetDistribution?.['work_id'] || {};
  const uniqueWorkIds = new Set(results?.hits?.map(h => h.work_id) || []);
  const seenWorkIds = new Set<string>();
  const availableWorks = (results?.hits && !urlParams.workId && !loading && uniqueWorkIds.size > 1)
      ? results.hits.reduce<Array<{id: string; title: string; year?: number; author?: string; count: number}>>((acc, hit) => {
          if (!seenWorkIds.has(hit.work_id)) {
              seenWorkIds.add(hit.work_id);
              acc.push({
                  id: hit.work_id,
                  title: hit.title || hit.work_id,
                  year: typeof hit.year === 'number' ? hit.year : undefined,
                  author: (() => { const a = (hit as any).autor; return Array.isArray(a) ? a[0] : a; })(),
                  count: workHitCounts[hit.work_id] || 1
              });
          }
          return acc;
      }, [])
      : [];
  ```

  NB: `seenWorkIds` peab olema deklareeritud `availableWorks` definitsioonist väljaspool (või useMemo sees) — vaata kus täpselt `availableWorks` on defineeritud (otse komponendis või hookis).

- [ ] **Verifitseeri**

  ```bash
  npm run build
  ```

- [ ] **Commit**

  ```bash
  git add src/pages/SearchPage.tsx
  git commit -m "fix: deduplitseeri availableWorks work_id järgi SearchPage-is (O4)"
  ```

---

## Task 9: Loo ErrorBanner komponent (K1 eeltöö)

Enne `alert()` asendamist (Task 10) on vaja luua sobiv vea kuvamise komponent. Projekt kasutab juba `ConfirmModal` — loome `ErrorBanner` inline-kuvamiseks (ei blokeeri UI-d).

**Files:**
- Create: `src/components/ErrorBanner.tsx`

- [ ] **Vaata `ConfirmModal.tsx` mustrit**

  ```bash
  cat src/components/ConfirmModal.tsx | head -50
  ```

- [ ] **Loo `src/components/ErrorBanner.tsx`:**

  ```tsx
  import React from 'react';
  import { AlertCircle, X } from 'lucide-react';

  interface ErrorBannerProps {
    message: string;
    onClose?: () => void;
    className?: string;
  }

  /**
   * Inline veabänner — asendab alert() kõnesid.
   * Ei blokeeri UI-d, toetab sulgemist.
   */
  export const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onClose, className = '' }) => (
    <div className={`flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 ${className}`}>
      <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
      <span className="flex-1">{message}</span>
      {onClose && (
        <button
          onClick={onClose}
          className="text-red-400 hover:text-red-600 flex-shrink-0"
          aria-label="Sulge"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
  ```

- [ ] **Verifitseeri**

  ```bash
  npm run build
  ```

- [ ] **Commit**

  ```bash
  git add src/components/ErrorBanner.tsx
  git commit -m "feat: lisa ErrorBanner komponent (K1 eeltöö)"
  ```

---

## Task 10: Asenda K1 — `alert()` → `ErrorBanner` / inline vead

Neli faili kasutavad `alert()` save-vigade jaoks. Asendame `ErrorBanner`-iga (Task 9 komponent) või olemasoleva veastate kuvamisega.

**Files:**
- Modify: `src/services/pageService.ts`
- Modify: `src/components/TextEditor.tsx`
- Modify: `src/components/MetadataModal.tsx`
- Modify: `src/pages/Workspace.tsx`

**Strateegia per faili:**
- `pageService.ts:68` — teenuse funktsioon ei peaks UI-d kuvama; viska `Error` objekti ja lase kutsujal kuvada
- `TextEditor.tsx` — kasuta `ErrorBanner` lokaalse state-iga (`saveError` string)
- `MetadataModal.tsx` — sama, `saveError` state modali sees
- `Workspace.tsx` — auth-viga peaks suunama login-vormi juurde (mitte alert)

### `pageService.ts`

- [ ] **Loe rida ~60–75**

  ```bash
  sed -n '60,80p' src/services/pageService.ts
  ```

- [ ] **Asenda `alert(...)` → `throw new Error(...)`** — las kutsuja otsustab kuvamise

### `TextEditor.tsx`

- [ ] **Loe ridad ~350–385**

  ```bash
  sed -n '348,385p' src/components/TextEditor.tsx
  ```

- [ ] **Lisa state:**

  ```tsx
  const [saveError, setSaveError] = useState<string | null>(null);
  ```

- [ ] **Asenda `alert(...)` → `setSaveError('...')`** (kasuta tõlkevõtit kui see on olemas, muidu tekstiga)

- [ ] **Kuva `ErrorBanner`** sobivas kohas (nt salvestusnupu lähedal):

  ```tsx
  import { ErrorBanner } from './ErrorBanner';
  // ...
  {saveError && (
    <ErrorBanner
      message={saveError}
      onClose={() => setSaveError(null)}
      className="mb-2"
    />
  )}
  ```

### `MetadataModal.tsx`

- [ ] **Sama muster** — `saveError` state + `ErrorBanner` modali footer-i ees

### `Workspace.tsx`

- [ ] **Loe ridad ~170–185**

  ```bash
  sed -n '168,188p' src/pages/Workspace.tsx
  ```

- [ ] **Auth-vea korral** (kasutaja pole sisse logitud): kontrolli esmalt kas `UserContext` ekspordib `sessionExpired` (vaata `src/contexts/UserContext.tsx` interface):

  ```bash
  grep -n "sessionExpired" src/contexts/UserContext.tsx src/pages/Workspace.tsx
  ```

  - Kui `sessionExpired` on olemas: kasuta seda kuvamaks `ErrorBanner`-it "Sessioon on aegunud, palun logi uuesti sisse"
  - Kui pole: asenda `alert(...)` lihtsalt `setSaveError('Salvestamiseks pead olema sisse logitud')` state-iga ja kuva `ErrorBanner`

- [ ] **Verifitseeri**

  ```bash
  npm run build
  ```

- [ ] **Commit**

  ```bash
  git add src/services/pageService.ts src/components/TextEditor.tsx src/components/MetadataModal.tsx src/pages/Workspace.tsx
  git commit -m "fix: asenda alert() → ErrorBanner inline veakuvamine (K1)"
  ```

---

## Task 11: Selgita E1 — `contributor` rolli seis

Kood defineerib `contributor` rolli, kuid `/save` endpoint lükkab contributor kasutajate salvestused tagasi. Vaja on selgitada kas roll on kasutusel või mitte.

**Files:**
- Modify: `server/main.py` (kommentaar) VÕI otsustada implementeerida pending-edits voog
- Modify: `server/registration.py` (kommentaar)

- [ ] **Uuri `/save` endpointi nõutud roll**

  ```bash
  grep -n "contributor\|editor\|require_role\|role" server/main.py | head -30
  ```

- [ ] **Uuri registreerimist**

  ```bash
  grep -n "contributor\|editor\|role" server/registration.py | head -20
  ```

- [ ] **Uuri kas `contributor`-rolli kasutajaid eksisteerib**

  ```bash
  # Serveris (ssh vutt):
  grep -o '"role": "[^"]*"' state/users.json | sort | uniq -c
  ```

- [ ] **Otsusta:**

  **Variant A** — `contributor` roll pole kasutusel (kõik on `editor` või `admin`):
  - Lisa kommentaar `server/main.py` `/save` juurde: "contributor roll on reserveeritud tulevaste pending-edits funktsioonide jaoks"
  - Lisa kommentaar `server/registration.py:215` miks `editor` on vaikimisi roll

  **Variant B** — `contributor`-rolli kasutajaid on:
  - See on kriitilisem — loo GitHub issue pending-edits voo implementeerimiseks
  - Lisa ajutine teade Workspace'is `contributor` kasutajale

- [ ] **Commit vastavalt otsusele**

  ```bash
  git commit -m "chore: dokumenteeri contributor rolli seis (E1)"
  ```

---

## Task 12: Lisa O6 — TOCTOU kommentaarid bulk-operatsioonidesse

Bulk-operatsioonides on potentsiaalne TOCTOU (Time-of-Check-Time-of-Use) aken — kaks samaaegselt käivat operatsiooni võivad kirjutada teineteise muudatused üle. Risk on madal, aga peaks olema dokumenteeritud.

**Files:**
- Modify: `server/main.py`

- [ ] **Leia bulk endpointid**

  ```bash
  grep -n "bulk-collection\|bulk-tags\|bulk-genre\|/works/bulk" server/main.py | head -10
  ```

- [ ] **Lisa kommentaar iga bulk endpointi juurde** (rida ~706 ja sarnased):

  ```python
  # NB: Bulk operatsioonid ei ole mõeldud samaaegseks kasutamiseks.
  # Kui kaks admin-kasutajat käivitavad bulk-operatsiooni korraga, võivad
  # nad teineteise muudatusi üle kirjutada (TOCTOU). Praeguses kasutuskontekstis
  # (üks admin korraga) on see aktsepteeritav. Tulevikus: lisada work_id-põhine lukk.
  ```

- [ ] **Commit**

  ```bash
  git add server/main.py
  git commit -m "chore: dokumenteeri TOCTOU risk bulk-operatsioonides (O6)"
  ```

---

## Task 13: Madala prioriteediga refaktorid (E3, E5, E6)

Need on ettepanekud mis vajavad rohkem kaalumist. Igaüks on eraldi otsustuspunkt.

### E3 — `crossLangTypeMap` eemaldamine

- [ ] **Kontrolli kas kõigil teostel on `type_ids` indekseeritud** (serveris):

  ```bash
  # ssh vutt — käivita Meilisearchi päring (master key on .env failis MEILISEARCH_MASTER_KEY):
  MEILI_KEY=$(grep MEILISEARCH_MASTER_KEY ~/VUTT/.env | cut -d= -f2)
  curl -X POST "http://localhost:7700/indexes/teosed/search" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MEILI_KEY" \
    -d '{"filter": "type_ids NOT EXISTS OR type_ids IS EMPTY", "limit": 5, "attributesToRetrieve": ["title", "work_id"]}'
  ```
  Kui `estimatedTotalHits` on 0 → kõigil on type_ids → saab eemaldada.

- [ ] **Kui tulemus on tühi** (kõigil on type_ids): eemalda `crossLangTypeMap` ja `crossLangGenreMap` `src/components/AdvancedFilters.tsx:195–206`

- [ ] **Kui tulemus sisaldab teoseid**: jäta alles — andmeid tuleb enne re-indekseerida

### E5 — `getWorkStatuses` batch päring

- [ ] **Loe olemasolev `workService.ts:11–43`**

- [ ] **Hinda kas Meilisearch toetab `work_id IN [...]` süntaksit** — dokumentatsioon: https://www.meilisearch.com/docs/reference/api/search#filter

- [ ] **Kui toetab**: refaktorida `getWorkStatuses` ühe päringu peale:
  ```typescript
  filter: `work_id IN [${workIds.map(id => `"${id}"`).join(', ')}] AND lehekylje_number = 1`
  ```

### E6 — `CollapsibleSection` ümber nimetamine

- [ ] **Loe mõlemad komponendid** et mõista API erinevust

- [ ] **Otsusta**: kas prosopogrupaafi CollapsibleSection vajab uut nime?
  - `src/prosopography/components/personForm/CollapsibleSection.tsx` → nt `PersonFormSection`

- [ ] **Kui otsustad ümber nimetada**: kasuta grep + Edit (kontrolli et import-d on uuendatud)

---

## Task 14: O8 — `useQCodeMaps` refaktor (keeruline, madal risk)

Potentsiaalne kahekordne render-pass otsingus. Praegu stabiilne, aga arhitektuuriliselt habras.

**Files:**
- Modify: `src/pages/search/hooks/useQCodeMaps.ts`

- [ ] **Loe hook täielikult**

  ```bash
  wc -l src/pages/search/hooks/useQCodeMaps.ts
  cat src/pages/search/hooks/useQCodeMaps.ts
  ```

- [ ] **Tuvasta normaliseerimise `useEffect` plokid** (read ~173–222)

- [ ] **Eraldamine strateegia:** normaliseerimisefektid peaks käivituma ainult kui URL sisaldab label-põhiseid (mitte Q-koodi) parameetreid. Lisa guard:

  ```typescript
  // Käivita normaliseerimine ainult siis kui URL sisaldab label-põhiseid parameetreid:
  const needsNormalization = urlGenres.some(g => !isQCode(g)) ||
                             urlTypes.some(t => !isQCode(t));
  useEffect(() => {
    if (!needsNormalization) return;
    // ... normaliseerimine ...
  }, [needsNormalization, genreLabelToId, typeLabelToId]);
  ```

- [ ] **Verifitseeri et otsing töötab** — käivita `npm run dev`, testi otsingut Q-koodide ja label-põhiste parameetritega

- [ ] **Commit**

  ```bash
  git add src/pages/search/hooks/useQCodeMaps.ts
  git commit -m "refactor: lisa needsNormalization guard useQCodeMaps useEffect-i (O8)"
  ```

---

## Task 15: E7 — Dashboard/TextEditor jagamine (tulevikuks)

**NB:** See task on madala prioriteediga ja ainult siis kui vastavasse faili läheb vaja muudatusi.

**Files:**
- Modify: `src/pages/Dashboard.tsx` → eraldada `useBulkOperations` hook
- Modify: `src/components/TextEditor.tsx` → eraldada toolbar-loogika

- [ ] **Dashboard.tsx** — identifitseeri bulk-operatsioonide loogika (bulk-collection, bulk-tags, bulk-genre state ja handler-id)

- [ ] **Loo `src/hooks/useBulkOperations.ts`** — vii sinna bulk state + handlerid, tagasta interface

- [ ] **TextEditor.tsx** — identifitseeri toolbar nupud + nende logika

- [ ] **Loo `src/components/editor/EditorToolbar.tsx`** — vii sinna toolbar komponent

- [ ] **Verifitseeri**

  ```bash
  npm run build
  ```

- [ ] **Commit**

  ```bash
  git commit -m "refactor: eralda useBulkOperations ja EditorToolbar (E7)"
  ```

---

## Prioriteetjärjekord kokkuvõttena

| Task | Review ID | Keerukus | Mõju |
|------|-----------|---------|------|
| Task 1 | K2, O1, E4 | Triviaalne | Kõrge/Madal |
| Task 2 | O5 | Triviaalne | Madal |
| Task 3 | O3 | Triviaalne | Madal |
| Task 4 | K3 | Madal | Kõrge |
| Task 5 | O2 | Madal | Keskmine |
| Task 6 | O7 | Madal | Keskmine |
| Task 7 | E2 | Triviaalne | Madal |
| Task 8 | O4 | Madal | Keskmine |
| Task 9 | K1 eeltöö | Madal | - |
| Task 10 | K1 | Keskmine | Kõrge |
| Task 11 | E1 | Kõrge | Kõrge |
| Task 12 | O6 | Triviaalne | Madal |
| Task 13 | E3, E5, E6 | Erinev | Madal |
| Task 14 | O8 | Kõrge | Madal |
| Task 15 | E7 | Kõrge | Madal |
