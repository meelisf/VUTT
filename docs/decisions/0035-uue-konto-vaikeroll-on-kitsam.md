# ADR 0035 — Uue konto vaikeroll on kitsam (contributor)

**Kuupäev:** 2026-09-07
**Staatus:** vastu võetud
**Seotud:** ADR 0031 (kirjutamisõigus on lugemisõigus JA ulatus)
**Issue:** #321

## Kontekst

Kutsevoog andis vaikimisi `editor`-i ehk **kirjutamisõiguse kogu korpusele**,
ja kitsam variant nõudis admini teadlikku klõpsu. Kaks kohta:
`Registrations.tsx` `roleFor()` ja `registration.create_invite_token`, kus
PUUDUV `role` (`None`) andis `editor`-i tagasiühilduvuse nimel, samas kui
TUNDMATU väärtus andis juba `contributor`-i (ADR 0031, leid 5).

See on tagurpidi vähima õiguse põhimõttest. ADR 0031 ehitas ulatuse-masinavärgi
just selleks, et uus inimene saaks töötada seal, kus ta töötab — aga vaikeväärtus
kasutas seda ainult siis, kui keegi mäletas seda valida.

Ümberpööramine üksi ei olnud võimalik: `contributor` ilma `edit_collections`-ita
ei saa ADR 0031 järgi midagi muuta. Seepärast tuli enne luua koht, kust ulatus
kinnitamise hetkel tuleb — taotleja märgib registreerimisvormil kuni kolm
huvipakkuvat kogu, mis eeltäidab admini valiku (sama issue, eelmine samm).

## Otsus

**1. Vaikeroll on `contributor`** nii admini ekraanil kui serveris.
`editor` (kogu korpus) on admini teadlik valik.

**2. Iga väärtus peale `contributor`/`editor` annab `contributor`-i.** Puuduv
(`None`), tundmatu („contributer") ja lubamatu („admin") on sama vastus.
ADR 0031 leid 5 eristas PUUDUVAT väärtust tagasiühilduvuse nimel; see vahe on
nüüd tahtlikult kaotatud. Vana klient, mis `role` võtit ei saada, peab saama
KITSAMA konto, mitte laiema.

**3. Sama reegel kehtib ka tarbimisteel** (`create_user_from_invite`): vana
tokenifail ilma `role` võtmeta annab `contributor`-i, mitte `editor`-i.

**4. Taotleja huvivalik on SOOV, mitte volitus.** Ta eeltäidab ulatuse; otsuse
teeb admin. Piir (3 kogu) on soovil, admini valik on piiramata.

## Tagajärjed

- Ulatuseta contributor ei saa midagi muuta. See on **parandatav** seisund
  (admin annab ulatuse Kasutajate lehelt) — erinevalt vaikimisi antud kogu
  korpuse kirjutamisõigusest, mida keegi ei pruugi kunagi märgata.
- Admini kinnitusekraan ei luba contributor'it ilma ulatuseta kinnitada
  (nupp on väljas). Vaikeroll muudab selle tavateeks: iga uus konto saab
  teadliku ulatuse.
- Rollitõstmine käib endiselt eraldi admin-tegevusena (`update_user_role`),
  mitte kutse kaudu; kutselink ei tekita KUNAGI admin- ega superadmin-kontot.

## Alternatiivid

**Jätta `None → editor` alles.** Säilitaks ADR 0031 leid 5 vahe, aga just see
tee tekitab vaikselt laiema konto siis, kui klient on vana või päring
poolik — täpselt siis, kui keegi ei vaata.

**Piirata ka admini ulatust (nt 3 kogu).** Piir loomishetkel oleks ummistus,
mille keegi mõne kuu pärast eemaldaks: kaastööline võib päris töös vabalt
nelja kogu vajada. Piir kuulub soovile, kus ta annab kinnitajale signaali.
