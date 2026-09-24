# ADR 0048 — Ülevaatusmärge on serveri väli; automaatrikastus täidab ainult tühja

**Kuupäev:** 2026-09-24
**Staatus:** vastu võetud
**Seotud:** #240, spekk `docs/superpowers/specs/2026-09-24-isiku-lisamise-voog-design.md`
**Issue:** #240

## Kontekst

Isikukaart tekib kolmel teel — toimetaja vorm, EntityPicker'i „loo uus" valik ja
serveri stubi tee (`ensure_prosopo_for_entity`, kui teosele lingitakse Wikidata/GND
isik, kellel veel kaarti ei ole) —, aga ükski neist ei rikastanud kaarti loomisel.
2026. aasta juunist loodud 155 kaardist 19 olid täiesti tühjad (ainult nimi), 15-l
neist oli olemas väline ID, mille pealt oleks saanud eluaastad ja ameti
automaatselt tõmmata. Olemasolev `verification_level` oli kõigil ~2100 aktiivsel kaardil
väärtuses `draft` — see ei eristanud „äsja loodud tühi kaart" ja „toimetaja poolt
läbi vaadatud kaart".

Vorm saatis (ja saadab jätkuvalt) kaardi tervikuna `update_person`-ile ning
`/enrich` kirjutab suvalisi väljaradu (`_deep_set`) — seega iga kaardiväli on
vaikimisi kliendilt kirjutatav, kui teisiti ei otsustata. Serveripoolset välja,
mida klient ei tohi puudutada, ei olnud kaardil varem — see tuli luua otsast
peale.

Samast tööst tuli välja teine probleem: `ext_id_index` (väline ID → `vutt:P…`
pöördindeks, kasutab `_find_by_external_id`) uuendati salvestusest eraldi
sammuna, luku vabastamise järel aegunud koopiast. Kaks samal ajal käivat
ID-lisamist (nt admin lisab GND-ID käsitsi, samal ajal loob upload'i taustatöö
stubi samale isikule) võisid seega panna sama välise ID kahele eri kaardile,
ja indeksi hilisem uuendus võis kustutada teise tee vahepeal lisatud ID.

## Otsus

- **`review` on serveri väli.** Kõik kliendi kirjutusteed (`update_person`,
  `apply_enrichment`, kaardi osa `create_person_checked`-is) läbivad
  `strip_server_fields`-i, mis viskab ära nii `review`-võtme kui iga
  `review.*`-raja. Kirjutavad `review`-d ainult `create_person_checked` (kaardi
  loomisel), taustarikastus (`auto_enrich_runner`) ja hiljem lisanduv admini
  kinnitusendpoint — see endpoint ei ole veel selles PR-is olemas, ainult
  reegel, et ta ei tohi kinnitatud olekut uuesti avada.
