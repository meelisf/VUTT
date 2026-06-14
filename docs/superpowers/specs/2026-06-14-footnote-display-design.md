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
| Token | Suvaline mitte-tühik, mitte-`]`/`<`/`>` jada — number, täht VÕI sümbol: `[^1]`, `[^a]`, `[^*]`, `[^†]`, `[^(a)]` | Ainult `\w+` (varauusajas ka `*`, `†`, `(a)`) |
| Marker-renderdus | Peidetud `<fn>`/`</fn>` tägid + superscript-stiilis **redigeeritav** sisu (token on dokumenditekst) | Opaakne replace-widget (token pole inline redigeeritav → sümbolite trükkimine/muutmine kohmakas) |
| Skoop | **Lehekülje-põhine**: `<pb/>` piiritleb segmente; nummerdus/seos/loomine segmendi sees | Dokumendi-põhine (eksib topeltlehel; ei vasta ajaloolisele lehe-kaupa nummerdusele) |
| Loomine valikust | Selekteeri → marker valiku kohale + tekst liigub jooksva lehe `<pb/>` ette `[^N]:`-na | Praegune (kustutab valitud teksti — bug) |
| Loomine ilma valikuta | Marker kursorile + **tühi `[^N]:` stub** jooksva lehe `<pb/>` ette (koht käsitsi sisestamiseks); kui sama lehe markerita keha juba olemas → seo selle külge, stubi ei loo | Ainult marker (kasutaja teeb sageli markeri enne ja täidab keha pärast) |
| Keha redaktsioon | Variant 1: kohapeal vormistatud (`[^N]:` read jäävad vooluses, stiliseeritud, otse redigeeritavad) | Marginaalia-stiilis avatav popup (kohmakas mitmerealise rea-täpse keha jaoks) |
| Rea-vastavus | Keha sisemised reavahetused säilivad muutumatult; renderdus ei reflow'i | — |
| Liigutatavus | Marker on dokumenditekst → cut/paste töötab; number kantakse kaasa (semantiline, allikast) | Auto-ümbernummerdus (YAGNI; number on allikast) |

## Andmemudel ja formaat

**Marker (jooksvas tekstis):** `<fn>N</fn>`, kus `N` on token (mitte-tühik, mitte-`]`/`<`/`>` jada — number, täht või sümbol). Renderdub superscriptina; `<fn>`/`</fn>` tägid peidetakse ja **token-sisu jääb redigeeritavaks** (mark-põhine, nagu `<i>`/`<hi>`), nii et sümbolit saab otse trükkida. Jagatud token-regex (`footnoteUtils`) markeri ja keha jaoks.

**Keha (lehekülje all):**
```
[^a]: esimene rida
mitmerealine jätk säilib
[^b]: teine märkus
<pb/>
[järgmise lehe peatekst <fn>a</fn> ...]
[^a]: selle lehe esimene märkus
```

- Keha algab reaga mustriga `^\[\^([^\]\s]+)\]:` (token = mitte-`]`/mitte-tühik jada, sama mis marker) ja **ulatub** kuni järgmise sellise reani **VÕI järgmise `<pb/>`-ni** VÕI dokumendi lõpuni.
- **Lehekülje-skoop:** dokument jaguneb `<pb/>`-de järgi segmentideks. Marker ↔ keha seos, „järgmine vaba token" ja loomine arvutatakse **segmendi piires**. `[^a]` lk 1-l ja `[^a]` lk 2-l on erinevad märkused.
- **Eeldus:** segmendi sees on järjekord `[peatekst][joonealused][<pb/>]` — joonealused on lehe viimased read, markeri ja keha vahel peateksti ei eeldata.

## Käitumine

### Loomine (tööriistariba „joonealune" nupp)

- **Valikuga:** asenda valik markeriga `<fn>N</fn>` valiku alguskohas; lisa valitud tekst **jooksva segmendi lõppu** (selle lehe `<pb/>` ette, või doc lõppu kui viimane leht) reana `[^N]: <valitud tekst>`. `N` = jooksva segmendi järgmine vaba number. Valitud teksti sisemised reavahetused säilivad.
- **Ilma valikuta:** sisesta kursorile `<fn>N</fn>` + lisa **tühi `[^N]: ` stub** jooksva segmendi lõppu (koht, kuhu kasutaja keha käsitsi trükib/kleebib). Erand: kui segmendis on juba **markerita keha** (nt mudeli väljund), seo uus marker selle külge ja stubi EI looda.
- „Järgmine vaba" = madalaim markerita keha token, kui selliseid on (seob mudeli väljundiga lugemisjärjekorras); muidu väikseim täisarv, mida segmendi markerites/kehades pole. Token on vaikimisi numbriline; sümboli/tähe (`*`, `(a)`) trükib kasutaja otse markerisse (redigeeritav) ja vastavasse `[^…]:` reasse.

### Renderdus (CM6 dekoratsioonid)

