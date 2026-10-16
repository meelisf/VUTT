# ADR 0071 — VUTT-i märgendus on TEI alamhulga lühisüntaks

**Kuupäev:** 2026-10-17
**Staatus:** kehtib
**Seotud:** ADR 0067 (`<add>`), ADR 0070 (lehe tähistus), #630

## Kontekst

VUTT-i tägisid oli 9 ja ühtki kirjapandud reeglit, mis tägiks kõlbab. Tägide loend
oli koodis vähemalt kuues kohas (redaktor, lugemisvaade, normaliseerija kaks loendit,
„Puhasta", wrapTagUtils); `<add>` puudutas 19 faili (#579). Lehe tähistus (ADR 0070)
tõi neli tägi juurde. Mure: VUTT-ist kujuneb murre, mida ei saa kadudeta TEI-ks
teisendada.

## Otsus

1. **Uus täg ainult siis, kui TEI-s on otsene vaste.** Nimi tuleb TEI elemendist või
   selle `type`-ist.
2. **Atribuute ei ole.** TEI atribuudi info kannab tägi nimi (`<sig>` = `fw type="sig"`).
3. **Iga täg on registris** koos TEI vaste ja käitumisega: `server/vutt_tags.py` ja
   `src/markup/vuttTags.ts`. Kooskõla valvab `tests/test_vutt_tags_parity.py`;
   tarbijaloendid tuletatakse registrist (`src/markup/consumers.ts`,
   `marginalia_normalize._INLINE`/`_EMPTY_RE`) ja `vuttTagsConsumers.test.ts` kontrollib
   redaktori `VUTT_TAGS`-i.

| Täg | TEI | Otsingusse |
|---|---|---|
| `i` `b` | `hi rend="italic\|bold"` | jah |
| `cs` | `hi`, kiri vastupidine teose põhikirjale — **erand**, vt allpool | jah |
| `hi` | `hi` | jah |
| `m` | `note place="margin"` | `marginaalia_tekst` |
| `add` | `add` (ADR 0067) | jah |
| `annN` | toimetaja märkuse ankur (`anchor`/`span` + `note`) — **erand**: VUTT-i toimetajakiht, mitte allika märgendus | jah |
| `fn` | `ref type="note"` (joonealuse viide) | ei |
| `pb` | `pb` | ei |
| `fw` `sig` `catch` `rh` | `fw type="pageNum\|sig\|catch\|header"` (ADR 0070) | ei → `page_marks` |

**`cs` on suhteline** (koodivahetus teose põhikirja suhtes). TEI teeb sama: põhikiri
deklareeritakse kord (`<text rendition="…">`), kõrvalekalle märgitakse. Puudu on
põhikirja väli; seni ei ole `cs`-i TEI teisendus mehaaniline.

**Eksport** (treeningandmed, LOSS `build_vutt_dataset.py`): toortekst läheb välja
tägidega muutmata; ehitaja otsustab, mida mudelile anda.

## Tagajärjed

- Uus täg = registri kirje MÕLEMAS failis + `VUTT_TAGS` kirje (kuvaklass) + juhend;
  paarsustest kukub, kui midagi puudub.
- TEI eksport on hiljem mehaaniline (v.a `cs` ilma põhikirja väljata).
- Tägi, millel TEI vastet ei ole, ei lisata.
