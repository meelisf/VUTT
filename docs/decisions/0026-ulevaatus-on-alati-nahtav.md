# ADR 0026 — Lehtede ülevaatus on alati nähtav; opt-in jääb 300 DPI teele

**Kuupäev:** 2026-08-25
**Staatus:** vastu võetud
**Issue:** #255 · **Asendab osaliselt:** ADR 0017
**Spekk:** `docs/superpowers/specs/2026-08-24-upload-lehtede-ulevaatus-design.md`

## Kontekst

ADR 0017 tegi prepressi **tervikuna** opt-in-iks: puutumata lülitiga upload ei
renderdanud ühtki pikslit. Põhjenduseks oli eelvaate hind, mille koodikommentaar
hindas ~0,05 s/lk.

Mõõtmine 2026-08-24, 143-leheline töö: eelvaade **82,6 s = 0,58 s/lk**, staging'us
26,2 MB. Hinnang oli 11× optimistlik — aga absoluutarv on endiselt väike ja jookseb
taustal, lehthaaval, samal ajal kui admin ekraani vaatab.

Kallis on hoopis teine läbikäik: 300 DPI rasterdamine (~6 min / 143 lk), mis toimub
ainult siis, kui plaan päriselt poolitab.

Opt-in-i hind oli seevastu suur ja nähtamatu. Lüliti puutumata jätmine tähendas, et
admin **ei näinud kunagi**, mida ta OCR-i saadab — ja kaks vaikset viga said aastaid
elada: (A) `mode: "default"` tähendas „poolita üldjoonelt", nii et lüliti sisselülitamine
poolitas korraga kõik lehed; (B) väljajätmine oli triviaalsel teel **vaikne no-op** —
originaalfail läks muutmata OCR-serverisse ja väljajäetud leht imporditi ikka.

## Otsus

**100 DPI eelvaade renderdatakse iga upload'i puhul**; opt-in kastike kaob. Samm 3
muutub alati nähtavaks lehtede ülevaatuseks, kus lehe saatus (poolitus, OCR-ist
väljajätmine, mudel) otsustatakse hulgi ja ENNE OCR-i.

**Mis EI muutu: apply kiirtee.** Poolitusteta plaan ei renderda ühtki 300 DPI pikslit —
puutumata plaan läheb originaal-PDF-ina, ainult-väljajätmistega plaan pärast ~36 s
alamhulga-ehitust (`pdfseparate` + `pdfunite`).

**Kallis osa jääb opt-in-iks; odav osa muutub kohustuslikuks.**

## Invariandid

- **Vaikeplaanis on kõik lehed `mode: "nosplit"`.** `default_split_x` on üldjoone
  VÄÄRTUS, mitte rakendatud joon — see hakkab kehtima alles „Poolita kõik" käsuga.
  Väli `enabled` on kadunud mõlemast otsast; vana kujuga plaani normaliseerib
  `prepress_plan.normalize_legacy_plan` lugemisel (`_load_prepress` on ainus
  chokepoint) ja kirjutab tulemuse tagasi. Ilma selleta hakkaks pooleliolev
  staging-upload äkki kõiki lehti poolitama.
- **`excluded` ja `mode` on risti.** Väljajätmine domineerib väljundi koostamisel
  (`page_cuts` annab tühja listi), aga EI kustuta poolitusolekut: käsitsi seatud joon
  on alles ja hakkab uuesti kehtima, kui leht OCR-i tagasi lisatakse.
- **`ocr_model` on töötlusotsus omas state-väljas.** `meta.type` on bibliograafiline
  väide ja seda EI muudeta vaikselt — vaikne tüübimuutus jõuaks impordiga
  `_metadata.json`-i ja sealt Meilisse. Vahetus käib `try_set_ocr_model` CAS-i all, mis
  seab mudeli ja MÕLEMAD kaugteed ühe luku sees; kaks eraldi luku-akent laseks apply
  vahele ja kaugteed muutuksid lennus oleva saatmise alt.
- **`preview_cancel` on ühe tsükli lipp:** `prepress/start` nullib selle. Ilma selleta
  läheks taaskäivitatud eelvaade kohe `cancelled`-iks.
- **Apply katkestab eelvaate, ei oota seda.** `APPLY_START_STATUSES` sisaldab
  `"prepping"` ja `try_begin_applying` seab `preview_cancel`-i SAMA luku all, otse dikti
  (`get_upload_lock` on tavaline `Lock`, mitte `RLock` — pesastatud `mutate_prepress`
  annaks ummikseisu). Põhjus: apply ja eelvaade jagavad `RENDER_SEMAPHORE(1)`-i, seega
  katkestamata renderdus põimuks apply'ga lehe kaupa ja ligi kahekordistaks selle aja.
  Lippu kontrollitakse IGA lehe alguses, mitte partii lõpus.
- **Renderdaja tohib staatust lähtestada ainult siis, kui ta on selle omanik**
  (`_reset_status_if_prepping`). Pärast `preview_cancel`-i on staatus `"applying"` ja
  selle tagasilükkamine `awaiting_split`-iks lubaks teise apply CAS-i sisse (topelt-SFTP).
- **Väljajätmine toimib MÕLEMAL triviaalteel.** PDF-teel ehitatakse alamhulk
  (`pdf_subset.build_subset_pdf`), pildikausta-teel jäetakse failid vahele ja ülejäänud
  saavad uue järjenumbri. `expected_pages` tuleb PLAANIST, mitte lähtefailist — muidu
  ootab `is_stalled` lehti, mida ei tule, ja sammu 4 `done`-üleminek jääb rippuma.
- **Ebaõnnestunud PDF-alamhulk langeb vaikselt rasterteele ja logib `warning`-u.**
  Kasutajat ei tüüdata — ainus tagajärg on ooteaeg —, aga ilma selle logireata ei ole
  hiljem võimalik aru saada, miks 143-leheline töö võttis 36 sekundi asemel kuus minutit.

## Tagajärjed

- ADR 0017 põhimõte „prepress on tervikuna opt-in" kehtib edaspidi **ainult 300 DPI
  läbikäigule**.
- `PREVIEW_DPI` kommentaar `page_source.py`-s kannab nüüd mõõdetud arvu.
- **Asendab** `feat/upload-ocr-katkestamine` plaani Task 7 (mudelivahetus `meta.type`
  kaudu, kaugteede isolatsioon run-i tasemel). Uues lahenduses jääb `meta.type`
  puutumata ja kaugteed arvutatakse vahetuse hetkel ümber.
