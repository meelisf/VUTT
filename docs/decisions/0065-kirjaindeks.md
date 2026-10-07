# ADR 0065 — Kirjaindeks: kiri on otsinguüksus, dokument tuletatakse lehedokumentidest

**Kuupäev:** 2026-10-07
**Staatus:** ettepanek
**Seotud:** ADR 0006 (Meili väljanimed), ADR 0013 (sünk teose kaupa), ADR 0042
(töökollektsioonid), ADR 0057 (teose osad), #526, spekk
`docs/superpowers/specs/2026-10-07-kirjaotsing-design.md`

## Kontekst

Kirju ei saanud otsida kirjadena (autor, adressaat, dateering, saatmis- ja
sihtkoht). Teose osad (#464) andsid kirjale registri teose sees, aga `teosed`-indeksi
tabamus on leht: kirju ei saanud loendada, tahkudesse koondada ega dateeringu
järgi sortida.

TÜ raamatukogu rara digib mapi kaupa ka siis, kui köide on lahti võetud; kirjad on
kataloogitud nii üksikult kui komplektina. Seega on ka lahtine kiri **osa** (mapp =
teos), mitte eraldi teos.

## Otsus

1. **Eraldi Meili indeks `kirjad`, üks dokument kirja-osa kohta** (`kind == "letter"`),
   koos kirja lehtede puhastatud tekstiga. `teosed` ei muutu: lehekülgede otsing
   leiab kirjade teksti nagu varem.
2. **Kirjadokument tuletatakse sama teose juba ehitatud lehedokumentidest**
   (`meili_doc.build_letter_documents`). Ligipääsuväljad (`is_public`,
   `collections_hierarchy`) ja tekst tulevad sealt — kaks indeksit ei saa neis lahku
   minna. Live-sünk ja seed kasutavad sama funktsiooni.
3. **Ligipääsureegel tuleb ühest funktsioonist** (`meilisearch_ops._access_rule`) ja
   tenant-token annab `teosed`-ile ja `kirjad`-ile sama reegli. Teosele piiratud
   token (lingiga jagatud teos) `kirjad`-i ei saa: jagatav teos on avatav, mitte
   otsitav. Indeks, mida `searchRules`-is pole, on tokenile kättesaamatu.
4. **Uues indeksis on ingliskeelsed väljanimed.** ADR 0006 legacy-nimed kehtivad
   ainult `teosed`-is.
5. Dateering kasutab ADR 0037 arvulisi piire (`date_start`/`date_end`, kattuvusfilter);
   **teose aasta kirja ei dateeri** — dateeringuta kirjal kuupäevavälju pole.
   Tahud on v1-s sildipõhised (samanimelised isikud langevad kokku — teadlik piirang).

## Tagajärjed

- Iga tee, mis kirjutab või kustutab `teosed`-i dokumente, peab sama tegema
  `kirjad`-iga: teose sünk (upsert → aegunute kustutus ALLES pärast edukat taski;
  lehtedeta teosel kustutus enne väljumist), teose kustutus, kogu nähtavus (PUT,
  sihtmärk indeksis olevad kirjad, mitte praegused osad), seed.
- Nimi on kirjadokumendis denormaliseeritud: isikukaardi nimemuutus uuendab ka
  `parts[].creators` (`work_parts.relabel_person`, luku all).
- Piirilehe sõna annab tabamuseks mõlemad kirjad: lehe sisest kirjapiiri VUTT ei tea.
- Seaded: `meili_settings.LETTERS_*`; runtime rakendab need stardil
  (`_ensure_letters_index`), deploy ei vaja käsitsi Meili sammu. Esmane täitmine =
  `server_seed_data.sh`.
