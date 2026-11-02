# Käivitusjuhis: ADR 0077 migratsioon (`<cs>` → `<f>`)

Ühekordne. Kood: PR #724. Otsus: [ADR 0077](decisions/0077-fraktuur-on-absoluutne-f.md).
Otsused: [`decisions/0077-otsused.json`](decisions/0077-otsused.json).

**Millal:** vaiksel ajal (õhtul), kui keegi ei toimeta. Kestus umbes 30 min, millest
`--apply` võtab 5–20 min (suurem osa on Meili sünk).

**Miks koos:** uus redaktor ja lugemisvaade eeldavad absoluutset `<f>`-i. Backendi ja
frontendi deploy ning migratsioon käivad ühe istumisega. Vahepeal kuvatakse
teisendamata teoste `<cs>` valesti, aga andmeid see ei riku: vanast vahelehest tulev
salvestus saab 409.

## 0. Eelkontroll (lokaalselt)

- [ ] PR #724 CI roheline.
- [ ] Keegi ei toimeta. Viimased commitid: `ssh vutt 'cd ~/VUTT/data && git log -5 --format="%ci %an %s"'`.

## 1. Hetktõmmis (serveris)

```bash
ssh vutt
cd ~/VUTT/data && git status --short | head      # peab olema tühi (või ainult jälgimata müra)
git tag pre-0077-f
tar czf ~/vutt-pre-0077-f-$(date +%F).tar.gz --exclude='*.jpg' -C ~/VUTT data
ls -lh ~/vutt-pre-0077-f-*.tar.gz                 # ~ 60–150 MB
```

## 2. Merge + backend

```bash
gh pr merge 724 --merge --delete-branch           # lokaalselt
ssh vutt 'cd ~/VUTT && ./scripts/server_update.sh --no-cache'
ssh vutt 'docker logs --tail 20 vutt-backend'     # käivitus ilma veata
```

## 3. Kuivkäivitus konteineris

```bash
ssh vutt
docker cp ~/VUTT/docs/decisions/0077-otsused.json vutt-backend:/tmp/otsused.json
docker exec vutt-backend python3 scripts/migrate_cs_to_f.py --decisions /tmp/otsused.json
```

Oodatav (kuivkäivitus koopial 2026-11-02; päevased parandused võivad numbreid veidi muuta):

| Rida | Väärtus |
|---|---|
| Antiikvateosed | 194 teost, 491 lehte |
| Fraktuurteosed | 89 teost, 3544 lehte |
| Segateosed | 2 teost, 8 lehte; signaalita `<cs>`-lehti **0** |
| Otsustamata | **0** teost |
| Käsikirjad `<cs>`-iga | 3 teost |

**Peatu, kui „Otsustamata“ > 0 või „signaalita `<cs>`-lehti“ > 0.** Mõni teos sai
päeval uue `<cs>`-i. Aruanne on `/tmp/cs_to_f_aruanne.json`
(`docker cp vutt-backend:/tmp/cs_to_f_aruanne.json /tmp/`). Lisa otsus faili ja
käivita uuesti.

## 4. Rakendus

```bash
docker exec vutt-backend python3 scripts/migrate_cs_to_f.py --apply \
    --decisions /tmp/otsused.json --manuscript-cs hi 2>&1 | tee ~/migrate-0077.log
```

- Iga teos on üks commit (autor „Automaatne“, sõnum „Fraktuur: …“), lehed ja manifest
  `data/config/migrations/0077-f.json` samas commitis.
- Rida „VAHELE (muutus vahepeal)“ = keegi salvestas samal ajal. Käivita sama käsk
  uuesti: manifest hoiab ära topeltteisenduse.

## 5. Valvur

```bash
docker exec vutt-backend python3 scripts/migrate_cs_to_f.py --check     # → "<cs>-iga lehti: 0"
```

## 6. Frontend (lokaalselt)

```bash
git checkout main && git pull
npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/
```

## 7. Kontroll brauseris

- [ ] **Fraktuurteos**, nt Relatio 1632 (`occgcn`), lk 32: hall on antiikvasõnadel
      (*exercitiis*, *Professoribus*), 𝔉 nupp näitab `A`, alumisel ribal
      „Lehekülje kirjastiil: fraktuur“.
- [ ] **Antiikvateos** (ladina disputatsioon `<cs>`-iga, nt 1632-14 *Disputatio
      theologica* lk 2): hall ainult fraktuurinimedel (*Düderoff*), nupp `𝔉`.
- [ ] Ctrl+K fraktuurlehe sõnal muudab ta halliks (antiikva); Ctrl+I teeb kursiiviks ja
      hall jääb.
- [ ] „Puhasta“ valitud sõnadel eemaldab ainult nende märgenduse.
- [ ] Mobiili lugemisvaade: sama hall jaotus.
- [ ] Otsing leiab fraktuurteose sõna (`lehekylje_tekst` eemaldab tägid).

## Tagasipööramine (kui midagi on valesti)

Andmed (ainult migratsiooni commitid, teiste toimetajate tööd ei puudutata):

```bash
ssh vutt 'cd ~/VUTT/data && git log --format=%H --grep="(ADR 0077)" pre-0077-f..HEAD | xargs -r git revert --no-edit'
ssh vutt 'cd ~/VUTT && ./scripts/server_seed_data.sh'     # Meili uuesti
```

Kood: deploy eelmine main (`git revert -m 1 <merge-commit>` → PR → deploy). NB: pärast
andmete tagasipööramist on korpuses jälle `<cs>`, mida uus kood ei tunne, nii et kood ja
andmed pööratakse tagasi koos.

Viimane abinõu: `~/vutt-pre-0077-f-<kuupäev>.tar.gz` (ainult tekstid; kirjutaks üle ka
hilisemad muudatused).

## Pärast

- [ ] ADR 0077 staatusest eemalda „migratsioon käivitamata“, docs/decisions/README rida samuti.
- [ ] LOSS: eksport `<f>`-ga + kanoniseerimine + poolitusvärav, treening. Seejärel
      mõlemad juhised `<f>`-ile ja `config.OCR_OUTPUT_RELATIVE_CS = False` (ADR 0077 p 7).
