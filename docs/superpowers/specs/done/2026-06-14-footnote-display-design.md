# Joonealuste märkuste esitus — disain

**Kuupäev:** 2026-06-14
**Staatus:** kavand (ootab kasutaja kinnitust)

## Taust ja eesmärk

Joonealused märkused koosnevad varauusaegses tekstis kahest osast: **viide-markerist** jooksvas tekstis (superscript number või täht) ja **kehatekstist** lehekülje all. Praegu on süsteemis kaks sidumata mehhanismi:

- Editoris `<fn>N</fn>` — ainult superscript-marker (`FootnoteWidget`), kehateksti pole.
- `MarkdownPreview.tsx` tunneb `[^N]` viite ja `[^N]: tekst` definitsiooni (markdown-stiil).

Kasutaja soovib, et joonealune käituks marginaalia-laadselt, **AGA kuvaks kehad lehekülje all** (mitte servas). Erinevus marginaaliast on põhimõtteline: joonealusel on kaks osa (inline-marker + keha), ja kuva on **kogutud lehe alla**, mitte rea kõrvale.

**Mudeli treening määrab andmemudeli.** Kasutaja treenib transkriptsioonimudelit. Marginaaliad oskab mudel jooksvalt teksti sisse panna. Joonealust **ei** suuda mudel usaldusväärselt markeri ja keha kaupa seostada, seega:

- **Kasutaja** paneb käsitsi markerid `<fn>N</fn>` jooksvasse teksti.
- **Mudel** transkribeerib joonealuste **kehad lehekülje lõppu** kokkulepitud formaadis (`[^N]: tekst`), mida me defineerime ja millele mudelit treenitakse.

**Failiformaat (transkriptsioonitekst) on selle kihi allikas.** Markerid ja kehad elavad dokumenditekstis; kõik muudatused on esitus-/interaktsioonikihis ning loomis-/navigeerimisloogikas.

**Greenfield — migratsiooni pole.** Joonealuseid pole praegu tegelikult märgendatud: kasutaja on pannud käsitsi rea sisse markeri-märgi (ilma `<fn>`-ta) ja lehe lõppu nn joonealused (ilma `[^N]:`-ta) puhta tekstina. St olemasolevat `<fn>`/`[^N]:` andmestikku, mida migreerida, ei ole, ja `FootnoteWidget`/`MarkdownPreview` rajad on joonealuste jaoks praktikas kasutamata. Uus formaat tuleb kasutusele edaspidi (mudeli väljund + kasutaja markerid).

## Vastuvõetud otsused

