# Navigatsiooni redesign — disainidokument

**Kuupäev:** 2026-03-25
**Olek:** Kasutaja poolt kinnitatud

---

## Kontekst ja motivatsioon

Praegune kasutajamenüü segab kolme erinevat asja ühte dropdown'i: sisunavigatsiooni (Isikud), töövoo lingid (Muudatused, Laadi üles) ja konto toimingud (Admin, Logout). Admin leht kasutab tabide mudelit mis ei skaleeru hästi — 6 sektsiooni tabidena muutub kohmakaks. Workspace'il on duplikaat-UserMenu kood, mitte jagatud komponent.

---

## Lahendus

### 1. UserMenu — eraldi komponent

`UserMenu` eraldatakse `Header.tsx`-ist omaette komponendiks `src/components/UserMenu.tsx`. Kasutatakse nii `Header`-is kui Workspace'i kompaktses päises — lahendab duplikaatkoodi.

**Uus menüüstruktuur (kõigile autentitud kasutajatele):**

| Kirje | Ikoon (Lucide) | Nähtavus | Sihtkoht |
|-------|---------------|----------|----------|
| Seaded | `Settings` | kõik | `/settings` |
| Muudatused | `History` | kõik | `/review` |
| *(eraldaja)* | | | |
| Admin | `Shield` | admin | `/admin` |
| *(eraldaja)* | | | |
| Logi välja | `LogOut` | kõik | — |

**Eemaldatakse:** Isikud (ligipääs jääb läbi sisu — isiku lingid viivad `/persons/` lehele nagu praegu).
**Eemaldatakse:** Laadi üles eraldi menüükirjena (kättesaadav Admin avalehe kaudu).

