# 0089 — Lehestiku asendus: taastatavus, kirjutuskaitse ja transkriptsiooni aluse vahetus

**Staatus:** vastu võetud 2026-11-25

## Kontekst

Teose kogu lehestiku asendus (`replace_work_content`, upload „Asenda sisu") oli kirjutatud
eeldusega, et see õnnestub ühe hooga. Aluse vahetuse disaini kolm ülevaatust
(`docs/superpowers/specs/2026-11-25-transkriptsiooni-aluse-vahetus-design.md`) leidsid
olemasolevas asenduses vead, mis on tootmises juba praegu:

- asendus võttis sihtteose ID URL-ist ega võrrelnud seda üleslaadimisse salvestatud
  `replace_work_id`-ga;
- rollback (`git checkout old_head -- slug`) jättis alles uued, juba stage'itud failid ning JPG-d
  (gitist väljas, vana ja uus leht sama failinimega) ei olnud taastamises arvestatud;
- `work_lock` kaob koos protsessiga — katkestuse järel võisid `/save` ja lehetoimingud jätkata
  poolikul lehestikul;
- uued lehed saavad samad tüved kui vanad: vana lehe pealt avatud redaktori salvestus liideti
  kolmesuunaliselt (ADR 0054) uue lehe peale; `/save` kontrollis lehe olemasolu enne lehe lukku;
- `sync_work_parts` jättis osadesse kõik tüved, mis esinevad ka uues lehestikus — osad viitasid
  vaikselt teise sisuga lehtedele.

Lisaks vajab eksemplari kiht (ADR 0076, 0079) tööriista, mis teeb teise eksemplari piltidest
teose lehestiku („Tee transkriptsiooni aluseks").

## Otsus

### 1. Asenduse sidumine

`replace-work/{work_id}` nõuab, et URL-i `work_id` == state'i `replace_work_id`; muidu 409.

### 2. Asendusmärk ja kirjutuskaitse

Enne esimest failimuutust kirjutatakse `state/work_replacing/{slug}.json` (`{upload_id, at}`)
ja eemaldatakse pärast edukat avaldamist (uued lehed + `content_generation` kirjas) või
taastamise lõppu. Märgi olemasolul lükkavad `page_lock` ja `work_lock` tagasi kõik peale märgi
omaniku (`WorkReplacingError` → 409). Serveri käivitusel taastatakse/tuvastatakse kõik märgid.

### 3. Taastatav asendus

- Taasteinfo (`replace_progress`: `phase`, `old_head`, `trash_dir`, `old_jpgs`, `new_files`)
  kirjutatakse upload state'i enne esimest failimuutust.
- Asenduse commit kannab treilerit `Upload: <upload_id>`; katkestuse järel otsustab kordus selle
  järgi, kas asendus on tehtud.
- Taastamine eemaldab jälgitavad failid, mida `old_head`-is ei ole, ja teeb `git checkout
  old_head -- slug`. **JPG-d** taastatakse prügikasti oleku järgi: vana fail prügikastis →
  algses asukohas olev samanimeline fail on uus (kustuta, too vana tagasi); vana fail ei jõudnud
  prügikasti → jäta puutumata. JPG kustutatakse ainult siis, kui tema vana vaste on prügikastis.

### 4. Lehe põlvkond

Asendus kirjutab iga uue lehe JSON-i serverivälja `content_generation`
(`SERVERIPOOLSED_LEHE_VALJAD`). `/save` võrdleb leheluku SEES kliendi `meta_content`-i
`content_generation`-it ketta omaga ja kontrollib lehe olemasolu samas lukus; erinev → 409
„lehestik asendati, laadi leht uuesti" (ADR 0077 mustri järgi, mitte kolmesuunaline liitmine).

### 5. Osad asendusel

Kogu lehestiku asendusel: iga osa `pages = []`, `needs_review: true`, serveriväli
`pages_before_replace: {at, page_numbers}`. Lehtede uuesti määramine kustutab välja.

### 6. Transkriptsiooni aluse vahetus

Eksemplari pildid → asendusrežiimis üleslaadimine (`promote`), lõpetamine idempotentselt
(vanad lehed oma päritolu eksemplari alla allikaliigiga `former_pages`, tunnistaja märge, ainult
täielikult commit'itud lähtepiltide eemaldus). Täpsus: disainifail. Teostatakse eraldi PR-ina
p 1–5 peale.

## Tagajärjed

- Asendus on aeglasem ja keerukam, aga katkestus ei jäta enam teost poolikusse seisu.
- Pärast asendust saavad avatud redaktorid 409 ja peavad lehe uuesti laadima.
- Asendusega teose osad vajavad toimetaja ülevaatust (lehed tuleb uuesti määrata).
- Uus serveri lehe-väli `content_generation` ja osa väli `pages_before_replace`.
