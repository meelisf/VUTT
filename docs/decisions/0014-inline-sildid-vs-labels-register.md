# 0014 — Inline sildid on kuvatav tõde; register parandab ainult augud ja ingliskeelseid koopiaid

**Staatus:** kehtib

## Kontekst

Q-koodiga entiteedil on VUTT-is sildid kahes kohas:

- **inline `labels{et,en,la,de}`** kirje sees (isikukaardil, teose metaandmetes) —
  **see ja ainult see jõuab ekraanile** (`useEntityLabel`, `getLabel`);
- **`data/config/labels.json`** — keskne Q-kood → sildid register, mida
  admin-toiming „Värskenda kirjete sildid Wikidatast" uuendab.

Kaks tagajärge, mis mõlemad on tootmises rikke põhjustanud:

1. **Registri värskendamine üksi ei muuda mitte midagi nähtavat.** Wikidatasse
   lisatud eestikeelne „meditsiiniprofessor" jõudis `labels.json`-i, aga kaardil
   püsis „Professor of medicine" — kasutajale nägi toiming välja katkisena.

2. **Register ei ole kohanimede osas autoriteet.** Kaartidel on tahtlikult
   AJALOOLINE nimekuju (`de: "Reval"`, `et: "Elbing"`, `de: "Dorpat"`,
   `de: "Ösel"`), Wikidatas on moodne (`Tallinn`, `Elbląg`, `Tartu`, `Saaremaa`).
   Esimene katse „vananenud" silte parandada luges pseudo-tõlkeks iga kokkulangevuse
   kahe keele vahel — kuna `sv: "Reval"` == `de: "Reval"`, kirjutas see 29 kaardil
   saksakeelse ajaloolise nime moodsaga üle. Taastatud `git revert`-iga.

## Otsus

1. **Registri värskendus kannab tulemuse alati kaartidele.**
   `POST /admin/refresh-entity-labels` kutsub pärast `refresh_all_entity_labels()`
   ka `sync_prosopography_inline_labels()`, mis kirjutab kaardid ja teeb kõigist
   muudatustest **ühe** git-commiti. Vastuses on `persons_updated`.

2. **Vaikimisi on register ainult gap-fill.** `fill_entity_labels` täidab
   puuduvaid keeli; olemasolev inline väärtus võidab alati.

3. **Heal (`heal_stubs=True`) on lubatud AINULT ingliskeelse koopia vastu.**
   Väärtus asendatakse ainult siis, kui see on inline `en` väärtuse
   tähttäheline (tõstutundetu) koopia — täpselt see muster, mille `EntityPicker`
   tekitas, kui Wikidatas polnud valiku hetkel eestikeelset silti.
   Kahe **mitte-inglise** keele kokkulangevus on tavaline ja tahtlik ning
   seda EI parandata.

4. **Kohanime-pesad on healist väljas.** `_entity_slots` märgib `birth`/`death`
   `place` ja `origin.place_labels` lipuga `is_place=True`; nendes pesades
   toimub ainult gap-fill. Ajalooline nimekuju on andmete sisu, mitte viga.

5. **Ingliskeelset silti ei seemendata teise keele pessa.** `EntityPicker`
   kirjutab Wikidata-valikul ainult need keeled, mis Wikidatast päriselt tulid.
   Puuduva `et` katab kuvamisel `labels.en` → `label` ahel. Nii jääb pesa
   *tühjaks* ja hilisem gap-fill saab selle vaikselt ära parandada.

## Tagajärjed

- Uus mass-parandus siltidele **testitakse enne kuivkäivitusega päris andmetel**
  (`fill_entity_labels(copy, registry)` üle kõigi kaartide, diff välja) — mitte
  ainult unit-testidega. Reegel, mis unit-testis on ilus, võib päris andmete
  kokkulangevustes olla hävitav.
- Kui mõni sildipesa vajab tulevikus laiemat ravi, on õige koht `_heal_stub_labels`
  ja selle laiendus peab kandma oma regressioonitesti („Reval", „Elbing").
- Prosopograafia kaartide git-ajalugu on taastamise võrk: massioperatsioon ühe
  commitina on `git revert`-itav (vt ADR 0001).
