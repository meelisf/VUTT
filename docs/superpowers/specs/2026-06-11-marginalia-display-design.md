# Marginaalia visuaalne esitus — disain

**Kuupäev:** 2026-06-11
**Staatus:** kavand (ootab kasutaja kinnitust)

## Taust ja eesmärk

Ääremärkused (marginaalia) on transkriptsioonifailides inline `<m>...</m>` plokkidena ridade vahel (näide: `reference_data/1626-...-lzogr0-017.txt`). Kasutajad soovivad, et editor esitaks need visuaalselt marginaalis — sarnaselt originaali skänniga — nii, et need ei lõhuks põhiteksti jooksu.

**Failiformaat EI muutu.** Ankrutega formaat (`<m_ref id="N"/>` + `[MARGINAALID]` sektsioon) lükati tagasi: OCR-mudel ei õppinud ankrut paigutama (jättis tägi ära, kuhjas marginaaliad lõppu) ja ka inimkasutajale ei leidunud head ankru sidumise töövoogu. Kõik muudatused on esituskihis ja otsinguindeksis.

## Vastuvõetud otsused

| Otsus | Valik | Tagasilükatud alternatiivid |
|---|---|---|
| Andmeformaat | Inline `<m>` jääb | Ankruformaat (OCR-katsetus ebaõnnestus) |
| Põhivaade laial ekraanil | Marginaaliveerg (~130px) editori vasakus servas | Inline-marker + popover (ei sarnane originaaliga) |
| Kõrguskonflikt | Nihuta allapoole (stacking) + punktiir-konnektor ankrureale | Lõika ja laienda (sisu peidetud ilma klikita) |
| Muutmine | Ava-tekstis (inline reveal): klikk avab `<m>` sisu ajutiselt oma päris kohas dokumendis | Popover-redaktor (erimärgid, undo, otsing tulnuks dubleerida) |
| Kitsas ekraan / mobiil | Märgivaade (kollane „m" ankrurea alguses), klikk = sama ava-tekstis | Eraldi bottom-sheet (pole vaja) |
| Reanumbrid | Marginaaliaga lehel gutter eemaldatakse; ilma marginaaliata lehel jääb kõik praegusesse | Päris numbrid hüpetega (segadus); nähtavate ridade ümbernummerdamine (ebastabiilne, ei vasta failile) |
| Skoop | Editor + mobiilne lugemisvaade + otsinguindeksi parandus | — |

Mockupid: `.superpowers/brainstorm/2104541-1781181118/content/` (editor-marginalia-layout, layout-v2-collision, edit-interaction).

## Käitumine

### Editor (Workspace, CodeMirror)

Avalik teose leht `/work/:id/:page` on desktopil seesama editor readOnly-režiimis, seega katab editori lahendus ka avaliku lugemisvaate.

**Ilma marginaaliata lehekülg (enamus lehti):** editor ei muutu üldse — reanumbrid alles, veergu pole.

**Marginaaliaga lehekülg:**

- Vasakus servas marginaaliveerg (~130px), peenikese eraldusjoonega. Reanumbrite gutter on peidetud (Compartment kaudu, et hiljem saaks numbrid mõne vaate jaoks tagasi tuua konfiguratsioonimuudatusega).
- `<m>`-plokk (sh mitmerealine) on dokumendis peidetud; sisu renderdub veerus oma ankrurea kõrval: väiksem kiri, kursiiv, oma reavahe (`line-height` ~1.35), murdmine veeru laiusesse (`overflow-wrap`) — sissejooks põhiteksti on välistatud. Marginaalia andmesisesed reavahetused säilivad failis muutumatult; kuvas murduvad ainult liiga pikad read.
- **Ankrureegel:** plokk kuulub *järgmise* tekstirea juurde (failis seisab plokk enne rida, mille kõrval ta skännil on). Dokumendi lõpus olev plokk ankurdub eelmise rea juurde. Ploki ülaserv = ankrurea ülaserv; põhiteksti rida-realt vastavus skänniga ei muutu kunagi.
- **Virnastamine:** kui plokk ei mahu enne järgmise ploki ankrukohta, algab järgmine plokk eelmise alt; punktiir-konnektor + täpp näitavad päris ankrurida. Hover tõstab esile ploki ja ta ankrurea. Lehe lõpus võib veerg tekstist allapoole ulatuda (editor saab lisapadjandi).
- **Muutmine:** klikk plokil avab `<m>` sisu oma päris kohas teksti sees (kollane taust nagu praegune `vutt-marginalia`). Sisu on tavaline dokumenditekst — undo, otsing, erimärkide paneel ja tägikaitse töötavad muudatusteta. Esc või klikk väljapoole sulgeb. Korraga võib lahti olla mitu plokki; avatud olek map'itakse dokumendimuudatuste läbi.
- **Kaitse:** suletud plokk on atomic (kursor hüppab üle) ja `vuttTagProtectionFilter` laieneb nii, et kasutaja kustutamine, mis ulatub üle peidetud ploki, lõikab ploki muudatusest välja — nähtamatut sisu ei saa kogemata kustutada. Kustutamiseks ava plokk.
- **Uue marginaalia lisamine:** tööriistariba nupp loob kursori rea kohale tühja `<m></m>` oma reale ja avab selle kohe muutmiseks.
- **Lüliti:** kiip editori päises klapib veeru kokku → märgivaade. Eelistus `localStorage`-is (võti nt `vutt_marginalia_view`).
- **Märgivaade:** plokk renderdub väikese kollase „m"-märgina ankrurea alguses (FootnoteWidget'i muster); klikk = sama ava-tekstis mehaanika. Kitsas aknas (alla ~768px sisulaiuse) lülitub märgivaade automaatselt ja automaatika ületab kasutaja salvestatud eelistuse (veerg ei mahu füüsiliselt ära).

**Teadlikud kompromissid:**

- Editor on `white-space: pre`; väga pika rea horisontaalsel kerimisel kerib veerg koos tekstiga vaateväljast välja. Transkriptsiooniread on lühikesed (= skänni read), haruldane äärejuht.
- Reanumbrite kadumisel marginaaliaga lehel väheneb positsioonitaju pikal lehel (jääb kerimisriba + kõrvalolev skänn). Kui see häirima hakkab, on numbrite tagasitoomine (nt ainult mõnes vaates) Compartment'i kaudu odav.

### Mobiilne lugemisvaade (WorkspaceMobileView)

`renderVuttMarkup` hakkab `<m>`-plokki renderdama eraldi plokk-elemendina: taane, väiksem kiri, kursiiv, vasak ääris ("marginaalia-kaart" teksti sees). Mitte enam hall inline-span lause keskel. Mobiilis veergu ei üritata — sisu nähtavus ilma interaktsioonita on seal tähtsam kui originaalipaigutus.

### Otsinguindeks (Meilisearch)

Praegu eemaldab `clean_text_for_search` ainult tägid ja marginaalia *sisu* jääb lause keskele — fraasiotsing üle marginaaliakoha ebaõnnestub (nt "Teuffel vnd Satanas" lehel lzogr0-017).

- Uus funktsioon `split_marginalia(text)` → `(põhitekst ilma <m>-plokkideta, marginaaliate sisu liidetuna)`. Töötab enne muud puhastust.
- `lehekylje_tekst` = puhastatud põhitekst ilma marginaaliata → fraasiotsing terveneb. Poolituste liitmine (`[-⸗¬]\s*\n\s*`) töötab ka üle eemaldatud ploki koha.
- Uus väli `marginaalia_tekst` = puhastatud marginaaliasisu; **alati dokumendis olemas** (kasvõi tühi string — `attributesToSearchOn` nõuab välja olemasolu). Lisatakse `searchableAttributes`-isse ja frontendi `attributesToRetrieve`-sse.
- Muudatus läheb **mõlemasse indekseerimisteesse**: `server/meilisearch_ops.py` (live) ja `scripts/1-1_consolidate_data.py` (seed).
- `text_content` (toortekst editorile) ei muutu.

## Arhitektuur ja failid

| Fail | Muudatus |
|---|---|
| `src/utils/marginaliaUtils.ts` (uus) | Ploki-parser + virnastamisalgoritm puhaste funktsioonidena (unit-testitavad); kasutavad editor ja renderVuttMarkup |
| `src/components/editor/MarginaliaExtension.ts` (uus) | CM6 laiendus: peitmis-dekoratsioonid (block replace + atomic), veeru-widgetid, virnastamise ViewPlugin (mõõtmine + translateY + konnektorid), avatud-olekute StateField, märgivaade |
| `src/components/editor/VuttMarkupExtension.ts` | Protection filter laieneb peidetud plokkidele. Senine `vutt-marginalia` inline-mark jääb alles — peidetud plokil on see nagunii nähtamatu ja avatud plokil annab just see kollase tausta |
| `src/components/TextEditor.tsx` | Veeru/märgivaate lüliti-kiip, tööriistariba "Marginaalia" nupp, gutteri Compartment (numbrid väljas marginaaliaga lehel), localStorage eelistus |
| `src/utils/renderVuttMarkup.ts` | `<m>` → plokk-element ("marginaalia-kaart") |
| `src/index.css` | Veeru, plokkide, konnektorite, kaardi stiilid |
| `src/locales/{et,en}/workspace.json` | Lüliti, nupu ja tooltippide tõlked |
| `server/meilisearch_ops.py` | `split_marginalia`, `marginaalia_tekst` väli, searchableAttributes |
| `scripts/1-1_consolidate_data.py` | Sama indeksiloogika (seed-tee) |
| `src/services/meiliService.ts` | `marginaalia_tekst` attributesToRetrieve/searchableAttributes |

## Riskid

- **CM6 dekoratsioonide koosmäng** (suurim): block-replace + atomic + protection-filter on varem kursoriliikumise regressioone andnud. Maandus: järgitakse faili kriitilisi reegleid (from ASC sort, replace'id ei kattu, protection filter listi viimasena), kursoriliikumine üle peidetud ploki testitakse käsitsi mõlemas suunas; marginaalia-dekoratsioonid ehitatakse samasse buildMarkup-tsüklisse või eraldi StateField'i, mis järgib samu invariante.
- **Virnastamise mõõtmine** peab toimuma `requestMeasure` kaudu (mitte layout-tsükli sees), et vältida värelust ja lõpmatuid tsükleid.
- **Täisreindeks** vajalik pärast indeksimuudatust (`server_seed_data.sh`); enne seda on `marginaalia_tekst` väli dokumentides puudu — frontend ei tohi selle puudumisel katki minna.

## Testimine

- **pytest:** `split_marginalia` — mitu plokki, mitmerealine plokk, plokk puudub, fraasiliitumine üle eemaldatud ploki, poolituskriips vahetult enne plokki, tühi tekst.
- **vitest:** `marginaliaUtils` parser (plokid, ankrurea määramine, lõpus olev plokk) + virnastamisalgoritm (kattumiseta, kattumisega, mitu järjestikust konflikti); `renderVuttMarkup` testi uuendus.
- **Käsitsi:** kursoriliikumine üle peidetud ploki; kustutamine üle ploki; ava/sule + undo; uue marginaalia lisamine; lüliti; kitsas aken; mobiilivaade; readOnly (anonüümne) vaade.

## Deploy järjekord

1. Frontend build + rsync (editor töötab vana indeksiga — `marginaalia_tekst` puudumine ei tohi midagi lõhkuda).
2. Backend rebuild (`server_update.sh`).
3. Täisreindeks (`server_seed_data.sh`).

## Järkjärgulisus

Töö jaguneb kaheks iseseisvaks tükiks: (1) esituskiht (editor + mobiilivaade), (2) otsinguindeks. Kumbki on eraldi deploy'itav; editor ei sõltu indeksimuudatusest.
