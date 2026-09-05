# ADR 0032 — Filtreeritud loend ei tohi lõppeda skanniakna serval

**Kuupäev:** 2026-09-05
**Staatus:** vastu võetud
**Seotud:** ADR 0007 (tuletatud indeksid), ADR 0031 (õigusotsuse autoriteet)
**PR:** #304

## Kontekst

`get_recent_commits` (`server/git_ops.py`) võttis git-ajaloost akna —
`(skip + limit) * 3 + 50` commitit, vaikimisi 200 ligi 11 000-st — ja
filtreeris kasutaja järgi alles Pythonis, akna sees. Kes akna taha jäi, sellel
ei olnud tulemusi. Review-vaade tõlkis tühja vastuse lauseks „Muudatusi pole
veel tehtud".

Vastus oli seega **vale, mitte lühike**. Kasutaja, kes oli aprillis
kümneid lehti toimetanud, näis mitte kunagi midagi teinuvat; ainsad nähtavad
kasutajad olid need, kes olid kirjutanud viimase paari päeva jooksul. Viga oli
vaikne: ei erandit, ei logirida, ei tunnust, et vastus on kärbitud.

See on üldine kuju, mitte selle ühe funktsiooni eripära. Alati, kui
andmeallikast võetakse *ülevalt N kirjet* ja filter rakendub **pärast**
seda, on tühi vastus mitmetähenduslik: ta tähendab kas „vasteid ei ole" või
„vasteid ei olnud viimase N kirje seas". Kasutajaliides ei suuda neid kahte
eristada ja valib alati esimese, sest see on ainus, mille kohta tal on tekst.

## Otsus

**1. Filter läheb andmeallikasse, mitte allika taha.**

Kasutajafilter on nüüd `git log --author` — git ise kitsendab, aken loeb
kasutaja *enda* commite. Mõõdetud tootmises: autorifiltriga log kogu ajaloo
peale on 0,1–1,0 s, filtrita 2,3 s / 11 MB. Filtri allapoole viimine ei ole
seega kompromiss jõudluse ja korrektsuse vahel — ta on mõlemas suunas võit.

`--author` antakse `--fixed-strings`-iga. `--author` on muidu regex ja nimest
kokku pandud muster võiks vaikselt MITTE sobituda — see taastaks täpselt selle
vea, mida ADR parandab. Fikseeritud string sobitub üle, mitte alla; täpse
võrdluse (`commit.author.name == username`) teeb Python. **Ülesobitumine on
ohutu, alasobitumine mitte** — kahtluse korral vali laiem muster.

**2. Kui allikas ei oska filtreerida, kasvab aken.**

Kollektsioonikuuluvus elab `_metadata.json`-is, mitte git-commitis, seega seda
filtrit gitile edasi anda ei saa. Sel juhul skannitakse aknaga, mis laieneb
(65 → ×4 → ×16 → kogu ajalugu), kuni tulemusi on `limit` jagu **või ajalugu
saab otsa**. Tühi vastus tähendab siis tõesti tühja, sest kogu ajalugu on läbi
vaadatud.

Tavajuht ei muutu: filtrita annavad viimased 200 commitit tootmises 707
eristuvat kirjet, esimene aken täitub kohe. Laienemine on haruldase juhu hind,
mitte igapäevane kulu.

**3. Filtri sisendit kandev cache tuleb kehtetuks tunnistada.**

`_work_info_cache` kandis varem ainult kuvatavat (pealkiri, aasta, autor) ja
aegunud kirje tähendas vana pealkirja. Nüüd kannab ta ka `collections`-i ehk
filtri sisendit — aegunud kirje paneks teose *valesse kollektsiooni*.
Seepärast unustab `save_with_git` teose kirje iga `_metadata.json` muutuse
peale. Üldreegel: **kui cache hakkab kandma välja, mille järgi filtreeritakse,
tõuseb ta lubatud vananemise lävi kuvamise omalt otsuse omale.**

**4. Kuuluvuse autoriteet on `_metadata.json`.**

Kollektsioonifilter loeb teose `collections`-i `_metadata.json`-ist, mitte
`work_collections_index.json`-ist. Read-model tohib kandidaate kitsendada, aga
mitte olla vastuse arvutuskäik (ADR 0007, ADR 0031). Kollektsioonipuu **kuju**
(`parent`) loetakse konfiguratsioonist ja valik kaasab alamkollektsioonid —
sama semantika mis Meili `collections_hierarchy` filtril, et sama valik annaks
Dashboardil ja muudatuste vaates sama hulga teoseid.

## Tagajärjed

Iga uus filtreeritav loend, mis loeb andmeid järjestatud allikast (git-log,
kataloogiloend, järjend failis), peab enne valmimist vastama küsimusele: *kas
tühi vastus tähendab siin „ei ole" või „ei olnud selles aknas"?* Kui teist, on
valikuid kaks — vii filter allikasse või lase aknal kasvada. Kolmandat
(„akna võib suureks panna") ei ole: suurem konstant lükkab piiri edasi, aga ei
kaota vaikset valet, sest ajalugu kasvab edasi.

`tests/test_recent_commits_filters.py` valvab mõlemat telge:
`test_user_history_reaches_beyond_scan_window` ja
`test_collection_filter_reaches_beyond_scan_window` teevad üle akna jagu
täitecommite ja nõuavad, et vanem kirje ikkagi leitakse;
`test_metadata_save_invalidates_work_info_cache` valvab punkti 3;
`test_user_filter_does_not_match_name_prefix` valvab, et git-tasemel
kitsendamine ei asendaks täpset võrdlust.

## Mis EI muutu

Tulemuste dedupliktsioon (`seen_files` — üks kirje teose lehe kohta),
`skip`-põhine pagineerimine, `has_more` semantika ja filtrita vaate sisu on
muutumatud. ADR ei ütle midagi selle kohta, KUI palju ajalugu kasutajale
näidatakse — ainult seda, et näidatav hulk ei tohi sõltuda sellest, kui palju
*teised* on vahepeal kirjutanud.
