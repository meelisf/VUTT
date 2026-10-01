# Etapp 1b — töökollektsiooni ligipääsupaneel (teostusplaan)

> **Agentidele:** KOHUSTUSLIK ALAMOSKUS: kasuta selle plaani täitmiseks
> `superpowers:subagent-driven-development` (soovitatud) või
> `superpowers:executing-plans`. Sammud on checkbox-kujul (`- [ ]`).

**Eesmärk:** admin haldab töökollektsiooni ligipääsu sealsamas, kus ta kogu
haldab — inimese otsing, lisamine, rolli muutmine ja eemaldamine mustandina,
ühe „Salvesta muudatused" nupuga. Kogu haldur näeb sama kaarti lugemisvaates.

**Arhitektuur:** uus `WorkSetAccessPanel` komponent `WorkSets.tsx` sees,
avatav kogu rea juures nagu olemasolev liikmete paneel. Kogu muutmisloogika
elab puhtas moodulis `workSetAccessDraft.ts` (mustand, klassifikatsioon,
valvurite peegeldus), mis on vitestiga kaetud; komponent on selle vaade.
Salvestus käib olemasoleva `setWorkSetAccess`-i kaudu — `PUT access` jääb
täisasenduseks (ADR 0043 p7), nii et mustand ehitatakse ALATI serverilt
laetud tervest kaardist, mitte nähtavatest ridadest.

**Tehnoloogia:** React 19 + TypeScript + Tailwind, vitest, i18next.

