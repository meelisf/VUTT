# ADR 0041 — Ankur ja kirje on üks fakt; märkus kuulub teksti sisse

**Kuupäev:** 2026-09-13
**Staatus:** vastu võetud
**Seotud:** ADR 0006 (Meili legacy väljanimed), ADR 0012 (muutusteta salvestus = no-op), ADR 0015 (üks commit partii kohta), ADR 0027 (otsinguulatus), ADR 0028 (üks materialiseerimise tee)

## Kontekst

Tekstisisene annotatsioon on kahes failis: `<annN>…</annN>` lehe `.txt`-s
(ankur, mis ütleb MILLE kohta) ja kirje lehe `.json`-i `text_annotations`-is
(kommentaar, autor, aeg — mis öeldi). Redaktor hoiab neid koos:
`useTextAnnotationActions.insertAnnotation` lisab mõlemad ühe tegevusega.

Kaks probleemi tulid välja koos.

**1. Agent ei näinud toimetajakihti üldse.** MCP `get_pages` väljastab
`lehekylje_tekst`-i, mis on otsinguks puhastatud — markup maas, `<annN>` kaasa
arvatud. Lehe kommentaarid ja `page_tags` ei jõudnud MCP-st välja kunagi.
Tagajärg on konkreetne ja halvem kui puuduv info: agent loeb „A.o 1662",
hakkab kummalise aastaarvu üle arutlema ja ei tea, et toimetaja on selle juba
kahtlaseks märkinud. Küsimus on vastatud, aga vastus oli mudeli eest peidus.

**2. Ankur ja kirje läksid lahku.** Iga tekstitee, mis redaktorist läbi ei
käi, kirjutab ainult ühte poolt:

- `reocr_apply.apply_ocr_results` kirjutas `.txt` üle ja lehe JSON-i ei
  puutunud → ankrud kadusid koos vana tekstiga, kirjed jäid õhku rippuma;
- `editing.git_restore` võttis teksti ühest commitist ja kirjed lehe JSON-ist
  ning luges `text_annotations`-it ainult faili juurest, mitte `meta_content`
  wrapperi seest → kirjed pühiti, ankrud jäid tekstis kirjeta.

Mõõdetud tootmises 2026-09-13: 250 annotatsiooni 171 leheküljel, neist
**6 ankruta kirjet** 6 lehel ja **23 kirjeta ankrut** 8 lehel (suurim
`k9omnw/1` — `<ann3>`…`<ann14>`). Ankruta kirje kuvatakse otsingus märkusena,
mille juurde ei saa minna: lehel `o17ekb/439` nägi kasutaja kahte märkust,
kuigi tekstis oli üks ankur. Kirjeta ankur annab redaktoris tühja popoveri.

Ainus valvur oli `pageService.ts` `console.warn` salvestusteel — ja re-OCR ei
käi sealt läbi.

## Otsus

**Ankur ja kirje on üks fakt kahes failis. Tekstitee, mis redaktorist läbi ei
käi, PEAB kutsuma `reconcile_page_annotations`-it** (`server/annotation_ops.py`):

- **kirje ilma ankruta → lehe kommentaariks** (prefiks „Endine tekstisisene
  märkus (ankur kadus teksti muutumisel)", algne autor ja `created_at`
  säilivad), kirje eemaldatakse. Vaikne kustutamine oleks inimese töö
  kaotamine; ankruta kirje alles jätmine teeskleks ankrut, mida ei ole.
- **ankur ilma kirjeta → täg tekstist maha**, sisu jääb. Kaotusvaba:
  kommentaari ei ole olemas.
- **terve paar → puutumata**, `changed=False` (ADR 0012: muutuseta fail ei
  lähe committi).

Lepitatud lehe JSON läheb **samasse committi** tekstiga (ADR 0015).

**Märkus renderdatakse ankru juures, mitte joonealuse märkusena.** Selleks
kannab indeks tingimuslikku välja `lehekylje_tekst_ann` — sama puhastus nagu
`lehekylje_tekst`-il (sidekriipsud liidetud, marginaalia eraldatud), aga
`<annN>` alles. MCP renderdab ta kujul

```
… Soræ d. 9 Martij A.o ⟦1662 ← toimetaja: kahtlane! (Administraator)⟧
```

Nooleni jääb allikatekst, noolest edasi inimese märkus. Allmärkuseplokk ei
täidaks ülesannet: mudel loeb teksti järjest ja tagasi ei pöördu.

**Otsing toimetajakihist on eraldi ulatus** (`search_pages(scope=…)`):
`"text"` (vaikimisi, muutumatu käitumine) | `"annotation"` | `"all"`.
Toimetaja sõna ei ole allika sõna — vaikimisi ei tohi „kahtlane" anda vastet
leheküljele, kus seda sõna tekstis ei ole. Tundmatu `scope` on **viga**, mitte
vaikne tagasilangus vaikeulatusse (ADR 0027 õppetund).

## Tagajärjed

- `lehekylje_tekst_ann` on **TINGIMUSLIK**: kirjutatakse ainult siis, kui
  lehel on vähemalt üks kirjega seotud ankur (171 lehte ~20 000-st).
  Tingimusteta väli tähendaks teist täisteksti koopiat igas dokumendis.
  Väli on ainult `displayed`, MITTE `searchable` — annotatsiooni teksti
  otsimine käib `text_annotations_text` kaudu.
- Kirjeta ankur eemaldatakse **ka indeksi väljast** (`build_annotated_search_text`).
  Märgend, mille kohta märkust ei ole, oleks mudelile seletamatu müra.
  See ei asenda andmeparandust, vaid hoiab indeksi terve, kuni parandus jõuab.
- `clean_text_for_search(text, keep_ann=False)` — vaikeväärtus hoiab
  `lehekylje_tekst`-i käitumise muutumatuna. `keep_ann` peidab ankru
  puhastuse ajaks Unicode'i eraalasse (U+E000…), sest need märgid ei kuulu
  tühikuklassi ega satu ühegi puhastusmustri alla.
- Olemasolevad 29 ebakõla (14 lehel) parandab `scripts/reconcile_annotations.py`
  (kuivkäivitus vaikimisi), mis jookseb **konteinerist** — `data/` git
  commitib root'ina.
- Valvurid: `tests/test_annotation_ops.py` (mõlemad suunad + wrapper-kuju),
  `tests/test_reocr_apply.py` (üks commit, no-op), `tests/test_annotation_index_field.py`
  (tingimuslikkus), `mcp/tests/test_format.py` + `test_text_tools.py`.

## Mida see EI lahenda

Kirjeta ankrute **tekkepõhjus** on ainult osaliselt teada: `git_restore`
wrapper-viga on parandatud, aga `k9omnw/1` kaheteistkümne tägi päritolu jäi
jälitamata. Kui uusi orbe tekib pärast seda parandust, on põhjus mujal — tõenäoliselt
`/save` teel, mis kirjutab lehe JSON-i ainult siis, kui klient `meta_content`-i
saatis. Uus orb pärast 2026-09-13 on seega **signaal, mitte müra**.

Redaktoris ei ole ankruta kirje kuvamist muudetud: `TextAnnotationsPanel`
näitab neid endiselt tühja ankrutekstiga. Pärast andmeparandust ei ole enam
midagi näidata, ja lepitus hoiab uute tekke ära.
