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

### 2. Seadete leht `/settings`

Uus leht kasutab olemasolevat `Header` komponenti.

**Sektsioonid:**

**Kasutajaliides**
- Keel: toggle `Eesti` / `English` — kirjutab `i18n.changeLanguage()`, asendab `LanguageSwitcher` funktsionaalsuse (LanguageSwitcher jääb header'isse redundantsena alles)

**Workspace**
- Vaikimisi tab: toggle `Muutmine` / `Info & annotatsioonid`
- Salvestamine: `localStorage` võti `vutt_workspace_default_tab = "edit" | "info"`
- Rakendub koheselt, ilma eraldi "Salvesta" nuputa

Lahendab GitHub issue #10.

### 3. Admin avaleht `/admin` + sub-route'id

Admin leht muutub **avaleheks kaartidega**. Praegused tabid saavad oma sub-route'id. Olemasolevad eraldi lehed saavad lingi avalehelt.

**Kaardid ja marsruudid:**

| Kaart | Ikoon | Grupp | Sihtkoht |
|-------|-------|-------|----------|
| Taotlused | `UserPlus` | `indigo-700` | Kasutajad | `/admin/registrations` (uus) |
| Registreerunud kasutajad | `Users` | `blue-600` | Kasutajad | `/admin/users` (uus) |
| Laadi üles | `Upload` | `teal-600` | Sisu | `/upload` (olemasolev) |
| Kollektsioonid | `Library` | `violet-600` | Seadistus | `/admin/collections` (uus) |
| Muudatused | `History` | `amber-600` | Töövoog | `/review` (olemasolev) |
| Prügikast | `Trash2` | `rose-600` | Sisu | `/admin/trash` (uus) |

**Kaardi visuaalne stiil:** valge taust, `border border-gray-200`, `rounded-lg`, hover shadow. Ikoonid sektsiooni värviga (vt tabel). Aktiivsed taotlused: count tekst `text-red-600`.

**Navigatsioon sub-lehtedel:** breadcrumb `Admin → [Sektsioon]`.

**Kasutajate tab — muutused:**
- Eemaldatakse "Isikute register" sektsioon (prosopograafia uuendus toimub serveris cronjobina, manuaalne trigger pole vajalik).

### 4. Workspace päis

Workspace kasutab jagatud `UserMenu` komponenti oma kompaktses päises. Workspace'i oma `showUserMenu` state ja menüü JSX eemaldatakse.

---

## Mõjutatud failid

| Fail | Muudatus |
|------|---------|
| `src/components/UserMenu.tsx` | **Luuakse** — eraldatakse Header.tsx-ist |
| `src/components/Header.tsx` | Asendatakse inline menüü `<UserMenu />` komponendiga |
| `src/pages/Workspace.tsx` | Asendatakse duplikaat-menüü `<UserMenu />` komponendiga |
| `src/pages/Settings.tsx` | **Luuakse** — keel + workspace tab eelistus |
| `src/pages/Admin.tsx` | Muudetakse avaleheks kaartidega; eemaldatakse tabid ja "Isikute register" |
| `src/pages/admin/Registrations.tsx` | **Luuakse** — praeguse "Taotlused" tabi sisu |
| `src/pages/admin/Users.tsx` | **Luuakse** — praeguse "Kasutajad" tabi sisu (ilma Isikute registrita) |
| `src/pages/admin/Trash.tsx` | **Luuakse** — praeguse "Prügikast" tabi sisu |
| `src/pages/admin/Collections.tsx` | **Luuakse** — praeguse "Kollektsioonid" tabi sisu |
| `src/App.tsx` | Lisa route'id: `/settings`, `/admin/registrations`, `/admin/users`, `/admin/trash`, `/admin/collections` |
| `src/locales/et/common.json` | Lisa tõlked: `nav.settings`, `settings.*` |
| `src/locales/en/common.json` | Lisa tõlked: `nav.settings`, `settings.*` |

---

## Otsused ja põhjendused

**Miks Isikud menüüst eemaldatakse:** Isikud on sisuvaade, mitte konto-toiming. Ligipääs jääb läbi sisu (isiku lingid → `/persons/`) — UI ei lähe koormamaks.

**Miks Muudatused jääb menüüsse (mitte ainult Admin alla):** Editorid kasutavad seda peamiselt isikliku tööajaloo vaatamiseks ("kus jätsin pooleli"). See on töövoo, mitte admin-funktsioon.

**Miks Admin saab avalehe mitte külgriba:** Iga admin-sektsioon on iseseisev üksus. Külgriba tähendaks et admin-navigatsioon on alati nähtaval — avalehe + breadcrumb mudel on puhtam ja skaleerub paremini uute sektsioonidega.

**Miks Seaded on eraldi leht (mitte ainult dropdown toggle):** Seadeid tuleb tõenäoliselt juurde. Ühe togglega leht on nüüd kergelt ülepaisutatud, aga keele lisamine annab mõistliku mahu ja loob selge koha tulevasteks seadeteks.

**Settings vs inline toggle:** Keel lisatakse Seadete lehele (redundantselt — LanguageSwitcher jääb header'isse), et leht ei tunduks tühja. Tulevikus võib LanguageSwitcher header'ist eemaldada.

---

## Väljaspool skoopi

- Isikute osa põhjalikum läbitöötamine (eraldi teema)
- Muudatused lehe sisu refaktoring (praegu toimiv)
- Pending-edit / contributor rolli süsteem (eraldi otsus)