- **Marker:** `<fn>`/`</fn>` peidetud (`vutt-hidden-tag`), token-sisu superscript-stiilis mark (`vutt-fn`, `vertical-align:super; font-size:~0.7em`) — **redigeeritav** (mitte widget). `renderVuttMarkup` (mobiil/preview) regex token-osa `\d+` → jagatud token-muster.
- **Keha-read:** `[^N]:` prefiks peidetakse → vormistatud number/täht (nt paks `N.`); **kehatekst jääb kohapeal redigeeritavaks** tavatekstiks; väiksem font; segmendi esimese keha ees õhuke ülemine eraldusjoon (visuaalne „joonealused" sektsioon). Mitmerealise keha jätkuread renderduvad sama stiiliga, **reavahetused säilivad** (ei reflow'i). `<pb/>` "── lk ──" widget jääb sektsiooni järele.
- Kehad on juba dokumendi vooluses õiges kohas → **overlay/`coordsAtPos` pole vaja** (lihtsam kui marginaalia).

### Interaktsioonid

- Klikk markeril `<fn>N</fn>` → keri jooksva segmendi `[^N]:` kehale + lühike esiletõst.
- Klikk keha numbril → keri markerile.
- Marker liigutatav/kopeeritav: `<fn>token</fn>` on dokumenditekst (peidetud tägid atomic `vutt-hidden-tag`-ina, token redigeeritav superscript) → cut/copy/paste töötab tavatekstina; token kantakse kaasa.

## Arhitektuur ja failid

| Fail | Muudatus |
|---|---|
| `src/utils/footnoteUtils.ts` (uus) | Puhtad funktsioonid: jagatud token-regex; segmenteeri `<pb/>` järgi; leia markerid + kehad segmendis; järgmine vaba token; `footnoteFromSelection` ja `footnoteFromCursor` (stub) spec'id; keha-vahemike leidja. Unit-testitavad. |
| `src/components/editor/FootnoteExtension.ts` (uus) | CM6 laiendus: keha-ridade dekoratsioon (prefiks-peit + number + eraldusjoon), klikk-navigeerimine (`.vutt-fn` marker ↔ keha), loomis-käsud. |
| `src/components/editor/VuttMarkupExtension.ts` | `<fn>` muudetakse replace-widget'ist mark-põhiseks: `VUTT_TAGS` kirje `{ tag: 'fn', useWidget: true }` → `{ tag: 'fn', cls: 'vutt-fn' }`; `FootnoteWidget` eemaldatakse (token jääb redigeeritavaks superscript-sisuks). |
| `src/utils/renderVuttMarkup.ts` | `<fn>` token-regex `\d+` → jagatud token-muster; mobiilne/preview keha-renderdus `[^N]:` ridadele (vormistatud sektsioon). |
| `src/components/editor/VuttTheme.ts` | `.vutt-fn` superscript-stiil. |
| `src/components/TextEditor.tsx` | Tööriistariba „joonealune" nupp kutsub loomis-käsu (asendab `insertAtCursor('<fn>1</fn>')`). |
| `src/index.css` / `VuttTheme.ts` | Keha-sektsiooni stiilid (number, väiksem font, eraldusjoon). |

**Eraldatus:** `footnoteUtils.ts` = puhas loogika (segmenteerimine, parsimine, loomis-spec) ilma CM6-sõltuvuseta → testitav isoleeritult. `FootnoteExtension.ts` = ainult CM6-esitus + interaktsioon, tugineb utils'ile.

## Testid

`src/utils/__tests__/footnoteUtils.test.ts`:
- Segmenteerimine `<pb/>` järgi (0, 1, mitu `<pb/>`).
- Keha leidmine: ühe- ja mitmerealine; keha lõpp järgmise `[^M]:`, `<pb/>` ja doc lõpu juures.
- Lehekülje-skoop: sama `[^a]` eri segmentides on eraldi.
- „Järgmine vaba token" segmendi piires: madalaim markerita keha, muidu väikseim vaba täisarv.
- Token-regex: number, täht, sümbol (`*`, `†`, `(a)`).
- `footnoteFromSelection`: marker õigesse kohta + keha jooksva segmendi `<pb/>` ette; valiku reavahetused säilivad; tähe-/sümbol-token.
- `footnoteFromCursor`: marker + tühi `[^N]:` stub segmendi lõppu; erand — markerita keha olemas → seo, stubi ei loo.

`FootnoteExtension.test.ts` (EditorState-põhine, marginaalia-testide mustris): dekoratsioonide arv, klikk-navigeerimise sihtkoht, loomis-käsk valikuga/ilma (stub).

## Skoobist väljas (YAGNI)

- Auto-ümbernummerdus / „nummerda järjekorras" abinupp (number on allikast).
- Sama numbri mitmekordne viide ühel lehel.
- Sticky/eraldi joonealuste paneel (kehad on niigi all vooluses).
- Marginaalia-stiilis avatav popup keha jaoks.
- Markeri-keha sidumine peateksti vahel (eeldame joonealused lehe lõpus).
