# Arhitektuuriotsuste logi (ADR)

Lühikesed kirjed otsustest, mille rikkumine on varem põhjustanud (või
põhjustaks) rikkeid, ja mille põhjendus ei ole koodist ilmne. Eesmärk:
projekti teadmus ei tohi elada ainult ühe inimese (või ühe tööriista mälu)
peas — vt issue #137, bus-factor = 1.

## Formaat

Üks fail otsuse kohta: `NNNN-luhike-slug.md`. Kolm osa:

- **Kontekst** — mis olukord/probleem otsuse tingis
- **Otsus** — mida otsustati (ja mida teadlikult EI tehtud)
- **Tagajärjed** — mida see tähendab edaspidistele muudatustele; mida EI TOHI teha

Uus otsus → uus fail, järgmine number. Otsuse muutumisel ära kustuta vana:
lisa uus kirje, mis viitab vanale („asendab 000X").

## Register

| # | Otsus | Staatus |
|---|-------|---------|
| [0001](0001-andmed-failisusteemis-git.md) | Andmed failisüsteemis + git, mitte andmebaasis | kehtib |
| [0002](0002-async-endpointid-ei-blokeeri.md) | `async def` endpoint ei tohi kutsuda blokeerivat I/O-d | kehtib |
| [0003](0003-marginaalia-normaliseerimine-salvestamisel.md) | Marginaalia normaliseerimine ainult salvestamisel | kehtib |
| [0004](0004-auth-aegumine-loginmodal-invariant.md) | Auth-aegumise käsitlus: LoginModal ja init-gate invariandid | kehtib |
| [0005](0005-meilisearch-prefixsearch-keepwarm.md) | Meilisearch: prefixSearch jääb sisse, cold-start lahendab keep-warm | kehtib |
| [0006](0006-meili-legacy-valjanimed-uhine-meili-doc.md) | Meili eestikeelsed legacy-väljanimed + ühine `meili_doc.py` | kehtib |
| [0007](0007-tuletatud-indeksid-read-modelid.md) | Tuletatud indeksid on nullist taastatavad read-modelid | kehtib |
| [0008](0008-markdown-allowlist-xss.md) | Vabateksti markdown: allow-list, mitte kunagi toores HTML | kehtib |
| [0009](0009-marginaalia-iga-fuusiline-rida-eraldi.md) | Iga füüsiline marginaaliarida on eraldi `<m>` plokk | kehtib |
| [0010](0010-lehe-vahetus-ei-monteeri-editorit-maha.md) | Lehe vahetus ei monteeri editorit maha; sisuvahetus on märgistatud | kehtib |
| [0011](0011-i18n-keelepakid-laisalt-ilma-fallbackita.md) | i18n laeb ühe keele korraga; `fallbackLng` väljas + kaks tõlkevalvurit | kehtib |
| [0012](0012-muutusteta-salvestus-on-no-op.md) | Muutusteta salvestus ei kirjuta, ei commiti ega indekseeri | kehtib |
| [0013](0013-meili-sunk-koondatakse-teose-kaupa.md) | Meili sünk koondatakse teose kaupa; dirty-lipp elab vea üle | kehtib |
| [0014](0014-inline-sildid-vs-labels-register.md) | Inline sildid on kuvatav tõde; register täidab augud, ei kirjuta ajaloolisi kohanimesid üle | kehtib |
| [0015](0015-reocr-hulgi-vastuvott.md) | Batch re-OCR tulemused võetakse vastu hulgi, ühe git-commiti ja ühe Meili sünkina | kehtib |
| [0016](0016-rikastuse-allikatel-on-varuteed.md) | Igal välisel rikastusallikal on varutee ja lühike timeout | kehtib |
| [0017](0017-poolitamine-enne-ocr.md) | Topeltlehtede poolitamine enne OCR-i: VUTT rasteriseerib ise, prepress on opt-in | kehtib |
| [0018](0018-reocr-katkestamine.md) | Re-OCR töö katkestamine | kehtib |
| [0019](0019-languages-esinevad-keeled.md) | `languages` loetleb teoses sisuliselt esinevad keeled, mitte põhikeelt | kehtib |
| [0020](0020-uleslaadimine-seisak-mitte-kogulagi.md) | Üleslaadimist piirab seisak, mitte kogupäringu lagi; UI räägib faasist, mitte serveri staatusest | kehtib |
| [0021](0021-uks-nimi-uhe-saladuse-kohta.md) | Üks nimi ühe seade kohta; aegunud keskkonnamuutuja nimi peatab käivituse | kehtib |
| [0022](0022-valise-id-kanooniline-kuju.md) | Välise identifikaatori kanooniline kuju on paljas ID; normaliseeritakse nii kirjutus- kui lugemisteel | kehtib |
| [0023](0023-vutt-mcp-lokaalne-olek.md) | `vutt_mcp` tohib hoida lokaalset olekut, kui see on valikuline | kehtib |
| [0024](0024-kaugkoristus-failid-kohe-kataloog-hiljem.md) | Katkestamine kustutab kaugfailid kohe, kataloogi eemaldab reaper armuaja järel | kehtib |
| [0025](0025-ocr-vea-margend-err.md) | OCR-server märgib ebaõnnestunud lehe `.err` failiga; märgend on lõplik | kehtib |
| [0026](0026-ulevaatus-on-alati-nahtav.md) | Lehtede ülevaatus on alati nähtav; opt-in jääb 300 DPI teele | kehtib |
| [0027](0027-mcp-otsing-lehetekstist-ja-ruhmitatult.md) | MCP `search_pages` otsib ainult lehetekstist; vastus rühmitatud teose kaupa | kehtib |
| [0028](0028-vutt-materialiseerib-ocr-lehed.md) | VUTT materialiseerib OCR-i lehed ja avaldab lehthaaval; LOSS ainult OCR-ib | kehtib |
| [0029](0029-ootel-reocr-loendur-on-teose-tasemel.md) | Ootel re-OCR loendur ja hulgi-rakendus on teose, mitte partii tasemel | kehtib |
| [0030](0030-page-map-lahteleht-valjundlehtedeks.md) | `page_map` kaardistab lähtelehe kõigile temast tekkinud väljundlehtedele | kehtib |
| [0031](0031-kirjutamisoigus-on-lugemisoigus-ja-ulatus.md) | Kirjutamisõigus = lugemisõigus JA ulatus; contributor toimetab ainult oma kollektsioonides | kehtib |
| [0032](0032-filter-enne-skanniakent.md) | Filter läheb andmeallikasse või aken kasvab; piiratud akna järel filtreerimine annab vaikselt tühja vastuse | kehtib |
| [0033](0033-serveripoolne-kasutajale-nahtav-tekst.md) | Rakenduses loetav tekst renderdatakse lugeja keeles, lahkuv tekst saaja salvestatud keeles; keelt küsitakse ühest funktsioonist | kehtib |
| [0034](0034-kirjad-hosti-postfixi-kaudu.md) | Kirjad lähevad hosti postfixi kaudu (`mailhost.ut.ee`); saatmisviga ei kaota juba loodud linki | kehtib |
| [0035](0035-uue-konto-vaikeroll-on-kitsam.md) | Uue konto vaikeroll on `contributor`; iga muu väärtus peale contributor/editor annab kitsama rolli | kehtib |
| [0036](0036-katkenud-vastus-ei-ole-ebaonnestunud-too.md) | Katkenud vastus ei ole ebaõnnestunud töö; pikk töö deklareerib, et ta käib, ja ooteaeg on leping kahe otsa vahel | kehtib |
| [0037](0037-work-dating.md) | Teose dateering säilitab allika kuupäeva, täpsuse ja valikulise kalendri; otsing kasutab vahemike kattuvust | kehtib |
| [0038](0038-kahe-peegli-vahel-peab-olema-ulimuslikkus.md) | Kaks kohta, mis peavad kokku langema, ei tohi teineteist tingimusteta peegeldada; üks pool peab suutma öelda, kumb liikus | kehtib |
| [0039](0039-sisuvalja-keel-on-valjanimes.md) | Sisuvälja keel on väljanimes (`biography_et`/`biography_en`/`aa_raw`); vananemisankur on kinnituse kirje, mitte salvestamise kõrvalmõju | kehtib |
| [0040](0040-jalgitav-fail-on-autoriteetne-fail.md) | Jälgitav fail on autoriteetne fail: iga kirjutustee commitib, tuletatav ei ole gitis | kehtib |
| [0041](0041-ankur-ja-kirje-on-uks-fakt.md) | Annotatsiooni ankur ja kirje on üks fakt kahes failis; toimetaja märkus renderdatakse teksti sees ankru juures | kehtib |
| [0042](0042-tookollektsiooni-liikmesust-ei-indekseerita.md) | Töökollektsiooni liikmesust ei indekseerita Meilisse; otsing filtreerib serverilt saadud `work_id` loendiga | kehtib |
| [0043](0043-kogude-oiguste-uhised-toimingud.md) | Kogu- ja kasutajavaade kasutavad ühiseid õigustoiminguid; kogude loend adminile, seaded superadminile | kehtib |
| [0044](0044-peidetud-tagi-peab-jaama-mootdetavaks.md) | Peidetud tägi peab jääma mõõdetavaks | kehtib |
| [0045](0045-kaivitustaaste-enne-valmisolekut.md) | Käivitustaaste lõpeb enne, kui server päringuid vastu võtab; ainult lokaalne, võrgutöö jääb taustalõime | kehtib |
| [0046](0046-sessioon-on-oiguste-ainus-tode.md) | Sessioon on kutsuja õiguste ainus tõde (iga õigusvälja kirjutus katkestab sessiooni); tokenit loeb ainult `deps.py` | kehtib |
| [0047](0047-jatkatav-uleslaadimine.md) | Üksikfail laetakse üles tükkidena; jätkamise tõde on kettal olev baitide arv, uut upload'i staatust ei ole | kehtib |
| [0048](0048-ulevaatusmarge-on-serveri-vali.md) | Ülevaatusmärge on serveri väli; automaatrikastus täidab ainult tühja; väline ID ühel kaardil | kehtib |
| [0049](0049-lehe-teisendus-on-uks-tee.md) | Lehe teisendus on üks tee (`image_transform` + `components/pagePrep`); upload'is pööre → kärbe → poolitus | kehtib |
| [0050](0050-teose-halduse-ootel-lehetoimingud.md) | Teose halduse pöörded ja poolitused on ootel plaan; rakendus ühe pakina (`/page-ops`), pööre → poolitus | kehtib |
| [0051](0051-lehekirjutus-ainult-lehe-failipaarile.md) | Lehekirjutus ainult olemasoleva lehe `.txt`/`.json` paarile; nimeleping `server/page_paths.py` | kehtib |
| [0052](0052-kohtade-register-on-ajalooline.md) | Kohtade register on ajalooline; grupi kriteeriumid (Saksamaal Benrathi joon); tänapäevane halduskuuluvus → grupp ankrute kaudu | kehtib |
| [0053](0053-lehe-kirjutus-lehe-luku-all.md) | Lehe JSON-i lugemine–muutmine–kirjutamine käib lehe luku all (`page_locks.page_lock`); kommentaaritoimingud kirjutavad ainult `.json`-i | kehtib |
