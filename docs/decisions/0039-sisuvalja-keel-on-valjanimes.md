# ADR 0039 — Sisuvälja keel on väljanimes

**Kuupäev:** 2026-09-10
**Staatus:** vastu võetud
**Seotud:** ADR 0008 (Markdown vabatekstis), ADR 0011 (i18n, `fallbackLng` väljas),
ADR 0022 (välise ID kanooniline kuju), ADR 0033 (serveripoolne kasutajale nähtav tekst)
**Issue:** prosopograafia ingliskeelne elulugu

## Kontekst

VUTT-i liides on kahes keeles, sisu ei ole. Isikukaardi `biography` väli kandis
seni **kahte eri asja korraga** (mõõdetud 2026-09-10, 2350 kaarti):

- **308 masinkopeeritud Album Academicumi kirjet** — struktureeritud allikakirjed
  saksakeelsete lühenditega (`AG: Dep.`, `Imm.`, `* 1604, † 1693`);
- **63 inimese kirjutatud proosalugu** — päris elulood, valdavalt eesti keeles.

Ingliskeelsel lugejal ei olnud kummastki midagi: AA-kirje ei ole loetav tekst ja
eestikeelne elulugu ei ole tema keeles. Ingliskeelsena kirjutatud sissekandel ei
olnud üldse kohta.

## Otsus

### 1. Keel on väljanimes

`biography_et`, `biography_en`, `aa_raw`. Väli `biography` **kaob skeemist**.
Ükski keeleväli ei ole „baas" ega „originaal" — mõlemad on võrdsed sisuväljad.
AA-toorik on kolmas, eraldi liik sisu: **kirje, mitte tekst**.

### 2. Ankur on kinnituse kirje, mitte salvestamise kõrvalmõju

Vananemisankur (`biography_et_src` / `biography_en_src`) kirjutatakse AINULT siis,
kui klient saatis selgesõnalise kinnituse (`_confirm_translation`). Kui ankur
uueneks iga salvestusega, kustutaks ingliskeelse kirjavea parandus hoiatuse ka
siis, kui eestikeelses tekstis muutus vahepeal sünniaasta.

`null` tähendab **„seost ei ole salvestatud"**, MITTE „see on originaal". Hoiatus
tühja ankru peale oleks vale hoiatus.

Ankru räsi arvutab **server**, salvestatava seisu pealt. Kliendi saadetud ankur
visatakse alati ära (`ANCHOR_FIELDS` pop) — muidu saaks klient hoiatuse vaigistada.

### 3. Räsi on ankur, commit ei ole

„Vaata, mis muutus" otsib ajaloost värskeima commiti, mille lähtevälja räsi võrdub
ankru räsiga. Salvestuseelne HEAD ei kõlba: kui toimetaja muudab ET-d, tõlgib selle
ja salvestab mõlemad korraga, on räsi uuest ET-st, aga HEAD osutaks vanale.

Leidmata jäänud commit annab ausa `found: false`, mitte vale diffi.

### 4. Indeks kannab iga allika kohta oma katget; varuvariandi valib vaade

Indeksikirjes on **neli** katget: `biography_snippet_et`, `biography_snippet_en`,
`notes_snippet`, `aa_snippet`. Igaüks on tuletatud täpselt ühest väljast.

Üks „biography_snippet" väli ei võimaldaks ausat silti: „ingliskeelses" katkes võiks
olla eestikeelne tekst. Valiku teeb TARBIJA (`biographyChain.ts`), sest ainult tema
teab, mida ta näidata tahab ja mis keeles lugeja on.

AA-kirje EI OLE kunagi **eluloo** varuvariant, aga ON **katke** ahela lõpp: ilma
selleta kaotaks 308 kaarti nimekirjas katke ära.

### 5. Ühendamisel ankur ei kandu kaasa

Kahe kaardi liitmisel on ankrud pärast ühendamist mõlemad `None` — välja arvatud
kui mõlemad keeleväljad tulid samalt kaardilt tühjale sihtmärgile. Kahtluse korral
`None`: kaotatud kinnitus on üks märkeruudu vajutus, vale kinnitus on vaikne viga.

### 6. Pärandväli tekitatakse uuesti, kui teda ei blokeeri

`update_person` teeb `person.update(data)`. Vana avatud vorm saadaks `biography`
tagasi ka pärast migratsiooni passi B ja skeem lahkneks vaikselt. Reegel:
identne sisu → vaikselt maha, erinev → 409.

## Tagajärjed

- **`GET /prosopography/{id}` kuju MUUTUS.** See endpoint on autentimata avalik
  (nginx `/api/files/` proksib kõik backend-teed) — iga väline tarbija näeb uut kuju.
- **Migratsioon käib expand–migrate–contract mustris:** pass A lisab uued väljad
  vana kõrvale, kontroll toimub tootmises, pass B eemaldab `biography`. Kuni passini B
  on kõik pöörduv.
- **MCP-pakett uueneb eraldi tempos** — `vutt_mcp` ei impordi `server`-it, väljanimed
  on seal stringid.
- **Kaks räsiteostust** (`server/prosopo_biography_fields.py::text_hash` ja
  `src/prosopography/utils/textHash.ts`) peavad kokku langema; nendevaheline leping on
  test, mille oodatav väärtus on genereeritud serveri funktsiooniga.

## Alternatiiv, mis kaaluti ja jäeti kõrvale

**`biography` jääb „originaali" pesaks, juurde tuleb `biography_en`.**

Kukub kahe küsimuse peale:

1. Mis keeles on „originaal"? Keelemärge oleks vale kohe 308 saksakeelsete
   lühenditega AA-kirje kohta.
2. Kuhu läheb sissekanne, mis kirjutati ingliskeelsena? „Originaali" pesa oleks
   sunnitud vale sildi alla.

Väljanimes olev keel ei nõua kummalegi vastust: iga väli ütleb ise, mis ta on.
