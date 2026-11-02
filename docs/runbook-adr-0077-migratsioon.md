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

- [ ] **Ülevaatus tehtud** ülevaatuslehel https://claude.ai/artifact/Cnwfbg833Aa8ivPVErx1Mq (põhikiri keelest; valikud salvestuvad, Claude kannab need `0077-otsused.json`-i). Vanem poolitusmärgipõhine nimekiri [`decisions/0077-ulevaatus.md`](decisions/0077-ulevaatus.md) on aegunud. Otsustamata
      teosed (jaotis 1), signaalita fraktuurteosed (2) ja segateoste lehed (3) on kantud faili
      `0077-otsused.json`. Värava lipud (4) ei blokeeri migratsiooni, aga Valmis-lehed jäävad
      treeningust välja, kuni need on VUTT-is parandatud.
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

Oodatav (kuivkäivitus koopial 2026-11-02 pärast ülevaatust; päevased parandused võivad numbreid veidi muuta):

| Rida | Väärtus |
|---|---|
| Lehed liigi järgi | antiqua ~15 700, cs ~850, whole ~4 470, mixed ~440, manuscript 1 |
| Muutuvaid teoseid / lehti | ~537 / ~5 740 |
| Ülevaatuseks | ainult `segaleht (rea kaupa)` (~436); **`keel tundmatu` ja `poolitus vastuolus keelega` = 0** |
| Käsikirjad `<cs>`-iga | 3 teost |

**Peatu, kui „keel tundmatu“ või „poolitus vastuolus keelega“ > 0.** Mõni leht muutus
päeval. Aruanne on `/tmp/cs_to_f_aruanne.json`
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
- [ ] LOSS (meelisf/qwen-mudeli-treenimine#1): merge → LOSSis `git pull` → värske varukoopia
      (`~/bin/vutt_backup.py`) PÄRAST migratsiooni → `build_vutt_dataset.py` → vaata
      `data/vutt/f_poolitus_lipud.csv` → treening (~5 h) → `eval_print.py` (`f_f1`, `cer_plain`).
      OCR-teenus kasutab kuni vahetuseni vana `INSTRUCTION_CS`-i, nii et taaskäivitus on ohutu.
- [ ] Mudeli vahetus alles pärast hindamist ja koos: LOSSi teenus `"print": INSTRUCTION`,
      VUTT `config.OCR_OUTPUT_RELATIVE_CS = False` + Gemini trükijuhis `<f>`-ile (ADR 0077 p 7).
