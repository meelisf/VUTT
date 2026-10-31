# 0075 — Teoste seos: üks kirjutustee, vastastikune, ainult variant

**Staatus:** kehtib

## Kontekst

Mõnel trükisel on kaks sisuliselt erinevat varianti, ja mõlemad tuleb säilitada
eraldi teostena koos seosega (#696 reegel 4; esimene juhtum `nri7ga`, *Series
lectionum* 1702: Rīga LAB ja Uppsala UB eksemplaris on professorite järjekord
erinev). `_metadata.json` väli `relations` (`{id, rel_type, label?}`) oli olemas
algusest peale, aga seda ei saanud lisada ega näha, ja ta läbis `/update-work-metadata`-i
ilma kontrollita. Tootmises ei olnud ühelgi teosel seost (2026-11-01). Kavand:
`docs/superpowers/specs/2026-10-31-seotud-teosed-variant-design.md` (#701).

## Otsus

- **Ainus kirjutustee** on `PUT /works/{id}/relations` (`server/routers/work_relations.py`,
  loogika `server/work_relations.py`), `require_role("admin")` + `can_write_work` mõlemale
  teosele. `/update-work-metadata` lükkab `relations` tagasi (400), nagu `parts`-i (ADR 0057).
- **Vastastikune:** iga muutus kirjutatakse mõlemasse teosesse ühe range
  `bulk_update_works(all_or_nothing=True)` partiiga: kõik transformid enne kirjutamist,
  ükskõik milline viga katkestab. Kirjutus- ja commiti viga pööratakse tagasi
  `save_with_git(rollback_on_error=True)`-s **`_git_write_lock`-i all** (failid baithaaval
  algseisu, `git reset`), sest staged indeks luku vabastamise järel satuks mõne
  `repo.index.commit()`-i kasutava tee commiti. Garantii: üks commit või mitte midagi.
  Erand: kui ka tagasipööramine ebaõnnestub, on mõlemad pooled kettal, viga läheb
  `record_server_error`-isse ja ajalukku võivad pooled jõuda eraldi.
- Pöördliik ühes tabelis `INVERSE = {"isVersionOf": "isVersionOf"}`. Lubatud on praegu
  ainult `isVersionOf`: „viitab" lahendatakse märksõnaga, füüsilise kooskuuluvuse katab
  konvoluut (#702), mitmeköitelise teose `series`.
- **„Seoseid pole" = võtme puudumine.** `drop_empty_relations` eemaldab tühja loendi;
  muidu tekitaks no-op eemaldus tühja kirjutuse ja commiti (ADR 0012).
- **`label` ei ole tõeallikas** ja uued kirjed seda ei salvesta. Pealkiri tuleb
  `GET /works/{id}/relations`-ist, mis loeb sihtteose metaandmed kettalt kuvamise hetkel.
- **Piiratud sihtteose pealkiri ja aasta on nähtavad** (`readable: false`, lingita):
  seose olemasolu ei ole saladus, kaitstakse pilte ja teksti. GET nõuab lugemisõigust
  lähteteosele, nii et see ei ole üldine pealkirjaoraakel. Vastus sõltub kasutajast →
  ei lähe `server/cache.py`-sse (ADR 0042).
- **Kustutus:** `admin_work_delete` hoiab `metadata_lock`-i seoste lugemisest kausta
  eemaldamiseni. `cleanup_for_deletion` eemaldab ühe range partiiga seosed nii
  kustutatavalt teoselt kui vastaspooltelt; rippuvad sihtmärgid jäetakse välja;
  kustutatav teos Meili sünki ei saa (`skip_sync_paths`), vastaspoolte sünk käib
  `background_tasks`-iga väljaspool lukku. Koristuse viga katkestab kustutuse (teos
  alles oma seostega); hilisem viga jätab seosteta teose, mitte ühepoolse seose.
- **Taastamine** eemaldab taastatud teose `relations`-i ja stage'ib faili uuesti enne
  taastamise commiti (`git checkout` täidab indeksi vana sisuga). Tavaliselt on
  `<commit>^` juba koristuscommit; see on kaitse vanade ja käsitsi kustutuste vastu.

## Tagajärjed

- Uus seose liik = rida `INVERSE`-is + kuvamise silt; kirjutus- ja kustutusloogika ei muutu.
- Uus `relations`-it kirjutav tee peab minema `apply_relation_changes` kaudu, muidu
  tekib ühepoolne seos.
- `bulk_update_works` vaikekäitumine (osaline rike lubatud) jääb muutumatuks; range
  režiim on ainult selgesõnaline valik.
