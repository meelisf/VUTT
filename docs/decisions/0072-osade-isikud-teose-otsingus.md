# ADR 0072 — Osade isikud on teose otsingus, mitte teose isikutes

**Kuupäev:** 2026-10-18
**Staatus:** ettepanek
**Seotud:** ADR 0006 (Meili väljanimed), ADR 0057 (teose osad), ADR 0065 (kirjaindeks),
#526 (kirjad)

## Kontekst

Kirjakogu (koodeks, kaust, pärand) on üks teos, mille kirjadel on igaühel oma autor
ja adressaat (osad, ADR 0057). Teose tasemel ei ole ühtki rolli, mis kogu ausalt
kirjeldaks: `o17ekb` („Johann Fischeri kirjad koodeksis HAB Wolfenbüttel …") kannab
Fischerit `auctor`-ina, aga Fischer ei ole koodeksi autor. Ta on enamiku kirjade
adressaat, ja koodeksi moodustaja on tõenäoliselt keegi hilisem. See ei ole teada.

Dashboardi otsing leiab teose ainult teose isikute järgi (`authors_text`). Kui teose
isikud jäetakse tühjaks, ei leia otsing „Salemann" koodeksit, kuigi seal on
Salemanni 15 kirja. Kirjaotsing (`kirjad`, ADR 0065) leiab kirjad, aga see on eraldi
vaade.

Arhiivikirjelduses (ISAD(G), EAD, Kalliope) on kogu tasemel kaks eri asja:
**moodustaja** (kes kogu kokku pani või kelle pärandist see pärineb) ja **isikute
indeks** (korrespondendid on otsitavad, aga neid ei esitata autoritena). RDA-s
märgitakse mitme autoriga koguteose puhul autor ära ja kirje põhineb pealkirjal.

## Otsus

1. **Teose rollisõnavara (`vocabularies.json` `roles`) kirjakogu tõttu ei laiene.**
   `addressee` jääb osa rolliks. Teose isikud jäetakse tühjaks, kui teose tasemel
   rolli ei ole teada. Pealkiri ütleb, kelle kirjadega on tegu.
2. **Moodustaja roll** (üks üldine roll koodeksile, kaustale ja pärandile) lisatakse
   alles siis, kui tuleb esimene kogu, mille moodustaja on teada. Mitte ennetavalt.
3. **Osade isikud lähevad teose otsingusse.** Uus otsitav väli `part_persons_text`
   (ainult `meili_doc.py`, ADR 0006): kõigi osade `creators`-ite nimed + nimevariandid
   (sama allikas mis `authors_text`-il, `person_aliases.json`), `normalize_eszett`.
   - **Teose tasemel, igas lehedokumendis**, nagu `authors_text`. Lehe kaupa ei sobi:
     dashboard otsib teose esimese lehe dokumendist, seega lehepõhine väli ei leiaks
     teise kirja korrespondenti.
   - Väli on **igas dokumendis**, osadeta teosel tühi (`attributesToSearchOn` nõue).
   - `SEARCHABLE_ATTRIBUTES`-is `authors_text`-i järel ja dashboardi
     `DASHBOARD_SEARCH_ATTRIBUTES`-is (`searchService.ts`), et teose enda isik oleks
     järjestuses eespool.
   - Väli **ei ole** teose isik: ta ei jõua `creators`-isse, autoritahku ega
     `person_to_works`-i teose rollina. Isikuleht näitab kirju niikuinii osade kaudu.
4. **Vaade ütleb vaste põhjuse.** Kui teos leiti ainult osade isiku järgi, näitab
   tulemuskaart seda (nt „kirjades: Joachim Salemann"). Muidu ilmub teos tulemustesse
   ilma nähtava põhjuseta.

## Tagajärjed

- Sünk: osa muutus käib `bulk_update_works` kaudu (`work_parts._write`) ja
  sünkroniseerib teose lehedokumendid, seega uut päästikut ei ole vaja. Isiku nime
  või nimevariandi muutus jõuab välja samamoodi nagu `authors_text`-i.
- `searchableAttributes` ei rakendu jooksvale instantsile ise (runtime-kontroll on
  ainult filtreeritavatel väljadel): deploy vajab seadete uuendust ja reindeksit
  (`server_seed_data.sh`).
- Andmed: `o17ekb` teose `auctor` Fischer eemaldatakse. Otsingust ta ei kao, sest
  nimi on pealkirjas ja kirjade adressaadina ka `part_persons_text`-is.