**Orbudeks jäävad tõlkevõtmed:** `common.json` võtmed `nav.upload` ja `nav.persons` eemaldatakse. `nav.persons` on ainult Header.tsx real 150. `nav.upload` on Header.tsx real 170 ja Workspace.tsx real 481 (Workspace'i inline menüü) — mõlemad eemaldatakse koos `<UserMenu />` refaktoriga. Pärast mõlemat muudatust on võtmed kasutamata.

### 2. Seadete leht `/settings`

Uus leht (`src/pages/Settings.tsx`) kasutab olemasolevat `Header` komponenti. Namespace: `settings` (uus i18next namespace, failid `src/locales/et/settings.json` ja `src/locales/en/settings.json`).

**Vajalikud tõlkevõtmed (mõlemas keeles):**

```
settings.ui.heading         — "Kasutajaliides" / "Interface"
settings.language.label     — "Keel" / "Language"
settings.workspace.heading  — "Workspace"
settings.workspace.defaultTab.label — "Vaikimisi tab" / "Default tab"
settings.workspace.defaultTab.description — "Milline tab avaneb teose avamisel" / "Which tab opens when opening a work"
settings.workspace.edit     — "Muutmine" / "Edit"
settings.workspace.info     — "Info & annotatsioonid" / "Info & annotations"
```

`common.json`-i lisatakse ainult: `nav.settings` — "Seaded" / "Settings".

**Sektsioonid:**

**Kasutajaliides**
- Keel: toggle `Eesti` / `English` — kirjutab `i18n.changeLanguage()` ja salvestab `localStorage`-i (`i18nextLng` — sama võti mida i18next juba kasutab). LanguageSwitcher jääb header'isse redundantsena alles.

**Workspace**
- Vaikimisi tab: toggle `Muutmine` / `Info & annotatsioonid`
- Salvestamine: `localStorage` võti `vutt_workspace_default_tab = "edit" | "info"`
- Rakendub koheselt, ilma eraldi "Salvesta" nuputa

**Workspace.tsx muudatused (issue #10 lahendus):**
`Workspace.tsx` desktopil **ei ole praegu tab-mudelit** — see on fikseeritud split-view (pilt vasakul, editor paremal). `WorkspaceMobileView.tsx`-il on tabs (`'image' | 'text' | 'info'`), aga need on teistsugused kui edit/info.

See tähendab et issue #10 lahendus nõuab esmalt desktop tab UI loomist:
1. Lisada tab-riba Workspace desktop vaatesse (`'edit' | 'info'`)
2. Conditional rendering: `edit` tab näitab editori, `info` tab näitab annotatsioone/metaandmeid
3. Tab algväärtus loetakse localStorage-ist: `localStorage.getItem('vutt_workspace_default_tab') ?? 'edit'`
4. Seadete leht kirjutab sama võtme

See on suurem muudatus kui esmapilgul tundus — tab UI loomine Workspace desktopile on eraldi komponentide töö. Implementeerija peab otsustama kas `'info'` tab näitab `AnnotationsTab` sisu, `MetadataModal` sisu, või mõlemat.

Lahendab GitHub issue #10.

### 3. Admin avaleht `/admin` + sub-route'id

Admin leht muutub **avaleheks kaartidega**. Praegused tabid saavad oma sub-route'id. Olemasolevad eraldi lehed (`/review`, `/upload`) saavad lingi avalehelt — navigeerimisel lahkutakse admin kontekstist (breadcrumb puudub, tavapärane back-navigatsioon piisab).

**Kaardid ja marsruudid:**

| Kaart | Ikoon | Ikooni värv | Grupp | Sihtkoht |
|-------|-------|-------------|-------|----------|
| Taotlused | `UserPlus` | `text-indigo-700` | Kasutajad | `/admin/registrations` (uus) |
| Registreerunud kasutajad | `Users` | `text-blue-600` | Kasutajad | `/admin/users` (uus) |
| Laadi üles | `Upload` | `text-teal-600` | Sisu | `/upload` (olemasolev, navigeerib välja) |
| Kollektsioonid | `Library` | `text-violet-600` | Seadistus | `/admin/collections` (uus) |
| Muudatused | `History` | `text-amber-600` | Töövoog | `/review` (olemasolev, navigeerib välja) |
| Prügikast | `Trash2` | `text-rose-600` | Sisu | `/admin/trash` (uus) |

**Kaardi visuaalne stiil:** `bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md cursor-pointer`. Ikooni värv vastavalt tabelile. Aktiivsete taotluste count: `text-red-600 font-medium`.

**Navigatsioon sub-lehtedel:** breadcrumb `Admin → [Sektsioon]` — link "Admin" viib tagasi `/admin`.

**Ligipääsukontroll sub-lehtedel:** Iga uus admin sub-leht (`Registrations.tsx`, `Users.tsx`, `Trash.tsx`, `Collections.tsx`) sisaldab sama rolli kontrollimise mustrit mis praegu `Admin.tsx`-is — redirect mittadminidele. Eraldi `ProtectedRoute` wrapperit ei looda (YAGNI).

**Admin tõlkevõtmed** — lisada `src/locales/et/admin.json` ja `src/locales/en/admin.json`:
```
admin.cards.registrations   — "Taotlused" / "Registrations"
admin.cards.users           — "Registreerunud kasutajad" / "Registered users"
admin.cards.upload          — "Laadi üles" / "Upload"
admin.cards.collections     — "Kollektsioonid" / "Collections"
admin.cards.changes         — "Muudatused" / "Changes"
admin.cards.trash           — "Prügikast" / "Trash"
admin.groups.users          — "Kasutajad" / "Users"
admin.groups.content        — "Sisu" / "Content"
admin.groups.settings       — "Seadistus" / "Settings"
admin.groups.workflow       — "Töövoog" / "Workflow"
```

**Kasutajate leht (`/admin/users`) — muutused:**
- Eemaldatakse "Isikute register" sektsioon (prosopograafia uuendus toimub serveris cronjobina).
- Backend endpointid `/admin/people-refresh` ja `/admin/people-refresh-status` jäävad `server/main.py`-sse alles — ainult UI trigger eemaldatakse.

**Kollektsioonid leht (`/admin/collections`) — andmelaadimine:**
Praeguses `Admin.tsx`-is laetakse kollektsioonid lazy — ainult kui `activeTab === 'collections'`. Uues `Collections.tsx`-is toimub laadimine `useEffect`-is lehe avamisel (sama loogika, uues kontekstis). Lihtne koodiekstraheerimine, ei nõua arhitektuurimuutust.

### 4. Workspace päis

Workspace kasutab jagatud `UserMenu` komponenti oma kompaktses päises. Workspace'i oma `showUserMenu` state ja menüü JSX eemaldatakse.

---

## Mõjutatud failid

| Fail | Muudatus |
|------|---------|
| `src/components/UserMenu.tsx` | **Luuakse** — eraldatakse Header.tsx-ist |
| `src/components/Header.tsx` | Asendatakse inline menüü `<UserMenu />` komponendiga; eemaldatakse `nav.upload`, `nav.persons` kasutus |
| `src/pages/Workspace.tsx` | (1) Asendatakse duplikaat-menüü `<UserMenu />` komponendiga; (2) `activeTab` algväärtus loetakse localStorage-ist |
| `src/components/mobile/WorkspaceMobileView.tsx` | Kui on eraldi tab state — sama localStorage algväärtus |
| `src/pages/Settings.tsx` | **Luuakse** — keel + workspace tab eelistus |
| `src/pages/Admin.tsx` | Muudetakse avaleheks kaartidega; eemaldatakse tabid ja "Isikute register" |
| `src/pages/admin/Registrations.tsx` | **Luuakse** — praeguse "Taotlused" tabi sisu + admin rolli kontroll |
| `src/pages/admin/Users.tsx` | **Luuakse** — praeguse "Kasutajad" tabi sisu ilma Isikute registrita + admin rolli kontroll |
| `src/pages/admin/Trash.tsx` | **Luuakse** — praeguse "Prügikast" tabi sisu + admin rolli kontroll |
| `src/pages/admin/Collections.tsx` | **Luuakse** — praeguse "Kollektsioonid" tabi sisu + admin rolli kontroll |
| `src/App.tsx` | Lisa route'id: `/settings`, `/admin/registrations`, `/admin/users`, `/admin/trash`, `/admin/collections` |
| `src/locales/et/common.json` | Lisa `nav.settings`; eemalda `nav.upload`, `nav.persons` |
| `src/locales/en/common.json` | Lisa `nav.settings`; eemalda `nav.upload`, `nav.persons` |
| `src/locales/et/settings.json` | **Luuakse** — kõik `settings.*` võtmed |
| `src/locales/en/settings.json` | **Luuakse** — kõik `settings.*` võtmed |
| `src/locales/et/admin.json` | Lisa `admin.cards.*` ja `admin.groups.*` võtmed |
| `src/locales/en/admin.json` | Lisa `admin.cards.*` ja `admin.groups.*` võtmed |

---

## Otsused ja põhjendused

**Miks Isikud menüüst eemaldatakse:** Isikud on sisuvaade, mitte konto-toiming. Ligipääs jääb läbi sisu (isiku lingid → `/persons/`) — UI ei lähe koormamaks.

**Miks Muudatused jääb menüüsse (mitte ainult Admin alla):** Editorid kasutavad seda peamiselt isikliku tööajaloo vaatamiseks ("kus jätsin pooleli"). See on töövoo, mitte admin-funktsioon. Admin avalehel on Muudatused kaardina samuti olemas — navigeerib `/review`-le välja admin kontekstist, mis on teadlik valik (ei vaja breadcrumb'i tagasi).

**Miks Admin saab avalehe mitte külgriba:** Iga admin-sektsioon on iseseisev üksus. Külgriba tähendaks et admin-navigatsioon on alati nähtaval — avalehe + breadcrumb mudel on puhtam ja skaleerub paremini uute sektsioonidega.

**Miks Seaded on eraldi leht (mitte ainult dropdown toggle):** Seadeid tuleb tõenäoliselt juurde. Ühe togglega leht on nüüd kergelt ülepaisutatud, aga keele lisamine annab mõistliku mahu ja loob selge koha tulevasteks seadeteks.

**Settings vs inline toggle:** Keel lisatakse Seadete lehele (redundantselt — LanguageSwitcher jääb header'isse), et leht ei tunduks tühja. Tulevikus võib LanguageSwitcher header'ist eemaldada.

**Miks sub-route'idel pole ühist ProtectedRoute wrapperit:** Praegune `Admin.tsx` käsitleb ligipääsu sisemiselt. Sama muster korratakse uutes sub-lehtedes. Eraldi wrapper lisatakse siis kui sub-lehtede arv kasvab või kui loogika muutub keerukamaks.

---

## Väljaspool skoopi

- Isikute osa põhjalikum läbitöötamine (eraldi teema)
- Muudatused lehe sisu refaktoring (praegu toimiv)
- Pending-edit / contributor rolli süsteem (eraldi otsus)
- LanguageSwitcher eemaldamine header'ist (võimalik tulevikus pärast Seadete lehe kasutuselevõttu)
