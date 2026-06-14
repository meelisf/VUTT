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
| Token | Suvaline `\w+` (number VÕI täht) — `[^1]`, `[^a]` | Ainult numbrid (varauusaja tekstis sageli tähed/sümbolid) |
| Skoop | **Lehekülje-põhine**: `<pb/>` piiritleb segmente; nummerdus/seos/loomine segmendi sees | Dokumendi-põhine (eksib topeltlehel; ei vasta ajaloolisele lehe-kaupa nummerdusele) |
| Loomine valikust | Selekteeri → marker valiku kohale + tekst liigub jooksva lehe `<pb/>` ette `[^N]:`-na | Praegune (kustutab valitud teksti — bug) |
| Keha redaktsioon | Variant 1: kohapeal vormistatud (`[^N]:` read jäävad vooluses, stiliseeritud, otse redigeeritavad) | Marginaalia-stiilis avatav popup (kohmakas mitmerealise rea-täpse keha jaoks) |
| Rea-vastavus | Keha sisemised reavahetused säilivad muutumatult; renderdus ei reflow'i | — |
| Liigutatavus | Marker on dokumenditekst → cut/paste töötab; number kantakse kaasa (semantiline, allikast) | Auto-ümbernummerdus (YAGNI; number on allikast) |

## Andmemudel ja formaat

**Marker (jooksvas tekstis):** `<fn>N</fn>`, kus `N` on `\w+` token. Renderdub superscriptina (olemas).

**Keha (lehekülje all):**
```
[^a]: esimene rida
mitmerealine jätk säilib
[^b]: teine märkus
<pb/>
[järgmise lehe peatekst <fn>a</fn> ...]
[^a]: selle lehe esimene märkus
```

- Keha algab reaga mustriga `^\[\^(\w+)\]:` ja **ulatub** kuni järgmise sellise reani **VÕI järgmise `<pb/>`-ni** VÕI dokumendi lõpuni.
- **Lehekülje-skoop:** dokument jaguneb `<pb/>`-de järgi segmentideks. Marker ↔ keha seos, "järgmine vaba number" ja loomine arvutatakse **segmendi piires**. `[^a]` lk 1-l ja `[^a]` lk 2-l on erinevad märkused.
- **Eeldus:** segmendi sees on järjekord `[peatekst][joonealused][<pb/>]` — joonealused on lehe viimased read, markeri ja keha vahel peateksti ei eeldata.

## Käitumine

### Loomine (tööriistariba „joonealune" nupp)

- **Valikuga:** asenda valik markeriga `<fn>N</fn>` valiku alguskohas; lisa valitud tekst **jooksva segmendi lõppu** (selle lehe `<pb/>` ette, või doc lõppu kui viimane leht) reana `[^N]: <valitud tekst>`. `N` = jooksva segmendi järgmine vaba number. Valitud teksti sisemised reavahetused säilivad.
- **Ilma valikuta:** sisesta kursorile `<fn>N</fn>` (`N` = jooksva segmendi järgmine vaba). Keha on tavaliselt mudelilt juba all olemas → marker klapib lugemisjärjekorras. Tühja keha-stub'i EI looda (väldib dubleerimist mudeli väljundiga).
- „Järgmine vaba" = väikseim number, mida segmendi markerites/kehades veel ei ole (vaikimisi numbriline; kasutaja saab tähe vastu välja vahetada, redigeerides marker-teksti ja keha-rida).

### Renderdus (CM6 dekoratsioonid)

- **Marker:** superscript (olemas, `FootnoteWidget`). `renderVuttMarkup` regex `\d+` → `\w+` (tähed).
- **Keha-read:** `[^N]:` prefiks peidetakse → vormistatud number/täht (nt paks `N.`); **kehatekst jääb kohapeal redigeeritavaks** tavatekstiks; väiksem font; segmendi esimese keha ees õhuke ülemine eraldusjoon (visuaalne „joonealused" sektsioon). Mitmerealise keha jätkuread renderduvad sama stiiliga, **reavahetused säilivad** (ei reflow'i). `<pb/>` "── lk ──" widget jääb sektsiooni järele.
- Kehad on juba dokumendi vooluses õiges kohas → **overlay/`coordsAtPos` pole vaja** (lihtsam kui marginaalia).

### Interaktsioonid

- Klikk markeril `<fn>N</fn>` → keri jooksva segmendi `[^N]:` kehale + lühike esiletõst.
- Klikk keha numbril → keri markerile.
- Marker liigutatav/kopeeritav: on dokumenditekst, atomic-widget lubab tervikuna selektimist/lõikamist/kleepimist.

## Arhitektuur ja failid

| Fail | Muudatus |
|---|---|
| `src/utils/footnoteUtils.ts` (uus) | Puhtad funktsioonid: segmenteeri `<pb/>` järgi; leia markerid + kehad segmendis; järgmine vaba number; `footnoteFromSelection` spec; keha-vahemike leidja. Unit-testitavad. |
| `src/components/editor/FootnoteExtension.ts` (uus) | CM6 laiendus: keha-ridade dekoratsioon (prefiks-peit + number + eraldusjoon), klikk-navigeerimine (`.vutt-fn-widget` ↔ keha), loomis-käsk. |
| `src/components/editor/VuttMarkupExtension.ts` | Marker-widget `<fn>` jääb esialgu siia (töötab, vähem churn'i); klikk seome `FootnoteExtension`-i kaudu klassil `.vutt-fn-widget`. |
| `src/utils/renderVuttMarkup.ts` | `<fn>` regex `\d+` → `\w+`; mobiilne/preview keha-renderdus `[^N]:` ridadele (vormistatud sektsioon). |
| `src/components/TextEditor.tsx` | Tööriistariba „joonealune" nupp kutsub loomis-käsu (asendab `insertAtCursor('<fn>1</fn>')`). |
| `src/index.css` / `VuttTheme.ts` | Keha-sektsiooni stiilid (number, väiksem font, eraldusjoon). |

**Eraldatus:** `footnoteUtils.ts` = puhas loogika (segmenteerimine, parsimine, loomis-spec) ilma CM6-sõltuvuseta → testitav isoleeritult. `FootnoteExtension.ts` = ainult CM6-esitus + interaktsioon, tugineb utils'ile.

## Testid

`src/utils/__tests__/footnoteUtils.test.ts`:
- Segmenteerimine `<pb/>` järgi (0, 1, mitu `<pb/>`).
- Keha leidmine: ühe- ja mitmerealine; keha lõpp järgmise `[^M]:`, `<pb/>` ja doc lõpu juures.
- Lehekülje-skoop: sama `[^a]` eri segmentides on eraldi.
- „Järgmine vaba number" segmendi piires.
- `footnoteFromSelection`: marker õigesse kohta + keha jooksva segmendi `<pb/>` ette; valiku reavahetused säilivad; tähe-token.

`FootnoteExtension.test.ts` (EditorState-põhine, marginaalia-testide mustris): dekoratsioonide arv, klikk-navigeerimise sihtkoht, loomis-käsk valikuga/ilma.

## Skoobist väljas (YAGNI)

- Auto-ümbernummerdus / „nummerda järjekorras" abinupp (number on allikast).
- Sama numbri mitmekordne viide ühel lehel.
- Sticky/eraldi joonealuste paneel (kehad on niigi all vooluses).
- Marginaalia-stiilis avatav popup keha jaoks.
- Markeri-keha sidumine peateksti vahel (eeldame joonealused lehe lõpus).