- **Automaatrikastus täidab ainult tühja välja.** Erandid lisamise suunas:
  `name.aliases` ühendatakse olemasolevaga, seotud välised ID-d
  (VIAF-kirjes viidatud Wikidata/GND-ID-d) lisatakse identifikaatorite
  loendisse, kui ID ei ole juba mõnel teisel kaardil. Väärtust, mis läheb
  vastuollu juba kaardil oleva täidetud väljaga, ei rakendata — see väli
  jääb täitmata ja jääb muutmisvaates nähtavaks, ilma et see kuhugi eraldi
  kirja läheks. Kahe allika OMAVAHEL vastuolus olevad väärtused (ja
  kokkusobivad, aga erineva täpsusega kuupäevad, `compatible: true`) lähevad
  `review.source_conflicts`-i. Kuupäevad normaliseeritakse enne võrdlust
  `YYYY-MM-DD`-vormingusse (puuduv kuu/päev täidetakse „01"-ga), et sama
  teadmise kaks kirjakuju (`"1592"` vs `"1592-01-01"`) ei loeks vastuoluks.
- **Välisallika päringut ei tehta ühegi luku all.** `run_auto_enrichment` teeb
  võrgukõned enne lukkude võtmist, loeb kaardi lukkude all UUESTI ja rakendab
  ettepanekud alles siis. `enrich_pending` on töö püsiv jälg `review.reasons`-is:
  iga lõppenud katse (õnnestunud, ebaõnnestunud või vahepeal kaardilt kadunud
  ID) eemaldab selle; kui märge jääb kaardile alles, tähendab see katkenud
  katset, ja käivitustaaste (`recover_pending`) ajastab kaardi uuesti.
  Idempotentne: kui `enrich_pending`-it ei ole (kaart juba lõpetatud või
  kinnitatud), on käivitus no-op.
- **Väline ID on korraga ühel kaardil.** ID-d lisavad teed
  (`add_identifier`, `update_person` kui kehas on `identifiers`,
  `restore_person`, `merge_person`, `create_person_checked`) hoiavad
  `ext_id_claim_lock`-i (protsessilokaalne `RLock`) ÜLE kontrolli, salvestuse
  JA `ext_id_index`-i uuenduse — mitte ainult kontrolli ajal. Järjekord on
  alati `ext_id_claim_lock` enne `person_lock`-i. `update_person` kontrollib
  ainult LISANDUNUD ID-sid (`_added_identifiers`): pärandduplikaat (sama AA
  kahel vanal kaardil) ei tohi tavalist kaardimuudatust blokeerida, ainult uue
  ID lisamist. `add_identifier` teeb rikastuse võrgueelvaate alles pärast
  lukkude vabastamist.
- **Salvestus ja indeksi uuendus käivad samas kriitilises sektsioonis**
  (`_save_person_locked`) — kõik kaardikirjutused (loomine, muutmine,
  identifikaatori lisamine, pildi lisamine/kustutamine, taastamine, liitmine,
  massmuudatus, taustarikastus) kutsuvad seda otse `git_ops.save_with_git`
  asemel.
- **`/enrich` ei muuda `identifiers`-it.** `apply_enrichment` viskab 400
  (`ValueError("identifiers_via_enrich")`), kui kinnitatud väljade seas on
  `identifiers` või `identifiers.*` — ID-de lisamine käib ainult
  `add_identifier` kaudu, kus on olemas duplikaadikontroll.
- **Kinnitust hiljem uuesti ei avata** — kui admin on kaardi kinnitanud,
  ei kirjuta järgmine automaatrikastuse käivitus (nt paralleelne
  käivitustaaste) `review`-d enam üle; `_is_pending` kontrollib
  `enrich_pending`-i olemasolu enne iga tööd.
- **Uus isik tekib ainult `create_person_checked` kaudu**
  (`POST /prosopography/persons/create`; vana `POST /prosopography` ja
  server stubi tee `ensure_prosopo_for_entity` delegeerivad mõlemad sinna).
  See on ainus koht, kus kuju kontrollitakse (kehatüüp, `name` kuju,
  `identifiers`/`aliases` kuju → 400 enne ühtegi kirjutust), ID-lukk
  võetakse üle kontrolli JA salvestuse, ning `review` luuakse
  (`new_review`) enne esimest kirjutust. `_apply_card_update` viskab kliendi
  saadetud `id`/`created_at`/`created_by`/`schema_version`/`import_batch_ids`/
  `merged_into` alati ära; `updated_at`/`updated_by` seab
  `create_person_checked` ise ÜLE, alles pärast `_apply_card_update`-i
  kutset — kliendi saadetud väärtus neis väljades ei jõua seega kaardile
  kummalgi teel.

Tuletatud floruit (seotud teoste aastatest, ainult tegevusrollid; käsitsi
sisestatu võidab) ei ole selles PR-is teostatud — see on PR 2 teema ja jääb
kokkulepitud reegliks, mitte olemasolevaks koodiks.

## Tagajärjed

- Uus kaardikirjutus kutsub `_save_person_locked`-i, mitte
  `state.save_with_git`-i otse — muidu jääb `ext_id_index` uuendamata või
  uuendatakse aegunud koopiast.
- Uus serveriväli (nagu `review`) lisatakse `SERVER_FIELDS`-i
  (`person_crud.py`), mitte eraldi pop-reeglina ühes kirjutusteel — nii katab
  `strip_server_fields` ta automaatselt kõigis kolmes kliendi kirjutusteel.
- Uus ID-d lisav tee võtab `ext_id_claim_lock`-i ENNE `person_lock`-i, mitte
  vastupidi (ristlukustuse oht) ega alles kontrolli ajaks (aegunud
  hetktõmmise oht).
- `apply_enrichment`-i EI TOHI kutsuda `person_lock`-i seest — `person_lock`
  on tavaline `threading.Lock` (mitte `RLock`), teistkordne haaramine sama
  lõime poolt tekitab ummikseisu.
- Valvurid: `tests/test_auto_enrich.py` + `tests/test_auto_enrich_runner.py`
  (loogika + runner), `tests/test_prosopo_create_checked.py`
  (`create_person_checked`), `tests/test_prosopo_review_field.py`
  (`strip_server_fields`, `review` kirjutusteed), `tests/test_prosopo_id_claim.py`
  + `tests/test_prosopo_ext_id_index.py` (`ext_id_claim_lock`, indeksi
  atomaarsus).
