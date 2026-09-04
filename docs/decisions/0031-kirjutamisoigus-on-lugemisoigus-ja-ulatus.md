# ADR 0031 — Kirjutamisõigus on lugemisõigus JA ulatus

**Kuupäev:** 2026-09-04
**Staatus:** vastu võetud
**Seotud:** ADR 0007 (tuletatud indeksid), ADR 0012 (muutusteta salvestus)
**Spekk:** `docs/superpowers/specs/2026-09-04-contributor-kollektsiooni-ulatus-design.md`

## Kontekst

`contributor` on senini kasutamata roll: rollihierarhias eksisteerib
(`contributor < editor < admin < superadmin`), aga `can_write_work` ei ole
teda kunagi editorist eristanud — iga loetav teos oli ka kirjutatav. Rolli
kavatsuslik tähendus on kitsam: contributor peab toimetama ainult oma
kollektsioonides, mitte kogu korpuses.

Ulatuse-reegel puudutab iga tulevast kirjutusteed (salvestus, kommentaar,
prosopograafia link jne). Kui reegel elaks laiali igas endpoint'is, lahkneks
ta paratamatult ajas — üks tee kontrollib, teine unustab.

## Otsus

**1. Kirjutamisõigus = lugemisõigus JA ulatus, ühes funktsioonis.**

`can_write_work` (`server/access_ops.py`) teeb mõlemad kontrollid järjest:

1. `can_read_work` — kirjutamisõigus EI anna kunagi lugemisõigust. Kui teos
   ei ole kasutajale loetav, ei ole ta talle kirjutatav, sõltumata ulatusest.
2. Ulatus — ainult `contributor`-rollile. `editor` ja üle selle ulatust ei
   piirata ja `edit_collections` välja eiratakse täielikult. Contributor
   tohib kirjutada ainult teostesse, mille `collections` lõikub tema
   `edit_collections`-iga. Kollektsioonita teos (`collections: []`) ei ole
   contributor'ile kirjutatav — fail-closed, mitte fail-open.

Puuduv või tühi `edit_collections` tähendab tühja ulatust, mitte piiramatut
ulatust.

**2. Õigusotsust ei tehta tuletatud indeksi põhjal.**

`work_collections_index.json` (vt ADR 0007) on read-model, mis on igal ajal
nullist taastatav (`rebuild_indices()`). Kui `can_write_work` sõltuks temast:

- indeksi puudumine või taaskoostamise aken teeks otsuse ettearvamatuks;
- fail-open tõlgendus (indeks puudub → luba) lekitaks kirjutusõigust;
- fail-closed tõlgendus (indeks puudub → keeld) lukustaks kasutaja välja
  ajutiselt, ilma et miski oleks päriselt muutunud.

Autoriteet on `_metadata.json`-i `collections` väli, mis on juba
`can_write_work`-i argument (`work_metadata`). Tuletatud indeks tohib
kandidaate kitsendada (nt UI-s "millised teosed kuuluvad mulle" loendi
koostamisel), aga ei tohi olla osa õigusotsuse enda arvutuskäigust.

## Tagajärjed

Iga uus kirjutustee kutsub `can_write_work`-i, mitte ei kirjuta oma
paralleelset kontrolli. `tests/test_access_ops.py::test_decision_does_not_consult_derived_index`
valvab teist otsust — see monkeypatchib
`server.prosopography.indices._load_work_collections`-i nii, et selle
kutsumine annab `AssertionError`, ja kutsub seejärel `can_write_work`-i;
kui mõni tulevane muudatus paneb õigusotsuse seda indeksit lugema, kukub
test.

## Mis EI muutu

`can_read_work` on muutumata — see ADR ei puuduta lugemisõigust ennast,
ainult kirjutamisõiguse lisatingimust. `editor` ja `admin` käitumine
`can_write_work`-is on muutumata (ulatust neile ei kohaldata).