| Otsus | Valik | Tagasilükatud alternatiivid |
|---|---|---|
| Andmemudel | Variant 2: marker `<fn>N</fn>` + eraldi keha `[^N]:` | Keha tägi sees `<fn>tekst</fn>` (mudel ei seostaks markerit ja keha) |
| Keha-formaat | Markdown `[^N]:` esireal, **mitmerealine** (jätk toorridadel kuni järgmise `[^M]:`/`<pb/>`/doc lõpuni) | Ühe rea keha (ei mahuta rea-fidelity't); `<fndef>` tägi (verboossem); `[FOOTNOTES]` päis (üleliigne) |
| Token | **Üks keskne SOURCE-string** `FN_TOKEN_SOURCE = [^\[\]\s<>:]+`, millest ehitatakse **ankurdatud** liit-regexid (`FN_TOKEN_RE`, `FN_MARKER_RE`, `FN_BODY_START_RE`) — number, täht VÕI sümbol (`1`, `a`, `*`, `†`, `(a)`); välistab `[ ] < > :` ja tühiku. Sama allikas markeris, kehas, preview's ja testides | Lahknevad / ankurdamata regexid (osavasted; editor lubab üht, preview teist) |
| Marker-renderdus | Peidetud `<fn>`/`</fn>` tägid + superscript-stiilis **redigeeritav** token-sisu | Opaakne replace-widget (token pole inline redigeeritav) |
| Keha-prefiks-renderdus | `[^` ja `]:` peidetakse, **token ise jääb nähtavaks ja redigeeritavaks**; tokeni järel **dekoratiivne** label-sufiks (CSS `::after`, nt `. `) — MITTE dokumendisisu. `[^*]: märkus` → `*. märkus`, kus `*` on dokumendi tekst, `.` dekoratiivne | Kogu prefiks widget'iks (token ei oleks redigeeritav); punkt dokumenti (lõhuks toorteksti) |
| Mismatch & mitmekordne viide | Mitmekordne viide samale joonealusele EI ole toetatud (YAGNI) → sama tokeniga mitu markerit/keha segmendis on **teadlikult duplikaat** (CSS `vutt-fn-duplicate`), mitte tundmatu viga. Lisaks `vutt-fn-unmatched`: marker ilma kehata / keha ilma markerita. EI auto-paranda; navigeerimine deterministlik (esimene vaste segmendis) | Auto-parandus (ohtlik); vaikne ignoreerimine |
| Valik üle `<pb/>` | Util tagastab no-op/error; tööriistariba ei tee midagi (väike teade) | „Jooksva segmendi lõpp" oleks mitmemõtteline → vale paigutus |
| Skoop | **Lehekülje-põhine**: `<pb/>` piiritleb segmente; nummerdus/seos/loomine segmendi sees | Dokumendi-põhine (eksib topeltlehel; ei vasta ajaloolisele lehe-kaupa nummerdusele) |
| Loomine valikust | Selekteeri → marker valiku kohale + tekst liigub jooksva segmendi joonealuste **tsooni lõppu** (viimase keha järele; tsooni puudumisel `<pb/>` ette) `[^N]:`-na | Praegune (kustutab valitud teksti — bug) |
| Loomine ilma valikuta | Marker kursorile + **tühi `[^N]:` stub** tsooni lõppu (koht käsitsi sisestamiseks); kui sama lehe markerita keha juba olemas → seo selle külge, stubi ei loo | Ainult marker (kasutaja teeb sageli markeri enne ja täidab keha pärast) |
| Keha redaktsioon | Variant 1: kohapeal vormistatud (`[^N]:` read jäävad vooluses, stiliseeritud, otse redigeeritavad) | Marginaalia-stiilis avatav popup (kohmakas mitmerealise rea-täpse keha jaoks) |
| Rea-vastavus | Keha sisemised reavahetused säilivad muutumatult; renderdus ei reflow'i | — |
| Liigutatavus | Marker on dokumenditekst → cut/paste töötab; number kantakse kaasa (semantiline, allikast) | Auto-ümbernummerdus (YAGNI; number on allikast) |

## Andmemudel ja formaat

**Keskne token-allikas + komponeeritud regexid** (`footnoteUtils`, kasutatakse KÕIKJAL — marker, keha, preview, testid). Token defineeritakse **SOURCE-stringina** ja liit-regexid ehitatakse sellest **ankurdatult** (väldib osavasteid, nt `abc def` → `abc`):
```ts
export const FN_TOKEN_SOURCE = String.raw`[^\[\]\s<>:]+`;        // number, täht või sümbol; ei sisalda [ ] < > : ega tühikut
export const FN_TOKEN_RE     = new RegExp(`^${FN_TOKEN_SOURCE}$`, 'u');           // terve token (validatsioon)
export const FN_MARKER_RE    = new RegExp(`<fn>(${FN_TOKEN_SOURCE})</fn>`, 'gu'); // marker dokumendis
export const FN_BODY_START_RE = new RegExp(String.raw`^\[\^(${FN_TOKEN_SOURCE})\]:`, 'u'); // keha-rea algus
```

**Marker (jooksvas tekstis):** `<fn>N</fn>`, kus `N` vastab `FN_TOKEN_SOURCE`-ile (`FN_MARKER_RE`). Renderdub superscriptina; `<fn>`/`</fn>` tägid peidetakse (`vutt-hidden-tag`, atomic) ja **token-sisu jääb redigeeritavaks** (mark-põhine, nagu `<i>`/`<hi>`), nii et sümbolit saab otse trükkida.

**Keha (lehekülje all):**
```
[^a]: esimene rida
mitmerealine jätk säilib
[^b]: teine märkus
<pb/>
[järgmise lehe peatekst <fn>a</fn> ...]
[^a]: selle lehe esimene märkus
```

- **Joonealuste tsoon (selge parseri-reegel):** segmendis **esimene `FN_BODY_START_RE`-le vastav rida alustab joonealuste tsooni**; sellest reast kuni segmendi lõpuni (`<pb/>` või doc lõpp) käsitletakse KÕIK read joonealuste alana. Tsoonis: iga `[^M]:` rida alustab uut keha; ülejäänud (mitte-marker) read — **sh tühjad read** — on jooksva keha **jätk** (mitmerealine, reavahetused säilivad). Tühi rida **enne** esimest `[^N]:` jääb peateksti osaks. Kui pärast joonealuseid tuleb veel peateksti, on see kasutaja/mudeli **struktuuriviga** (parandatav käsitsi), MITTE parseri probleem — parser käsitleb seda keha jätkuna. See teeb dekoratsiooni ennustatavaks.
- **Lehekülje-skoop:** dokument jaguneb `<pb/>`-de järgi segmentideks. Marker ↔ keha seos, „järgmine vaba token" ja loomine arvutatakse **segmendi piires**. `[^a]` lk 1-l ja `[^a]` lk 2-l on erinevad märkused.

## Käitumine

### Loomine (tööriistariba „joonealune" nupp)

- **Valikuga:** asenda valik markeriga `<fn>N</fn>` valiku alguskohas; lisa valitud tekst **olemasoleva joonealuste tsooni lõppu** (viimase keha järele; tsooni puudumisel segmendi lõppu, `<pb/>` ette) reana `[^N]: <valitud tekst>`. `N` = jooksva segmendi järgmine vaba token. Valitud teksti sisemised reavahetused säilivad.
- **Ilma valikuta:** sisesta kursorile `<fn>N</fn>` + lisa **tühi `[^N]: ` stub** tsooni lõppu. Erand: kui segmendis on juba **markerita keha** (nt mudeli väljund), seo uus marker selle külge ja stubi EI looda.
- **„Järgmine vaba token":** kui segmendis on markerita kehi → võta **esimene markerita keha dokumendi järjekorras** (seob mudeli väljundiga lugemisjärjekorras). Muidu **väikseim vaba positiivne täisarv** (markerites/kehades puuduv). Token on vaikimisi numbriline; sümboli/tähe (`*`, `(a)`) trükib kasutaja otse markerisse ja vastavasse `[^…]:` reasse. **Eeldus:** markerid lisatakse markerita kehadele üldjuhul **lugemisjärjekorras**; käsitsi erijuhul muudab kasutaja tokenit ise (väldib üleinsenerdamist).
- **Valik üle `<pb/>`:** kui valik sisaldab `<pb/>`-d, on „jooksev segment" mitmemõtteline → util tagastab **no-op/error**, tööriistariba ei tee midagi (võib näidata väikest teadet). (Testitav.)
- **Reavahetuste normaliseerimine stub'i/keha lisamisel:** `[^N]:` rida peab sattuma **omaette reale** — sisestusloogika tagab vajadusel `\n` ette (kui eelnev rida ei lõpe reavahetusega, nt `viimane rida<pb/>`) ja `\n` järele, et `<pb/>` jääks järgmisele reale. Tulemus:
  ```
  viimane peateksti rida
  [^1]: 
  <pb/>
  ```
  mitte `viimane peateksti rida[^1]: <pb/>`. Uus keha läheb **olemasolevate kehade järele**, mitte ette.

### Renderdus (CM6 dekoratsioonid)

- **Marker:** `<fn>`/`</fn>` peidetud (`vutt-hidden-tag`), token-sisu superscript-stiilis mark (`vutt-fn`, `vertical-align:super; font-size:~0.7em`) — **redigeeritav** (mitte widget). `renderVuttMarkup` (mobiil/preview) token-osa `\d+` → `FN_TOKEN_SOURCE` (`FN_MARKER_RE`).
- **Keha-prefiks:** `[^` ja `]:` peidetakse (`vutt-hidden-tag`, atomic); **token ise jääb nähtavaks ja redigeeritavaks** dokumenditekstina; tokeni järel **dekoratiivne label-sufiks** (CSS `::after`, nt `. ` — vaikimisi punkt+tühik) — **see EI ole dokumendisisu**. St toortekst `[^*]: märkus` → kuvas `*. märkus`, kus `*` on päris redigeeritav märk, `.` dekoratiivne. (Sufiksi täpne kuju — `1.`/`*.`/`(a).` vs ainult vahe — on stiili-detail; vaikimisi `.`+tühik.) Sama põhimõte mis markeril.
- **Keha-sektsioon:** väiksem font; segmendi esimese keha ees õhuke ülemine eraldusjoon (visuaalne „joonealused" tsoon). Mitmerealise keha jätkuread renderduvad sama stiiliga, **reavahetused säilivad** (ei reflow'i). `<pb/>` "── lk ──" jääb sektsiooni järele.
- **Mismatch-hoiatused** (ei auto-paranda): marker ilma kehata `.vutt-fn-unmatched`; keha ilma markerita `.vutt-fn-unmatched`; dubleeritud token segmendis `.vutt-fn-duplicate`. Kerge stiil (nt punktiir-allajoon / tuhm värv), et kasutaja viga märkaks.
- **Preview/page-scope (RANGE NÕUE):** `MarkdownPreview` ja `renderVuttMarkup` **ei tohi** anda `[^N]:` ridu dokumendiülesele markdown-footnote-parserile (nt remark-gfm). Joonealused renderdatakse **VUTT-loogikaga segmentide kaupa / rida-haaval**, et korduvad tokenid eri lehtedel ei jookseks kokku. (Praegune `MarkdownPreview` impl juhtub olema rida-haaval regex ilma linkimiseta — sobib; nõue jääb kehtima ka tuleviku-muudatustel.)
- Kehad on juba dokumendi vooluses õiges kohas → **overlay/`coordsAtPos` pole vaja** (lihtsam kui marginaalia).

### Interaktsioonid

- Klikk markeril `<fn>N</fn>` → keri jooksva **segmendi** `[^N]:` kehale + lühike esiletõst. **Deterministlik:** sihiks esimene vaste samas segmendis (dubl. korral).
- Klikk keha numbril → keri segmendi esimesele `<fn>N</fn>` markerile.
- Marker liigutatav/kopeeritav: `<fn>token</fn>` on dokumenditekst (peidetud tägid atomic `vutt-hidden-tag`-ina, token redigeeritav superscript) → cut/copy/paste töötab tavatekstina; token kantakse kaasa.

## Arhitektuur ja failid

| Fail | Muudatus |
|---|---|
| `src/utils/footnoteUtils.ts` (uus) | **`FN_TOKEN_SOURCE` + komponeeritud regexid**; KOGU positsiooni-/parsimisloogika puhaste funktsioonidena. Avalik API (CM6 ei leiuta reegleid uuesti): `parseFootnotes(docText)` → segmendid + markerid + kehad + mismatch'id; `getFootnoteDecorationsInput(...)` → dekoratsiooni-sisendid (vahemikud, klassid); `createFootnoteFromSelection(...)` ja `createFootnoteFromCursor(...)` → muudatus-spec'id (stub, reavahetuse-normaliseerimine, valik-üle-`<pb/>` → no-op). Unit-testitavad. |
| `src/components/editor/FootnoteExtension.ts` (uus) | CM6 laiendus: keha-prefiksi dekoratsioon (`[^`/`]:` peit + redigeeritav token-label + eraldusjoon), mismatch-stiilid, klikk-navigeerimine (`.vutt-fn` marker ↔ keha, deterministlik), loomis-käsud. |
| `src/components/editor/VuttMarkupExtension.ts` | `<fn>` widget'ist mark-põhiseks: `VUTT_TAGS` `{ tag: 'fn', useWidget: true }` → `{ tag: 'fn', cls: 'vutt-fn' }`; `FootnoteWidget` eemaldatakse (token redigeeritav). |
| `src/utils/renderVuttMarkup.ts` | `<fn>` token `\d+` → `FN_TOKEN_SOURCE`; `[^N]:` ridade segment-teadlik keha-renderdus (per rida, ilma dokumendiülese linkimiseta). |
| `src/components/MarkdownPreview.tsx` | NÕUE: `[^N]:` ei tohi minna dokumendiülesesse markdown-footnote-parserisse — per-rida/segment-teadlik renderdus; `FN_TOKEN_SOURCE` ühtlustamine kui vaja. |
| `src/components/editor/VuttTheme.ts` | `.vutt-fn` superscript-stiil; keha-token-label stiil. |
| `src/components/TextEditor.tsx` | Tööriistariba „joonealune" nupp kutsub loomis-käsu (asendab `insertAtCursor('<fn>1</fn>')`); valik-üle-`<pb/>` korral no-op/teade. |
| `src/index.css` | Keha-sektsiooni stiilid (token-label, väiksem font, eraldusjoon); `.vutt-fn-unmatched` / `.vutt-fn-duplicate` hoiatused. |

**Eraldatus (range):** `footnoteUtils.ts` = KOGU loogika (segmenteerimine, parsimine, positsiooniarvutus, loomis-spec'id, mismatch-tuvastus) ilma CM6-sõltuvuseta → testitav isoleeritult. `FootnoteExtension.ts` **ei leiuta parsimisreegleid ega positsiooniloogikat uuesti** — kutsub `parseFootnotes`/`getFootnoteDecorationsInput`/`createFootnote*` ja ainult **ehitab dekoratsioonid + dispatch'ib** muudatused. See hoiab hapra CM6-koodi õhukese ja loogika testitava.

## Testid

`src/utils/__tests__/footnoteUtils.test.ts`:
- `FN_TOKEN_RE`/`FN_MARKER_RE`/`FN_BODY_START_RE`: number, täht, sümbol (`*`, `†`, `(a)`); Unicode `†` koos `/u`-ga; tühik/`]`/`<`/`>`/`:` ei kuulu tokenisse; ankurdatus — `abc def` ei anna osavastet `abc`.
- Segmenteerimine `<pb/>` järgi (0, 1, mitu `<pb/>`).
- Joonealuste tsoon: esimene `[^N]:` alustab tsooni; keha lõpp järgmise `[^M]:`, `<pb/>` ja doc lõpu juures; mitmerealine keha (reavahetused säilivad); **tühi rida enne** esimest `[^N]:` jääb peatekstiks; **tühi rida tsoonis** kuulub jooksva keha jätku.
- Lehekülje-skoop: sama `[^a]` eri segmentides on eraldi (preview's ei jookse kokku).
- „Järgmine vaba token": esimene markerita keha dok-järjekorras; muidu väikseim vaba positiivne täisarv.
- Mismatch: marker ilma kehata; keha ilma markerita; duplikaat-marker samas segmendis; duplikaat-keha samas segmendis.
- `footnoteFromSelection`: marker õigesse kohta + keha tsooni lõppu (olemasolevate kehade järele); valiku reavahetused säilivad; `(a)`-token markeris ja kehas.
- `footnoteFromCursor`: marker + tühi `[^N]:` stub; erand — markerita keha olemas → seo, stubi ei loo; tühi `[^1]:` stub püsib parseris kehana.
- Reavahetuse-normaliseerimine: stub'i lisamine segmendis ilma lõpureavahetuseta (`rida<pb/>`) → `rida\n[^1]: \n<pb/>`.
- Valik üle `<pb/>` → no-op/error.

`FootnoteExtension.test.ts` (EditorState-põhine, marginaalia-testide mustris) — eriti hapra CM6-koha kontroll:
- `[^` ja `]:` on **atomic/hidden**, aga **token-range ise EI ole atomic** (redigeeritav).
- Tokeni muutmine `1` → `*` (markeris ja kehas) **ei lõhu dekoratsiooni** (parser/dekoratsioon taastub korrektselt).
- Markeris tokeni muutmine `1` → `*` tekitab **mismatch-hoiatuse** (`vutt-fn-unmatched`/`duplicate`) kuni keha token muudetakse samaks.
- Dekoratsioonide arv; klikk-navigeerimise sihtkoht (deterministlik esimene vaste); mismatch-klassid; loomis-käsk valikuga/ilma (stub).

## Skoobist väljas (YAGNI)

- Auto-ümbernummerdus / „nummerda järjekorras" abinupp (number on allikast).
- Sama numbri mitmekordne viide ühel lehel → seetõttu sama tokeniga mitu markerit segmendis on **teadlikult duplikaat** (`vutt-fn-duplicate`), mitte toetatud funktsioon.
- Sticky/eraldi joonealuste paneel (kehad on niigi all vooluses).
- Marginaalia-stiilis avatav popup keha jaoks.
- Markeri-keha sidumine peateksti vahel (eeldame joonealused lehe lõpus).