**Spekk:** [`docs/superpowers/specs/2026-09-14-kasutajad-ja-kogude-ligipaas-design.md`](../specs/2026-09-14-kasutajad-ja-kogude-ligipaas-design.md) (§2 „Töökollektsioon", §3, §5)
**ADR:** [0043](../../decisions/0043-kogude-oiguste-uhised-toimingud.md)
**Eelnev etapp:** [1a](2026-09-14-kasutajad-ja-kogude-ligipaas-1a.md) — PR #361, tootmises 2026-09-14

## Üldised piirangud

- **Koodikommentaarid eesti keeles.** Kommentaar ütleb MIKS, mitte MIDA.
- **i18n (ADR 0011):** `fallbackLng` on VÄLJAS — iga uus võti lisatakse
  `src/locales/et/admin.json` JA `src/locales/en/admin.json` KORRAGA, muidu
  katkeb build. Valvurid: `localeParity.test.ts`, `translationKeysResolve.test.ts`.
- **Täieliku kaardi leping (ADR 0043 p7):** klient saadab TERVE `access`-kaardi.
  Filtrid, otsing ja nähtavad read muudavad ainult kuvamist. Lukustatud
  (superadmin / võrdne admin) ja puutumata kustutatud kasutaja kirjed
  saadetakse muutmatult kaasa. `accessChanges` EI TOHI ehitada kaarti
  nähtavatest ridadest.
- **`revision` on kohustuslik** (1a): `setWorkSetAccess(setId, access, revision)`.
  409 korral laaditakse uus olek, säilitatakse kasutaja kavatsus võrdlemiseks
  ja näidatakse konflikti — **ei automaatset kordussaatmist ega ühendamist**.
- **Serveri veakoodid 1a-st:** 400 = `revision` puudub või `access` ei ole
  objekt; 403 = keelatud muudatus diffis (sh tundmatu kasutajanimi, admin+
  määrang, lukustatud kirje); 409 = revision-konflikt.
- **Töökollektsiooni `access` muudatus EI invalideeri sessioone** — API
  kontrollib õigust iga päringu ajal. Hoiatust „peavad uuesti sisse logima"
  siia EI panda (see kuulub kollektsiooniõiguste juurde, etapp 2).
- **Admin-paneel ei muuda aktiivset kogu** (ADR 0038): `useCollectionUrlSync`-i
  siin ei kutsuta.
- **z-index:** paneel on rea sees, mitte modaal. Kui teed modaali, on täisekraan
  `z-[1300]`; `z-50` EI OLE piisav.
- **Väravad iga taski lõpus:** `npm run typecheck`, `npm test`.
  Etapi lõpus ka `npm run lint:ci` (lävi `--max-warnings 44` — parandades
  LANGETA arvu) ja `npm run build`.

## Failistruktuur

| Fail | Vastutus | Muudatus |
|---|---|---|
| `src/pages/admin/workSetAccessDraft.ts` | mustand, kirjete klassifikatsioon, serveri valvurite peegeldus, kasutajaotsing | **uus** |
| `src/pages/admin/__tests__/workSetAccessDraft.test.ts` | ülaltoodu ühikkate | **uus** |
| `src/pages/admin/WorkSetAccessPanel.tsx` | paneeli vaade (admin + halduri režiim) | **uus** |
| `src/pages/admin/WorkSets.tsx` | paneeli avamine rea juures, kasutajate laadimine adminile | muuda |
| `src/services/workSetService.ts` | `AccessEntryUser` tüüp kasutajate loendile | muuda (tüüp) |
| `src/locales/{et,en}/admin.json` | `workSets.accessPanel.*` võtmed | muuda MÕLEMAD |
| `src/pages/Dashboard.tsx` | „Lähtesta valik" ligipääsu kadumisel | muuda |

---

### Task 0: haru

- [ ] **Samm 1: kontrolli, et main on värske**

```bash
git checkout main && git pull --ff-only && git log --oneline -1
```

Oodatud: `8b530934` või uuem (1a merge).

- [ ] **Samm 2: loo haru**

```bash
git checkout -b feat/kogude-ligipaasupaneel-1b
```

---

### Task 1: mustandi- ja klassifikatsioonimoodul

**Failid:**
- Loo: `src/pages/admin/workSetAccessDraft.ts`
- Test: `src/pages/admin/__tests__/workSetAccessDraft.test.ts`

**Liidesed:**
- Tarbib: `SetRole`, `applyUserRole` (`./workSetAccess`), `WorkSetSummary`
  (`../../services/workSetService`).
- Toodab:
  ```ts
  export type AccessEntryKind = 'normal' | 'role_based' | 'deleted_user';
  export interface AccessEntry {
    username: string;
    role: SetRole;
    kind: AccessEntryKind;
    /** Kas seda rida tohib SELLE kutsuja muuta (rolli vahetada)? */
    canChange: boolean;
    /** Kas seda rida tohib SELLE kutsuja eemaldada? */
    canRemove: boolean;
  }
  export interface KnownUser { username: string; name: string; email: string; role: string; }
  export function classifyEntries(
    access: Record<string, SetRole>, users: KnownUser[], actor: { username: string; role: string },
  ): AccessEntry[];
  export function addableUsers(users: KnownUser[], access: Record<string, SetRole>,
                               actor: { username: string; role: string }): KnownUser[];
  export function searchUsers(users: KnownUser[], query: string): KnownUser[];
  export function draftChanged(loaded: Record<string, SetRole>,
                               draft: Record<string, SetRole>): boolean;
  ```
  Kasutajad: Task 2 (paneel), Task 3 (`WorkSets.tsx`).

- [ ] **Samm 1: kirjuta kukkuvad testid**

Loo `src/pages/admin/__tests__/workSetAccessDraft.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  addableUsers, classifyEntries, draftChanged, searchUsers, KnownUser,
} from '../workSetAccessDraft';
import { SetRole } from '../workSetAccess';

const USERS: KnownUser[] = [
  { username: 'mari', name: 'Mari Mets', email: 'mari@ut.ee', role: 'contributor' },
  { username: 'juri', name: 'Jüri Jõgi', email: 'juri@ut.ee', role: 'editor' },
  { username: 'aadu', name: 'Aadu Admin', email: 'aadu@ut.ee', role: 'admin' },
  { username: 'siim', name: 'Siim Super', email: 'siim@ut.ee', role: 'superadmin' },
];
const ADMIN = { username: 'aadu', role: 'admin' };
const SUPER = { username: 'siim', role: 'superadmin' };

describe('classifyEntries', () => {
  it('tavaline madalama rolliga kirje on muudetav ja eemaldatav', () => {
    const [rida] = classifyEntries({ mari: 'viewer' }, USERS, ADMIN);
    expect(rida).toEqual({ username: 'mari', role: 'viewer', kind: 'normal',
                           canChange: true, canRemove: true });
  });

  it('admin+ kirje on rollist tulenev ja mitte muudetav', () => {
    const [rida] = classifyEntries({ siim: 'manager' }, USERS, ADMIN);
    expect(rida.kind).toBe('role_based');
    expect(rida.canChange).toBe(false);
    // admin ei tohi superadmini kirjet ka eemaldada
    expect(rida.canRemove).toBe(false);
  });

  it('enda dekoratiivse kirje tohib eemaldada, aga mitte muuta', () => {
    const [rida] = classifyEntries({ aadu: 'manager' }, USERS, ADMIN);
    expect(rida.kind).toBe('role_based');
    expect(rida.canChange).toBe(false);
    expect(rida.canRemove).toBe(true);
  });

  it('superadmin tohib admini vana kirje eemaldada', () => {
    const [rida] = classifyEntries({ aadu: 'manager' }, USERS, SUPER);
    expect(rida.canRemove).toBe(true);
    expect(rida.canChange).toBe(false);
  });

  it('tundmatu kasutajanimi on kustutatud kasutaja: eemaldatav, mitte muudetav', () => {
    const [rida] = classifyEntries({ kadunud: 'viewer' }, USERS, ADMIN);
    expect(rida.kind).toBe('deleted_user');
    expect(rida.canChange).toBe(false);
    expect(rida.canRemove).toBe(true);
  });

  it('järjestab kasutajanime järgi, et diff oleks stabiilne', () => {
    const read = classifyEntries({ mari: 'viewer', juri: 'manager' }, USERS, ADMIN);
    expect(read.map(r => r.username)).toEqual(['juri', 'mari']);
  });
});

describe('addableUsers', () => {
  it('jätab välja admin+ kasutajad — nende haldusõigus tuleneb rollist', () => {
    expect(addableUsers(USERS, {}, ADMIN).map(u => u.username)).toEqual(['mari', 'juri']);
  });

  it('jätab välja juba lisatud inimesed', () => {
    expect(addableUsers(USERS, { mari: 'viewer' }, ADMIN).map(u => u.username)).toEqual(['juri']);
  });

  it('superadminile kehtib sama admin+ piirang', () => {
    expect(addableUsers(USERS, {}, SUPER).map(u => u.username)).toEqual(['mari', 'juri']);
  });
});

describe('searchUsers', () => {
  it('otsib nime, kasutajanime ja e-posti järgi', () => {
    expect(searchUsers(USERS, 'mets').map(u => u.username)).toEqual(['mari']);
    expect(searchUsers(USERS, 'juri').map(u => u.username)).toEqual(['juri']);
    expect(searchUsers(USERS, 'aadu@ut').map(u => u.username)).toEqual(['aadu']);
  });

  it('on diakriitikatundetu mõlemas suunas', () => {
    expect(searchUsers(USERS, 'jogi').map(u => u.username)).toEqual(['juri']);
    expect(searchUsers(USERS, 'JÕGI').map(u => u.username)).toEqual(['juri']);
  });

  it('tühi päring annab kõik', () => {
    expect(searchUsers(USERS, '   ')).toHaveLength(4);
  });
});

describe('draftChanged', () => {
  const laetud: Record<string, SetRole> = { mari: 'viewer', juri: 'manager' };

  it('sama kaart on muutusteta', () => {
    expect(draftChanged(laetud, { juri: 'manager', mari: 'viewer' })).toBe(false);
  });

  it('rolli vahetus on muutus', () => {
    expect(draftChanged(laetud, { mari: 'manager', juri: 'manager' })).toBe(true);
  });

  it('eemaldamine on muutus', () => {
    expect(draftChanged(laetud, { mari: 'viewer' })).toBe(true);
  });

  it('lisamine on muutus', () => {
    expect(draftChanged(laetud, { ...laetud, uus: 'viewer' })).toBe(true);
  });
});
```

- [ ] **Samm 2: käivita testid, veendu et kukuvad**

Käsk: `npx vitest run src/pages/admin/__tests__/workSetAccessDraft.test.ts`
Oodatud: FAIL — `Failed to resolve import "../workSetAccessDraft"`.

- [ ] **Samm 3: kirjuta moodul**

Loo `src/pages/admin/workSetAccessDraft.ts`:

```ts
/**
 * Töökollektsiooni ligipääsu MUSTAND ja kirjete klassifikatsioon (#318, ADR 0043).
 *
 * `PUT access` on täisasendus: klient saadab terve kaardi ja server
 * klassifitseerib diffi. Siinsed funktsioonid PEEGELDAVAD serveri valvureid,
 * et kasutaja ei näeks nuppu, mis annab 403 — aga nad EI OLE õiguse allikas.
 * Otsus tehakse serveris (`server/work_sets_access.py::check_access_diff`);
 * siin on ainult kuvamisloogika.
 */
import { isAtLeast } from '../../utils/roleUtils';
import { SetRole } from './workSetAccess';

export type AccessEntryKind = 'normal' | 'role_based' | 'deleted_user';

export interface AccessEntry {
  username: string;
  role: SetRole;
  kind: AccessEntryKind;
  /** Kas seda rida tohib SELLE kutsuja muuta (rolli vahetada)? */
  canChange: boolean;
  /** Kas seda rida tohib SELLE kutsuja eemaldada? */
  canRemove: boolean;
}

export interface KnownUser {
  username: string;
  name: string;
  email: string;
  role: string;
}

export interface Actor {
  username: string;
  role: string;
}

/** Serveri `can_manage_user` peegeldus: RANGELT madalam tase. */
function tohibHallata(actorRole: string, targetRole: string): boolean {
  const tasemed = ['contributor', 'editor', 'admin', 'superadmin'];
  const a = tasemed.indexOf(actorRole);
  const t = tasemed.indexOf(targetRole);
  return a > -1 && t > -1 && a > t;
}

/**
 * Kirjete kuvamiskuju, kasutajanime järgi järjestatud.
 *
 * Järjestus on stabiilne MEELEGA: kaardi võtmete järjekord ei ole lubadus ja
 * hüplev nimekiri teeks „mis muutus" hindamise võimatuks.
 */
export function classifyEntries(
  access: Record<string, SetRole>, users: KnownUser[], actor: Actor,
): AccessEntry[] {
  const rollid = new Map(users.map(u => [u.username, u.role]));
  return Object.keys(access || {}).sort().map(username => {
    const role = access[username];
    const sihtroll = rollid.get(username);

    if (sihtroll === undefined) {
      // Kustutatud kasutaja jäänuk: server lubab eemaldada, aga rolli muuta
      // mitte (tundmatu kasutajanimi lükatakse uue määranguna tagasi).
      return { username, role, kind: 'deleted_user' as const,
               canChange: false, canRemove: true };
    }
    if (isAtLeast(sihtroll, 'admin')) {
      // Admin+ haldusõigus tuleneb rollist. Kirje on dekoratiivne: uut ei looda,
      // olemasolevat ei muudeta; eemaldada tohib enda või madalama oma.
      return {
        username, role, kind: 'role_based' as const,
        canChange: false,
        canRemove: username === actor.username || tohibHallata(actor.role, sihtroll),
      };
    }
    const tohib = tohibHallata(actor.role, sihtroll);
    return { username, role, kind: 'normal' as const, canChange: tohib, canRemove: tohib };
  });
}

/** Lisamiseks pakutavad: admin+ ja juba lisatud jäävad välja. */
export function addableUsers(
  users: KnownUser[], access: Record<string, SetRole>, actor: Actor,
): KnownUser[] {
  return users.filter(u =>
    !(u.username in (access || {}))
    && !isAtLeast(u.role, 'admin')
    && tohibHallata(actor.role, u.role));
}

/** Diakriitikatundetu otsing nime, kasutajanime ja e-posti järgi. */
export function searchUsers(users: KnownUser[], query: string): KnownUser[] {
  const q = normaliseeri(query);
  if (!q) return users;
  return users.filter(u =>
    normaliseeri(u.name).includes(q)
    || normaliseeri(u.username).includes(q)
    || normaliseeri(u.email).includes(q));
}

function normaliseeri(s: string): string {
  // NFD + kombineerivate märkide eemaldus: „Jõgi" ja „Jogi" peavad leidma
  // teineteist mõlemas suunas.
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Kas mustand erineb laetud kaardist? Muutusteta salvestust ei pakuta. */
export function draftChanged(
  loaded: Record<string, SetRole>, draft: Record<string, SetRole>,
): boolean {
  const a = loaded || {};
  const b = draft || {};
  const votmed = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of votmed) {
    if (a[k] !== b[k]) return true;
  }
  return false;
}
```

- [ ] **Samm 4: käivita testid**

Käsk: `npx vitest run src/pages/admin/__tests__/workSetAccessDraft.test.ts`
Oodatud: PASS (16 testi).

- [ ] **Samm 5: (kontrollitud ette) `isAtLeast` liides sobib**

`src/utils/roleUtils.ts:25` — `isAtLeast(role: string | undefined | null,
minRole: Role)`. Esimene argument on lai `string`, teine literaal (`'admin'`),
seega `isAtLeast(sihtroll, 'admin')` tüübitub ilma teisenduseta. `KnownUser.role`
võib jääda `string`-iks. Kohanduda ei ole vaja; `as any` on igal juhul keelatud.

- [ ] **Samm 6: typecheck ja commit**

```bash
npm run typecheck
git add src/pages/admin/workSetAccessDraft.ts src/pages/admin/__tests__/workSetAccessDraft.test.ts
git commit -m "feat(work-sets): ligipääsu mustandi ja kirjete klassifikatsiooni moodul (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 2: `WorkSetAccessPanel` komponent

**Failid:**
- Loo: `src/pages/admin/WorkSetAccessPanel.tsx`
- Muuda: `src/locales/et/admin.json`, `src/locales/en/admin.json`

**Liidesed:**
- Tarbib: `classifyEntries`, `addableUsers`, `searchUsers`, `draftChanged`,
  `KnownUser` (Task 1); `applyUserRole` (`./workSetAccess`);
  `setWorkSetAccess`, `WorkSetSummary` (`../../services/workSetService`).
- Toodab:
  ```tsx
  interface WorkSetAccessPanelProps {
    ws: WorkSetSummary;
    /** Admini üldloend. Halduri režiimis TÜHI — tal ei ole üldloendit. */
    users: KnownUser[];
    actor: { username: string; role: string };
    /** Kas kutsuja tohib muuta (admin+)? Väär = lugemisvaade. */
    canEdit: boolean;
    /** Kutsutakse pärast edukat salvestust; kutsuja laeb kogud uuesti. */
    onSaved: (ws: WorkSetSummary) => void;
  }
  export default function WorkSetAccessPanel(props: WorkSetAccessPanelProps): JSX.Element;
  ```
  Kasutaja: Task 3.

- [ ] **Samm 1: lisa i18n võtmed MÕLEMASSE keelde**

`src/locales/et/admin.json`, objekti `workSets` sisse:

```json
"accessPanel": {
  "title": "Ligipääs",
  "explain": "Siin antud õigus puudutab ainult seda töökollektsiooni.",
  "noRightsGranted": "Töökollektsiooni õigus ei anna juurde teoste lugemise ega tekstide muutmise õigust. Kasutaja näeb siin talle lubatud teoseid.",
  "adminsExplain": "Adminid ja superadminid haldavad kõiki töökollektsioone rollist tulenevalt — neid ei ole vaja siia lisada.",
  "publicExplain": "Kogu on avalik: sirvimiseks ei ole isiklikku vaatajamäärangut vaja. Olemasolevad määrangud jäävad kehtima, kui kogu hiljem piiratakse.",
  "archivedExplain": "Kogu on arhiveeritud. Õigused jäävad kehtima ja neid saab muuta.",
  "searchPlaceholder": "Otsi nime, kasutajanime või e-posti järgi",
  "noMatches": "Ühtki kasutajat ei leitud",
  "addPerson": "Lisa kasutaja",
  "roleBased": "Õigus tuleneb rollist",
  "deletedUser": "Kustutatud kasutaja ({{username}})",
  "remove": "Eemalda",
  "noEntries": "Ühtki määrangut ei ole",
  "save": "Salvesta muudatused",
  "cancel": "Loobu",
  "saving": "Salvestan…",
  "saved": "Salvestatud",
  "conflictReload": "Kogu muutus vahepeal. Laadisin uue oleku; vaata oma muudatused üle ja salvesta uuesti.",
  "yourIntent": "Sinu salvestamata valik:",
  "readOnlyHint": "Õiguste jagamine on admini toiming. Siin on selle kogu praegune ligipääs.",
  "loadFailed": "Ligipääsu laadimine ebaõnnestus"
}
```

`src/locales/en/admin.json`, SAMASSE kohta (sama võtmestik — `fallbackLng` on
väljas, puuduv võti katkestab buildi):

```json
"accessPanel": {
  "title": "Access",
  "explain": "Rights granted here apply to this work set only.",
  "noRightsGranted": "A work set right does not grant any additional right to read works or edit texts. The user sees the works they are already allowed to see.",
  "adminsExplain": "Admins and superadmins manage all work sets by role — they do not need to be added here.",
  "publicExplain": "This set is public: no personal viewer entry is needed for browsing. Existing entries remain and take effect again if the set is later restricted.",
  "archivedExplain": "This set is archived. Rights remain in effect and can still be changed.",
  "searchPlaceholder": "Search by name, username or email",
  "noMatches": "No users found",
  "addPerson": "Add user",
  "roleBased": "Right derives from role",
  "deletedUser": "Deleted user ({{username}})",
  "remove": "Remove",
  "noEntries": "No entries",
  "save": "Save changes",
  "cancel": "Cancel",
  "saving": "Saving…",
  "saved": "Saved",
  "conflictReload": "The set changed meanwhile. The current state has been loaded; review your changes and save again.",
  "yourIntent": "Your unsaved selection:",
  "readOnlyHint": "Sharing rights is an admin action. This is the current access for this set.",
  "loadFailed": "Loading access failed"
}
```

- [ ] **Samm 2: kontrolli i18n valvureid**

Käsk: `npx vitest run src/locales/__tests__/localeParity.test.ts src/locales/__tests__/translationKeysResolve.test.ts`
(kui teed on teised, leia: `grep -rl "localeParity\|translationKeysResolve" src/`)
Oodatud: PASS. Kui kukub „et/en võtmestik erineb", on üks keel puudu — paranda
enne edasiminekut.

- [ ] **Samm 3: kirjuta komponent**

Loo `src/pages/admin/WorkSetAccessPanel.tsx`:

```tsx
/**
 * Töökollektsiooni ligipääsupaneel kogu juures (#318, ADR 0043).
 *
 * Mustand + „Salvesta muudatused": iga valiku peale päringut EI tehta.
 * `PUT access` on täisasendus, seega mustand algab serverilt laetud TERVEST
 * kaardist — otsing ja filtrid muudavad ainult seda, mida näidatakse.
 * Lukustatud ja puutumata kirjed lähevad salvestusel muutmatult kaasa.
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Trash2, UserPlus } from 'lucide-react';
import { WorkSetSummary, setWorkSetAccess } from '../../services/workSetService';
import { applyUserRole, SetRole } from './workSetAccess';
import {
  addableUsers, classifyEntries, draftChanged, searchUsers, KnownUser,
} from './workSetAccessDraft';

interface WorkSetAccessPanelProps {
  ws: WorkSetSummary;
  users: KnownUser[];
  actor: { username: string; role: string };
  canEdit: boolean;
  onSaved: (ws: WorkSetSummary) => void;
}

const WorkSetAccessPanel: React.FC<WorkSetAccessPanelProps> = ({
  ws, users, actor, canEdit, onSaved,
}) => {
  const { t } = useTranslation(['admin', 'common']);

  // Laetud kaart = viimane serverilt kinnitatud olek. Mustand algab sellest.
  const [laetud, setLaetud] = useState<Record<string, SetRole>>(
    () => ({ ...((ws.access as Record<string, SetRole>) || {}) }));
  const [mustand, setMustand] = useState<Record<string, SetRole>>(
    () => ({ ...((ws.access as Record<string, SetRole>) || {}) }));
  const [revision, setRevision] = useState(ws.revision);
  const [otsing, setOtsing] = useState('');
  const [salvestan, setSalvestan] = useState(false);
  const [viga, setViga] = useState<string | null>(null);
  // Konflikti korral hoitakse kasutaja kavatsust VÕRDLEMISEKS — automaatset
  // ühendamist ega kordussaatmist ei tehta (ADR 0043 p6).
  const [konfliktiKavatsus, setKonfliktiKavatsus] = useState<Record<string, SetRole> | null>(null);

  const read = useMemo(
    () => classifyEntries(mustand, users, actor), [mustand, users, actor]);
  const lisatavad = useMemo(
    () => searchUsers(addableUsers(users, mustand, actor), otsing),
    [users, mustand, actor, otsing]);
  const muutunud = draftChanged(laetud, mustand);

  const muudaRolli = (username: string, role: SetRole | null) => {
    setMustand(prev => applyUserRole(prev, username, role));
  };

  const loobu = () => {
    setMustand({ ...laetud });
    setViga(null);
    setKonfliktiKavatsus(null);
    setOtsing('');
  };

  const salvesta = async () => {
    setSalvestan(true);
    setViga(null);
    try {
      const uus = await setWorkSetAccess(ws.id, mustand, revision);
      const kinnitatud = { ...((uus.access as Record<string, SetRole>) || {}) };
      // Kinnitatud olek tuleb serverilt, mitte optimistlikust oletusest.
      setLaetud(kinnitatud);
      setMustand(kinnitatud);
      setRevision(uus.revision);
      setKonfliktiKavatsus(null);
      onSaved(uus);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 409) {
        // Säilita kavatsus võrdlemiseks ja näita uut olekut.
        setKonfliktiKavatsus({ ...mustand });
        setViga(t('workSets.accessPanel.conflictReload'));
      } else if (status === 403) {
        setViga((e as { message?: string }).message || t('workSets.saveFailed'));
      } else {
        setViga(t('workSets.saveFailed'));
      }
    } finally {
      setSalvestan(false);
    }
  };

  return (
    <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-4">
      <h4 className="font-semibold text-gray-800">{t('workSets.accessPanel.title')}</h4>
      <p className="mt-1 text-sm text-gray-600">{t('workSets.accessPanel.explain')}</p>
      <p className="mt-1 text-xs text-gray-500">{t('workSets.accessPanel.noRightsGranted')}</p>
      <p className="mt-1 text-xs text-gray-500">{t('workSets.accessPanel.adminsExplain')}</p>
      {ws.visibility === 'public' && (
        <p className="mt-1 text-xs text-gray-500">{t('workSets.accessPanel.publicExplain')}</p>
      )}
      {ws.status === 'archived' && (
        <p className="mt-1 text-xs text-gray-500">{t('workSets.accessPanel.archivedExplain')}</p>
      )}
      {!canEdit && (
        <p className="mt-2 text-xs text-gray-500">{t('workSets.accessPanel.readOnlyHint')}</p>
      )}

      <ul className="mt-3 divide-y divide-gray-200">
        {read.length === 0 && (
          <li className="py-2 text-sm text-gray-500">{t('workSets.accessPanel.noEntries')}</li>
        )}
        {read.map(rida => {
          const inimene = users.find(u => u.username === rida.username);
          return (
            <li key={rida.username} className="flex flex-wrap items-center gap-2 py-2">
              <span className="text-sm text-gray-800">
                {rida.kind === 'deleted_user'
                  ? t('workSets.accessPanel.deletedUser', { username: rida.username })
                  : (inimene ? `${inimene.name} (${rida.username})` : rida.username)}
              </span>
              {rida.kind === 'role_based' && (
                <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700">
                  {t('workSets.accessPanel.roleBased')}
                </span>
              )}
              {canEdit && rida.canChange ? (
                <select
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                  value={rida.role}
                  disabled={salvestan}
                  onChange={e => muudaRolli(rida.username, e.target.value as SetRole)}
                >
                  <option value="viewer">{t('workSets.viewer')}</option>
                  <option value="manager">{t('workSets.manager')}</option>
                </select>
              ) : (
                <span className="text-sm text-gray-600">
                  {rida.role === 'manager' ? t('workSets.manager') : t('workSets.viewer')}
                </span>
              )}
              {canEdit && rida.canRemove && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-sm text-red-700 hover:underline"
                  disabled={salvestan}
                  onClick={() => muudaRolli(rida.username, null)}
                >
                  <Trash2 size={14} /> {t('workSets.accessPanel.remove')}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {canEdit && (
        <div className="mt-3">
          <input
            type="text"
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            placeholder={t('workSets.accessPanel.searchPlaceholder')}
            value={otsing}
            onChange={e => setOtsing(e.target.value)}
          />
          {otsing.trim() !== '' && (
            <ul className="mt-2 max-h-48 overflow-y-auto rounded border border-gray-200 bg-white">
              {lisatavad.length === 0 && (
                <li className="px-2 py-1 text-sm text-gray-500">
                  {t('workSets.accessPanel.noMatches')}
                </li>
              )}
              {lisatavad.map(u => (
                <li key={u.username} className="flex items-center justify-between px-2 py-1">
                  <span className="text-sm text-gray-800">{u.name} ({u.username})</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-sm text-indigo-700 hover:underline"
                    onClick={() => { muudaRolli(u.username, 'viewer'); setOtsing(''); }}
                  >
                    <UserPlus size={14} /> {t('workSets.accessPanel.addPerson')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {viga && <p className="mt-3 text-sm text-red-700">{viga}</p>}
      {konfliktiKavatsus && (
        <p className="mt-1 text-xs text-gray-600">
          {t('workSets.accessPanel.yourIntent')}{' '}
          {Object.entries(konfliktiKavatsus).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}
        </p>
      )}

      {canEdit && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            disabled={!muutunud || salvestan}
            onClick={salvesta}
          >
            {salvestan
              ? <span className="inline-flex items-center gap-1">
                  <Loader2 className="animate-spin" size={14} />
                  {t('workSets.accessPanel.saving')}
                </span>
              : t('workSets.accessPanel.save')}
          </button>
          <button
            type="button"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={!muutunud || salvestan}
            onClick={loobu}
          >
            {t('workSets.accessPanel.cancel')}
          </button>
        </div>
      )}
    </div>
  );
};

export default WorkSetAccessPanel;
```

- [ ] **Samm 4: konflikti käsitluse kontroll**

`setWorkSetAccess` 409 korral: kontrolli, et `apiPut` viskab vea, mille
`status` on 409 ja mis EI kaota `detail.revision` välja. Vaata
`src/services/apiClient.ts` `ApiError` kuju ja kohanda `catch`-i, kui
`status` elab mujal:

```bash
grep -n "class ApiError\|status" src/services/apiClient.ts | head -20
```

Kui 409 korral tuleb serveri uus revision kaasa, kasuta seda: lae kogu uuesti
läbi `onSaved`-i kutsuja või lisa eraldi `reload` prop. **Ära** saada
automaatselt uuesti.

- [ ] **Samm 5: typecheck ja testid**

```bash
npm run typecheck
npm test
```
Oodatud: PASS.

- [ ] **Samm 6: commit**

```bash
git add src/pages/admin/WorkSetAccessPanel.tsx src/locales/et/admin.json src/locales/en/admin.json
git commit -m "feat(work-sets): ligipääsupaneel kogu juures (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 3: paneel `WorkSets.tsx`-i

**Failid:**
- Muuda: `src/pages/admin/WorkSets.tsx`

**Liidesed:**
- Tarbib: `WorkSetAccessPanel` (Task 2), `KnownUser` (Task 1).

**Kontekst:** `WorkSets.tsx` laeb praegu kogud (`listWorkSets`) ja avab
nõudmisel liikmete nimekirja (`openId`, `avaLiikmed`). Ligipääsupaneel saab
sama mustri: eraldi `accessOpenId`. Kasutajate üldloend laetakse AINULT
adminile ja AINULT korra (`POST /admin/users`) — haldur seda ei saa (spekk §3).

- [ ] **Samm 1: lisa kasutajate laadimine**

`WorkSets.tsx`-i olekute juurde:

```tsx
  // Kasutajate üldloend on ADMINI oma: haldur ei saa seda (spekk §3).
  // Laetakse korra, mitte iga paneeli avamisel.
  const [users, setUsers] = useState<KnownUser[]>([]);
  const [accessOpenId, setAccessOpenId] = useState<string | null>(null);
```

ja eraldi effect:

```tsx
  useEffect(() => {
    if (!isAdmin) return;
    apiPost<{ status: string; users?: KnownUser[] }>('/admin/users', {}, { token: authToken })
      .then(d => setUsers(d.users || []))
      // Kasutajate loendi puudumine EI tohi paneeli blokeerida: olemasolevad
      // kirjed on endiselt nähtavad, ainult lisamine jääb tegemata.
      .catch(() => setUsers([]));
  }, [isAdmin, authToken]);
```

Impordid: `apiPost` (`../../services/apiClient`), `KnownUser`
(`./workSetAccessDraft`), `WorkSetAccessPanel` (`./WorkSetAccessPanel`).
`authToken` tuleb `useUser()`-ist — kontrolli, kuidas `Users.tsx` selle võtab
(`const { authToken } = useUser();`) ja kasuta sama.

- [ ] **Samm 2: lisa paneeli avamise nupp kogu rea juurde**

Olemasoleva „Liikmed" nupu kõrvale (otsi `avaLiikmed` kutset JSX-is):

```tsx
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-sm text-gray-700 hover:underline"
                    onClick={() => setAccessOpenId(accessOpenId === ws.id ? null : ws.id)}
                  >
                    <Users size={14} /> {t('workSets.accessPanel.title')}
                  </button>
```

ja rea alla paneel:

```tsx
              {accessOpenId === ws.id && (
                <WorkSetAccessPanel
                  ws={ws}
                  users={users}
                  actor={{ username: user?.username || '', role: user?.role || 'contributor' }}
                  canEdit={isAdmin && ws.can_manage}
                  onSaved={(uus) => {
                    // Uus kaart tuleb serverilt: kirjuta rida üle, ära laadi
                    // kogu loendit uuesti (see sulgeks paneeli).
                    setSets(prev => prev.map(s => (s.id === uus.id ? uus : s)));
                  }}
                />
              )}
```

**NB:** `WorkSetAccessPanel` hoiab mustandit oma olekus ja initsialiseerib
selle `ws.access`-ist ainult mount'il. Kui `onSaved` kirjutab `sets`-i uue
objekti, jääb paneel monteerituks ja mustand ei lähtestu — see ongi soovitud.
Kui vahetad kogu (`accessOpenId` muutub), monteerib React uue paneeli, sest
`key` erineb. Anna `key={ws.id}` selgesõnaliselt, et see oleks lubadus, mitte
juhus:

```tsx
                <WorkSetAccessPanel key={ws.id} ... />
```

- [ ] **Samm 3: kogu loomise järel on paneel kohe kättesaadav**

Otsi kogu loomise käitleja (`newName` kasutus) ja lisa loomise järele:

```tsx
      // Spekk §2: „Kogu loomise järel on sama paneel kohe kättesaadav."
      setAccessOpenId(loodud.id);
```

kus `loodud` on `createWorkSet`-i tagastus. Kui praegune kood tagastust ei
kasuta, võta see kasutusele — ÄRA otsi kogu ID-d hiljem nime järgi.

- [ ] **Samm 4: typecheck, testid, lint**

```bash
npm run typecheck
npm test
npm run lint:ci
```
Oodatud: PASS; lint ≤ 44 hoiatust. Kui lisandus uusi `react-hooks` hoiatusi,
paranda need — läve EI tõsteta.

- [ ] **Samm 5: commit**

```bash
git add src/pages/admin/WorkSets.tsx
git commit -m "feat(work-sets): ligipääsupaneel avaneb kogu juures (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 4: „Lähtesta valik" ligipääsu kadumisel

**Failid:**
- Muuda: `src/pages/Dashboard.tsx:669-680` (veaplokk)
- Muuda: `src/locales/{et,en}/dashboard.json`

**Kontekst:** `useSelectionScope` annab 403/404 korral `error`-i ja `ready:
false`. ADR 0042: seda EI tõlgendata tühja kogu ega piiramata otsinguna.
Praegu näeb kasutaja veateadet ilma väljapääsuta — tegevus peab olema
KASUTAJA oma, mitte vaikne tagasilangus.

**Liidesed:**
- Tarbib: `useCollection().setSelection` (`CollectionContext`).

- [ ] **Samm 1: lisa i18n võtmed MÕLEMASSE keelde**

`src/locales/et/dashboard.json`, `error` objekti sisse:

```json
"selectionLost": "Sul ei ole enam ligipääsu valitud töökollektsioonile.",
"resetSelection": "Lähtesta valik"
```

`src/locales/en/dashboard.json`:

```json
"selectionLost": "You no longer have access to the selected work set.",
"resetSelection": "Reset selection"
```

- [ ] **Samm 2: (kontrollitud ette) ühikkatet siia EI tule**

`vitest.config.ts:6` seab `environment: 'node'` ja `package.json`-is ei ole
`@testing-library/react` ega `jsdom`-i — projektis ei ole ühtki
komponendirenderduse testi, kõik 104 testifaili on loogikatestid.

**Selle taski jaoks EI lisata uut testiteeki.** Muudatus on kaks tingimuslikku
JSX-haru ja üks `onClick` — siit ei ole midagi mõistlikku eraldi puhtasse
funktsiooni tõsta (`visible = scopeError !== null` ümber kirjutatud test oleks
testiteater, mitte valvur). Juhtmestus kontrollitakse brauseris (etapi lõpu kontrollnimekiri)
ja see on selle taski ainus tõend.

Taski ainus regressioonikaitse koodis on NEGATIIVNE nõue, mida hoiab
ülevaatus, mitte test: Dashboardis EI TOHI olla `useEffect`-i, mis
`scopeError` peale ise `setSelection`-it kutsub.

- [ ] **Samm 3: lisa tegevus Dashboardi veaplokki**

`src/pages/Dashboard.tsx` veaplokk (praegu rida ~669) — lisa `scopeError`
korral nupp. Võta `setSelection` kontekstist:

```tsx
  const { setSelection } = useCollection();
```

(kontrolli, kas `useCollection()` on juba destruktureeritud — lisa nimi
olemasolevasse reale, ära tee teist kutset).

```tsx
          {(error || scopeError) && (
            <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-r shadow-sm flex items-start gap-3">
              <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={20} />
              <div>
                <h3 className="font-bold text-red-800">{t('error.connectionError')}</h3>
                <p className="text-sm text-red-700 mt-1">{error || scopeError?.message}</p>
                {scopeError ? (
                  <>
                    <p className="text-sm text-red-700 mt-1">{t('error.selectionLost')}</p>
                    <button
                      type="button"
                      className="mt-2 rounded bg-red-600 px-3 py-1.5 text-sm text-white"
                      onClick={() => setSelection({ kind: 'all' })}
                    >
                      {t('error.resetSelection')}
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-red-600 mt-2">{t('error.httpsWarning')}</p>
                )}
              </div>
            </div>
          )}
```

**NB:** `setSelection({ kind: 'all' })` on ainus üleminek. Ära lisa
`useEffect`-i, mis teeks seda automaatselt — vaikne üleminek annaks piiramata
päringu, mille vastu ADR 0042 hoiatab, ja kaks tingimusteta peeglit URL-i ja
konteksti vahel annaksid tsükli (ADR 0038, #333).

- [ ] **Samm 4: typecheck, testid, lint**

```bash
npm run typecheck
npm test
npm run lint:ci
```

- [ ] **Samm 5: commit**

```bash
git add src/pages/Dashboard.tsx src/locales/et/dashboard.json src/locales/en/dashboard.json
git commit -m "feat(work-sets): ligipääsu kadumisel pakutakse valiku lähtestust (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

## Etapi lõpp: väravad, brauserikontroll, juurutus

- [ ] **Samm 1: kõik väravad**

```bash
npm run typecheck
npm test
npm run lint:ci
npm run build
.venv/bin/pytest tests/ -q   # server ei muutunud, aga lepingud peavad kehtima
```

- [ ] **Samm 2: brauseris, MÕLEMAS keeles**

Tootmises on üks elav kogu `ws_8y7q1j`, milles on kaks pärandkirjet
(`meelis` superadmin, `tefriedenthal` admin) — need on head testandmed.

- Admin avab kogu juures „Ligipääs": pärandkirjed on märkega „Õigus tuleneb
  rollist", rolli valikut neil ei ole.
- Admin lisab inimese, muudab teise rolli, eemaldab kolmanda — **ükski
  päring ei lähe enne „Salvesta muudatused" vajutamist** (vaata võrgukaarti).
- „Loobu" taastab laetud oleku.
- Salvestuse järel: pärandkirjed on ALLES (server oleks nende väljajätmise
  403-ga tagasi lükanud — kui saad 403, on klient kaardi kuskil filtreerinud).
- Kaks brauseriakent samas kogus: teine salvestus annab 409, teade ilmub,
  automaatset kordussaatmist EI toimu, esimese töö säilib.
- Avalik kogu: selgitus ilmub, määrangud jäävad muudetavaks.
- Arhiveeritud kogu: õigused nähtavad ja muudetavad.
- Kogu loomine → paneel on kohe avatud.
- Haldur (mitte-admin, `manager` kirjega): näeb kaarti lugemisvaates, ei näe
  otsingut ega üldloendit. **Kontrolli võrgukaardilt, et `/admin/users`
  päringut EI tehta.**
- Kasutajavaates (`/admin` → Kasutajad) kajastub muutus pärast uuesti laadimist.
- Töökollektsiooni valik, mille õigus ära võetakse → Dashboardil veateade +
  „Lähtesta valik"; enne vajutust ei muutu päring piiramata korpuse päringuks.

- [ ] **Samm 3: PR**

```bash
git push -u origin feat/kogude-ligipaasupaneel-1b
gh pr create --base main --title "Etapp 1b: töökollektsiooni ligipääsupaneel (#318)" --body "..."
```

- [ ] **Samm 4: juurutus (ainult frontend)**

1b ei muuda serverit. Backendi EI ole vaja uuesti ehitada:

```bash
npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/
```

`--delete` on tahtlik; `.br`/`.gz` failid PEAVAD kaasa minema (nginx serveerib
need `brotli_static`/`gzip_static` kaudu).

---

## Väljaspool etappi 1b

- **2** — `PUT /admin/collections/{id}` `allowed_users` haru eemaldamine +
  `CollectionEditor` üleviimine 1a delta-toimingule
  (`POST /admin/users/collection-rights`), `GET /admin/collections/{id}/users`
  laiendus (`edit_users`, `visibility`, `is_virtual`), kollektsioonide loend
  adminile, superadmini seadete eraldamine.
- **3** — otsitav kasutajanimekiri, `/admin/users/:username` detail,
  `/admin/users/activity` (#318 viimane muudatus).
- **4** — ühine „Kogud" sisenemiskoht.
