# 0086 — Ikoonisõnastik: üks mõiste = üks ikoon

**Staatus:** vastu võetud, teostatud (2026-11-20).

## Kontekst

Kasutajad kaebasid, et teose halduse lehekaardil oli redaktori nupp (pööra, kärbi, poolita)
sama ikooniga (`SquarePen`), mis töölaual tähendab tekstiannotatsiooni („Märgi ja kommenteeri").
Inventuur (lucide-react 0.554, 145 ikooni) näitas, et see ei ole üksikjuhtum:

- `SquarePen` tähendas kolme asja: annotatsioon, haldusvaate redaktor, upload'i redaktor.
- Lehe redaktorisse pääses kahe ikooniga (`SquarePen` halduses ja upload'is, `Scissors` töölaua pildivaates).
- „Muuda" oli nelja ikooniga (`Pencil`, `Edit3`/PenLine, `Edit2`/Pen, `FileSliders`), sama toiming
  (annotatsiooni kommentaari muutmine) popoveris `Pencil`-iga ja paneelis `Edit3`-ga.
- `Columns2` tähendas poolitust, eksemplaride kõrvutust ja marginaaliaveeru lülitit.
- `RotateCcw` tähendas „pööra vasakule" ja „taasta".
- Toimetaja tööriistaribal olid ääremärkus (`StickyNote`) ja annotatsioon (`SquarePen`) mõlemad
  nurgadetailiga ruudud, väikeses mõõdus eristamatud.

Ikoonid imporditi igas komponendis otse `lucide-react`-ist, nii et ükski koht ei kandnud tähendust.

## Otsus

1. **Üks mõiste = üks ikoon, üks ikoon = üks mõiste.** Tähendusega ikoonid elavad
   `src/components/icons.ts`-is semantilise nimega ja imporditakse AINULT sealt.
   Neutraalsed ikoonid (`X`, `Loader2`, `Chevron*`, `Check`, `Trash2`, `RefreshCw` …) tulevad
   endiselt otse lucide'ist.
2. **Pere = ühine alus, erinev tunnus.** Sama valdkonna ikoonid jagavad kuju, tunnus eristab:
   `MessageSquare*` = märkused, `PanelRight*` = marginaalia. Ikoon kirjeldab ASJA, mitte toimingut
   (annotatsioon on märkus tekstilõigu kohta, seepärast `MessageSquareQuote`, mitte `Highlighter`).
   Pere sees eristab vajadusel ka värv (annotatsioon kollane, lehe märge merevaik).
3. **Keelatud:** `SquarePen` (`Edit`, `PenBox`), `Pen` (`Edit2`), `PenLine` (`Edit3`), `PencilLine`.
   Need on üldised „muuda/kirjuta" variandid ja konkureeriksid igas tähenduses `Pencil`-iga —
   just nii sattus `SquarePen` redaktori nupuks.
4. **Valvur** `src/utils/__tests__/iconVocabularyGuard.test.ts`: sõnastiku lucide-nimesid ei
   impordita mujal kui `icons.ts`-is, keelatud nimesid ei kasutata kusagil (ka `…Icon` /
   `Lucide…` aliasena), `icons.ts` ekspordib täpselt valvuri `VOCABULARY` loendi.

### Sõnastik

| Mõiste | Ekspordinimi | Lucide |
|---|---|---|
| Muuda (kirje, tekst, kommentaar, nimi) | `EditIcon` | `Pencil` |
| Lehe märge, sõnum | `CommentIcon` | `MessageSquare` |
| Lisa lehe märge | `AddCommentIcon` | `MessageSquarePlus` |
| Tekstiannotatsioon (`<ann>`) | `TextAnnotationIcon` | `MessageSquareQuote` |
| Ääremärkus (lisa `<m>`) | `MarginaliaIcon` | `PanelRightDashed` |
| Marginaaliaveerg: klõps avab / sulgeb | `MarginaliaShowIcon` / `MarginaliaHideIcon` | `PanelRightOpen` / `PanelRightClose` |
| Märkmed (toimetaja vabatekst teosel/isikul) | `NotesIcon` | `StickyNote` |
| Ava lehe redaktor (pööre, kärbe, poolitus) | `PageEditorIcon` | `Scan` |
| Kärpetööriist, ootel kärbe | `CropIcon` | `Crop` |
| Perspektiiv | `PerspectiveIcon` | `Frame` |
| Lehe poolitus | `SplitIcon` | `Columns2` |
| Pööra vasakule / paremale | `RotateLeftIcon` / `RotateRightIcon` | `RotateCcw` / `RotateCw` |
| Eksemplaride kõrvutus | `CompareIcon` | `GalleryHorizontal` |
| Taasta (prügikastist, ajaloost, originaal) | `RestoreIcon` | `ArchiveRestore` |
| Lähtesta vaikeväärtustele | `ResetIcon` | `ListRestart` |
| Võta tagasi (viimane toiming) | `UndoIcon` | `Undo2` |

Lehe redaktor ja kärbe jagasid algul ikooni (`Crop`), põhjendusega, et redaktor avaneb
kärbitavana ja ootel-märgis kannab teksti. Täiendus 2026-11-20: see ei pidanud —
teose halduse lehekaardil on redaktori nupp ja ootel-märgise kärpeikoon kõrvuti all
servas ning loeti sama asjana. Redaktori nupp sai oma ikooni `Scan` (skaneeringu nurgad);
`Crop` tähendab nüüd AINULT kärbet (tööriist, ootel kärbe), nagu põhimõte nõuab.

### Töölaua tööriistariba rühmad

Rühmad järgivad küsimust „mida see märgendus allika kohta ütleb", vasakult paremale:

| Rühm | Nupud | Miks koos |
|---|---|---|
| Kiri | paks, kursiiv, fraktuur | kuidas tekst põhireal välja näeb |
| Reast väljas | lisandus (‸), ääremärkus, joonealune | tekst, mis asub mujal kui põhireal |
| Leht | lehevahetus, lehe tähistus (#) | lehe ülesehitus |
| Puhasta | eemaldab eelnevate rühmade märgenduse | annotatsiooni ei puuduta (`cleanMarkup: 'keep'`) |
| Toimetaja kiht | Ann | toimetaja kommentaar, mitte allika kirjeldus |
| Vaade (paremal, `ml-auto`) | marginaaliaveeru lüliti | vaate seadistus; ilmub ainult marginaaliaga lehel ega nihuta toimetamisnuppe |

Lisandus oli varem kirja rühmas, kuigi ta on reast väljas olev tekst, ja vaate lüliti
toimetamisnuppude järel. Uus nupp läheb rühma, mille küsimusele ta vastab.

## Tagajärjed

- Uus tähendusega ikoon: lisa `icons.ts`-i, siia tabelisse ja valvuri `VOCABULARY`-sse.
  Kui mõiste on olemas, kasuta olemasolevat nime — ära vali „sarnast" lucide'i ikooni.
- Sõnastiku lucide-ikooni ei saa kasutada teises tähenduses (nt `Columns2` „kõrvuti" jaoks):
  valvur kukub ja sundib otsustama, kas see on uus mõiste.
- `RotateCcw` „taasta" tähenduses ja „laadi" tähenduses (`WorkManage` prügikast, poolik upload)
  asendati vastavalt `RestoreIcon`-i ja `RefreshCw`-ga.
- Valvur ei kata neutraalseid ikoone ega tähendusi, mida tabelis pole; need võivad tulevikus
  vajada sama käsitlust.
