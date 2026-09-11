# ADR 0040 — Jälgitav fail on autoriteetne fail

**Kuupäev:** 2026-09-11
**Staatus:** vastu võetud
**Seotud:** ADR 0001 (andmed failisüsteemis + git), ADR 0007 (tuletatud read-modelid), ADR 0015 (üks commit partii kohta)
**Issue:** #346 (konfiguratsioon ei commiti), #347 (kaks kirjutajat pühivad teineteise kirjeid)

## Kontekst

`data/` on git-repo just selleks, et muudatustel oleks autor, põhjus ja
taastepunkt. Lehetekstid ja isikukaardid käivad `save_with_git` kaudu.
`data/config/` ei käinud: kollektsioonid, arhiivid, kohad ja päritolugrupid
kirjutati `atomic_write_json`-iga otse üle.

Töölaua ülevaatusel 2026-09-10 oli `data/` repos committimata kaks päris
kollektsiooni, kümme uut kohta ja kaks pikka masinkirjutatud faili. Kõik
legitiimsed muudatused — lihtsalt ilma ajaloota. Kollektsiooni kustutamise
(`routers/collections.py`) järel ei ole midagi, millest taastada.

Sama ülevaatus tõi välja teise poole: `person_aliases.json` „muudatus"
`+911/−646` ei olnud muudatus, vaid **andmekadu**. Faili kirjutavad kaks teed
eri võtmeruumis — `rebuild_indices` kaardipõhised `vutt:P…` võtmed ja
`people_ops` Wikidata/GND võtmed — ja esimene kirjutas faili igal serveri
stardil tervikuna üle. Kuna ükski kirjutustee ei commitinud, ei olnud pühkimine
kuskil näha; mõõtmine näitas, et 645-st väliste ID-dega loojast oli aliasekirje
alles ühel.

`data/config/` sisaldab seega kolme eri liiki faile ja küsimus „kas
konfiguratsioon peaks käima `save_with_git` kaudu" laguneb failide kaupa laiali.

## Otsus

**1. Jälgitav fail on autoriteetne fail.** Kui fail on `data/` gitis, siis on
igal tema kirjutusteel autor ja põhjus ning iga kirjutus commitib. Vahepealset
seisundit („jälgitav, aga commitib keegi teine kunagi hiljem") ei ole.

| Ämber | Failid | Kirjutustee |
|---|---|---|
| Autoriteetne | `collections.json`, `archives.json`, `places.json`, `origin_groups.json`, `vocabularies.json` | `save_config_with_git` (`git_ops.py`) |
| Tuletatud / väline cache | read-modelid (ADR 0007), `person_aliases.json`, `labels.json` | `atomic_write_json`, `data/.gitignore`-is |

**2. Autor tuleb toimingust.** Admin-endpoint annab `user["username"]`,
taustatee (`refresh_all_place_labels`, `auto_assign_group_parents`) annab
`"Automaatne"`. Commit-sõnum ütleb toimingu ja võtme: `Koht: kustuta riga`.

**3. Partii-loogikat siia ei tehta.** ADR 0015 (üks commit partii kohta) on
vastus sadadele kirjutustele ühe kasutajatoimingu kohta. Autoriteetne
konfiguratsioon liigub mõõdetult ~2–3 commiti faili kohta 60 päevas ja
propagatsioon kirjutab read-modeleid, mitte konfi. Üks commit ühe admin-toimingu
kohta on täpselt õige teralisus.

**4. Git-viga ei kaota admini muudatust.** `save_config_with_git` kirjutab faili
enne commiti; ebaõnnestunud commit annab `{"success": False}` + logikirje ja
endpoint õnnestub. Vastupidine (kirjutus tagasi keerata) teeks gitist
kirjutustee lüliti, mida ta ei ole.

**5. Kahe kirjutajaga fail peab omandi eksplitsiitselt piiritlema.** Kes ehitab
oma poole nullist, tohib kustutada ainult oma võtmeruumi. `rebuild_indices`
kannab võõrad võtmed muutmata edasi (`_on_kaardi_voti`), ja taastetee seemne
võtab teoste metaandmetest, mitte failist endast — pühitud faili põhjal ei saa
taastada seda, mis temas olla võiks.

Teadlikult EI tehtud: perioodiline „konfiguratsiooni hetkeseis" commit. Ta
kaotab autori ja põhjuse ning vormistab drifti selle asemel, et see ära hoida.

## Tagajärjed

- Uus autoriteetne konfiguratsioonifail → kirjutustee `save_config_with_git`
  kaudu ja nimi valvuri nimekirja (`tests/test_config_git_commit.py`). Valvur
  keelab `atomic_write_json(COLLECTIONS_FILE …)`-tüüpi kirjutuse.
- Uus tuletatud või väljast tõmmatav fail → `data/.gitignore`-isse kohe, mitte
  „kui müra tekib".
- `async def` endpointis läheb `save_config_with_git` `run_in_threadpool`-i
  (ADR 0002) — ta teeb `subprocess`-iga git-kutseid.
- Admin-toiming, mille autorit ei ole (taustavärskendus), peab autori
  selgesõnaliselt nimetama; vaikeväärtus on `"Automaatne"`, mitte kutsuja roll.
- `data/` gitis tehtud commit tuleb backend-konteinerist (root); hostist
  commitimine kukub õiguste taha.
