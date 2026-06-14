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

## Vastuvõetud otsused

| Otsus | Valik | Tagasilükatud alternatiivid |
|---|---|---|
| Andmemudel | Variant 2: marker `<fn>N</fn>` + eraldi keha `[^N]:` | Keha tägi sees `<fn>tekst</fn>` (mudel ei seostaks markerit ja keha) |
| Keha-formaat | Markdown `[^N]:` esireal, **mitmerealine** (jätk toorridadel kuni järgmise `[^M]:`/`<pb/>`/doc lõpuni) | Ühe rea keha (ei mahuta rea-fidelity't); `<fndef>` tägi (verboossem); `[FOOTNOTES]` päis (üleliigne) |
| Token | **Üks keskne regex** `FN_TOKEN = /[^\[\]\s<>:]+/u` — number, täht VÕI sümbol (`1`, `a`, `*`, `†`, `(a)`); välistab `[ ] < > :` ja tühiku. Sama muster markeris, kehas, preview's ja testides | Lahknevad regexid (editor lubab üht, preview teist → tüütu vea-klass) |
| Marker-renderdus | Peidetud `<fn>`/`</fn>` tägid + superscript-stiilis **redigeeritav** token-sisu | Opaakne replace-widget (token pole inline redigeeritav) |
| Keha-prefiks-renderdus | `[^` ja `]:` peidetakse, **token ise jääb nähtavaks ja redigeeritavaks** (sama põhimõte mis markeril): `[^*]: märkus` → `*. märkus`, kus `*` on dokumendi tekst | Kogu prefiks widget'iks (token ei oleks redigeeritav → ei saaks `[^1]:` → `[^*]:` muuta) |
| Mismatch | EI auto-paranda; kerge visuaalne hoiatus (CSS `vutt-fn-unmatched` / `vutt-fn-duplicate`): marker ilma kehata, keha ilma markerita, dubl. token segmendis. Navigeerimine deterministlik (esimene vaste segmendis) | Auto-parandus (ohtlik); vaikne ignoreerimine (kasutaja ei märka viga) |
| Valik üle `<pb/>` | Util tagastab no-op/error; tööriistariba ei tee midagi (väike teade) | „Jooksva segmendi lõpp" oleks mitmemõtteline → vale paigutus |
| Skoop | **Lehekülje-põhine**: `<pb/>` piiritleb segmente; nummerdus/seos/loomine segmendi sees | Dokumendi-põhine (eksib topeltlehel; ei vasta ajaloolisele lehe-kaupa nummerdusele) |
| Loomine valikust | Selekteeri → marker valiku kohale + tekst liigub jooksva segmendi joonealuste **tsooni lõppu** (viimase keha järele; tsooni puudumisel `<pb/>` ette) `[^N]:`-na | Praegune (kustutab valitud teksti — bug) |
| Loomine ilma valikuta | Marker kursorile + **tühi `[^N]:` stub** tsooni lõppu (koht käsitsi sisestamiseks); kui sama lehe markerita keha juba olemas → seo selle külge, stubi ei loo | Ainult marker (kasutaja teeb sageli markeri enne ja täidab keha pärast) |
| Keha redaktsioon | Variant 1: kohapeal vormistatud (`[^N]:` read jäävad vooluses, stiliseeritud, otse redigeeritavad) | Marginaalia-stiilis avatav popup (kohmakas mitmerealise rea-täpse keha jaoks) |
| Rea-vastavus | Keha sisemised reavahetused säilivad muutumatult; renderdus ei reflow'i | — |
| Liigutatavus | Marker on dokumenditekst → cut/paste töötab; number kantakse kaasa (semantiline, allikast) | Auto-ümbernummerdus (YAGNI; number on allikast) |

## Andmemudel ja formaat

**Keskne token-regex** (`footnoteUtils`, kasutatakse KÕIKJAL — marker, keha, preview, testid):
```ts
export const FN_TOKEN = /[^\[\]\s<>:]+/u;   // number, täht või sümbol; ei sisalda [ ] < > : ega tühikut
// Marker:  <fn>(FN_TOKEN)</fn>
// Keha:    ^\[\^(FN_TOKEN)\]:
```

**Marker (jooksvas tekstis):** `<fn>N</fn>`, kus `N` vastab `FN_TOKEN`-ile. Renderdub superscriptina; `<fn>`/`</fn>` tägid peidetakse (`vutt-hidden-tag`, atomic) ja **token-sisu jääb redigeeritavaks** (mark-põhine, nagu `<i>`/`<hi>`), nii et sümbolit saab otse trükkida.

**Keha (lehekülje all):**
```
[^a]: esimene rida
mitmerealine jätk säilib
[^b]: teine märkus
<pb/>
[järgmise lehe peatekst <fn>a</fn> ...]
[^a]: selle lehe esimene märkus
```

- **Joonealuste tsoon (selge parseri-reegel):** segmendis **esimene `^\[\^(FN_TOKEN)\]:` rida alustab joonealuste tsooni**; sellest reast kuni segmendi lõpuni (`<pb/>` või doc lõpp) käsitletakse KÕIK read joonealuste alana. Tsoonis: iga `[^M]:` rida alustab uut keha; ülejäänud (mitte-marker) read on jooksva keha **jätk** (mitmerealine, reavahetused säilivad). Kui pärast joonealuseid tuleb veel peateksti, on see kasutaja/mudeli **struktuuriviga** (parandatav käsitsi), MITTE parseri probleem — parser käsitleb seda keha jätkuna. See teeb dekoratsiooni ennustatavaks.
- **Lehekülje-skoop:** dokument jaguneb `<pb/>`-de järgi segmentideks. Marker ↔ keha seos, „järgmine vaba token" ja loomine arvutatakse **segmendi piires**. `[^a]` lk 1-l ja `[^a]` lk 2-l on erinevad märkused.

## Käitumine

### Loomine (tööriistariba „joonealune" nupp)

- **Valikuga:** asenda valik markeriga `<fn>N</fn>` valiku alguskohas; lisa valitud tekst **olemasoleva joonealuste tsooni lõppu** (viimase keha järele; tsooni puudumisel segmendi lõppu, `<pb/>` ette) reana `[^N]: <valitud tekst>`. `N` = jooksva segmendi järgmine vaba token. Valitud teksti sisemised reavahetused säilivad.
- **Ilma valikuta:** sisesta kursorile `<fn>N</fn>` + lisa **tühi `[^N]: ` stub** tsooni lõppu. Erand: kui segmendis on juba **markerita keha** (nt mudeli väljund), seo uus marker selle külge ja stubi EI looda.
- **„Järgmine vaba token":** kui segmendis on markerita kehi → võta **esimene markerita keha dokumendi järjekorras** (seob mudeli väljundiga lugemisjärjekorras). Muidu **väikseim vaba positiivne täisarv** (markerites/kehades puuduv). Token on vaikimisi numbriline; sümboli/tähe (`*`, `(a)`) trükib kasutaja otse markerisse ja vastavasse `[^…]:` reasse.
- **Valik üle `<pb/>`:** kui valik sisaldab `<pb/>`-d, on „jooksev segment" mitmemõtteline → util tagastab **no-op/error**, tööriistariba ei tee midagi (võib näidata väikest teadet). (Testitav.)
- **Reavahetuste normaliseerimine stub'i/keha lisamisel:** `[^N]:` rida peab sattuma **omaette reale** — sisestusloogika tagab vajadusel `\n` ette (kui eelnev rida ei lõpe reavahetusega, nt `viimane rida<pb/>`) ja `\n` järele, et `<pb/>` jääks järgmisele reale. Tulemus:
  ```
  viimane peateksti rida
  [^1]: 
  <pb/>
  ```
  mitte `viimane peateksti rida[^1]: <pb/>`. Uus keha läheb **olemasolevate kehade järele**, mitte ette.

### Renderdus (CM6 dekoratsioonid)

- **Marker:** `<fn>`/`</fn>` peidetud (`vutt-hidden-tag`), token-sisu superscript-stiilis mark (`vutt-fn`, `vertical-align:super; font-size:~0.7em`) — **redigeeritav** (mitte widget). `renderVuttMarkup` (mobiil/preview) token-osa `\d+` → `FN_TOKEN`.
- **Keha-prefiks:** `[^` ja `]:` peidetakse (`vutt-hidden-tag`, atomic); **token ise jääb nähtavaks ja redigeeritavaks** dokumenditekstina, stiliseeritud number-labeliks (nt `*.`); järgnev kehatekst jääb tavatekstiks. St `[^*]: märkus` → `*. märkus`, kus `*` on päris redigeeritav märk (mitte widget). Sama põhimõte mis markeril.
- **Keha-sektsioon:** väiksem font; segmendi esimese keha ees õhuke ülemine eraldusjoon (visuaalne „joonealused" tsoon). Mitmerealise keha jätkuread renderduvad sama stiiliga, **reavahetused säilivad** (ei reflow'i). `<pb/>` "── lk ──" jääb sektsiooni järele.
- **Mismatch-hoiatused** (ei auto-paranda): marker ilma kehata `.vutt-fn-unmatched`; keha ilma markerita `.vutt-fn-unmatched`; dubleeritud token segmendis `.vutt-fn-duplicate`. Kerge stiil (nt punktiir-allajoon / tuhm värv), et kasutaja viga märkaks.
- **Preview/page-scope:** `renderVuttMarkup` ja `MarkdownPreview` töötlevad `[^N]:` **per rida / segment-teadlikult** (mitte dokumendiülese markdown-footnote-parseriga) — korduvad tokenid eri lehtedel ei tohi kokku joosta. (`MarkdownPreview` on juba oma rida-haaval regex, ilma linkimiseta → ohutu; uus linkimine on segment-skoobis.)
- Kehad on juba dokumendi vooluses õiges kohas → **overlay/`coordsAtPos` pole vaja** (lihtsam kui marginaalia).

### Interaktsioonid

- Klikk markeril `<fn>N</fn>` → keri jooksva **segmendi** `[^N]:` kehale + lühike esiletõst. **Deterministlik:** sihiks esimene vaste samas segmendis (dubl. korral).
- Klikk keha numbril → keri segmendi esimesele `<fn>N</fn>` markerile.
- Marker liigutatav/kopeeritav: `<fn>token</fn>` on dokumenditekst (peidetud tägid atomic `vutt-hidden-tag`-ina, token redigeeritav superscript) → cut/copy/paste töötab tavatekstina; token kantakse kaasa.

## Arhitektuur ja failid

| Fail | Muudatus |
|---|---|
| `src/utils/footnoteUtils.ts` (uus) | **`FN_TOKEN`** keskne regex; segmenteeri `<pb/>` järgi; leia joonealuste tsoon + markerid + kehad segmendis; järgmine vaba token; mismatch-tuvastus (unmatched/duplicate); `footnoteFromSelection` ja `footnoteFromCursor` (stub, reavahetuse-normaliseerimine, valik-üle-`<pb/>` → no-op) spec'id. Unit-testitavad. |
| `src/components/editor/FootnoteExtension.ts` (uus) | CM6 laiendus: keha-prefiksi dekoratsioon (`[^`/`]:` peit + redigeeritav token-label + eraldusjoon), mismatch-stiilid, klikk-navigeerimine (`.vutt-fn` marker ↔ keha, deterministlik), loomis-käsud. |
| `src/components/editor/VuttMarkupExtension.ts` | `<fn>` widget'ist mark-põhiseks: `VUTT_TAGS` `{ tag: 'fn', useWidget: true }` → `{ tag: 'fn', cls: 'vutt-fn' }`; `FootnoteWidget` eemaldatakse (token redigeeritav). |
| `src/utils/renderVuttMarkup.ts` | `<fn>` token `\d+` → `FN_TOKEN`; `[^N]:` ridade segment-teadlik keha-renderdus (per rida, ilma dokumendiülese linkimiseta). |
| `src/components/MarkdownPreview.tsx` | Kontrolli/säilita per-rida `[^N]:` käitlus (juba ohutu — ei linki dokumendiüleselt); `FN_TOKEN` ühtlustamine kui vaja. |
| `src/components/editor/VuttTheme.ts` | `.vutt-fn` superscript-stiil; keha-token-label stiil. |
| `src/components/TextEditor.tsx` | Tööriistariba „joonealune" nupp kutsub loomis-käsu (asendab `insertAtCursor('<fn>1</fn>')`); valik-üle-`<pb/>` korral no-op/teade. |
| `src/index.css` | Keha-sektsiooni stiilid (token-label, väiksem font, eraldusjoon); `.vutt-fn-unmatched` / `.vutt-fn-duplicate` hoiatused. |

**Eraldatus:** `footnoteUtils.ts` = puhas loogika (segmenteerimine, parsimine, loomis-spec) ilma CM6-sõltuvuseta → testitav isoleeritult. `FootnoteExtension.ts` = ainult CM6-esitus + interaktsioon, tugineb utils'ile.

## Testid

`src/utils/__tests__/footnoteUtils.test.ts`:
- `FN_TOKEN`: number, täht, sümbol (`*`, `†`, `(a)`); Unicode `†` koos `/u`-ga; tühik/`]`/`<`/`>`/`:` ei kuulu tokenisse.
- Segmenteerimine `<pb/>` järgi (0, 1, mitu `<pb/>`).
- Joonealuste tsoon: esimene `[^N]:` alustab tsooni; keha lõpp järgmise `[^M]:`, `<pb/>` ja doc lõpu juures; mitmerealine keha (reavahetused säilivad).
- Lehekülje-skoop: sama `[^a]` eri segmentides on eraldi (preview's ei jookse kokku).
- „Järgmine vaba token": esimene markerita keha dok-järjekorras; muidu väikseim vaba positiivne täisarv.
- Mismatch: marker ilma kehata; keha ilma markerita; duplikaat-marker samas segmendis; duplikaat-keha samas segmendis.
- `footnoteFromSelection`: marker õigesse kohta + keha tsooni lõppu (olemasolevate kehade järele); valiku reavahetused säilivad; `(a)`-token markeris ja kehas.
- `footnoteFromCursor`: marker + tühi `[^N]:` stub; erand — markerita keha olemas → seo, stubi ei loo; tühi `[^1]:` stub püsib parseris kehana.
- Reavahetuse-normaliseerimine: stub'i lisamine segmendis ilma lõpureavahetuseta (`rida<pb/>`) → `rida\n[^1]: \n<pb/>`.
- Valik üle `<pb/>` → no-op/error.

`FootnoteExtension.test.ts` (EditorState-põhine, marginaalia-testide mustris): keha-token redigeeritav (mitte widget — dekoratsioon ei ole replace token-osal); dekoratsioonide arv; klikk-navigeerimise sihtkoht (deterministlik esimene vaste); mismatch-klassid; loomis-käsk valikuga/ilma (stub).

## Skoobist väljas (YAGNI)

- Auto-ümbernummerdus / „nummerda järjekorras" abinupp (number on allikast).
- Sama numbri mitmekordne viide ühel lehel.
- Sticky/eraldi joonealuste paneel (kehad on niigi all vooluses).
- Marginaalia-stiilis avatav popup keha jaoks.
- Markeri-keha sidumine peateksti vahel (eeldame joonealused lehe lõpus).
