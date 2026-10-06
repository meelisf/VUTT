# ADR 0064 — Pealkirja tõlge on keelega väljas, kuvamise otsustab pealkirja tekkeviis

**Kuupäev:** 2026-10-06
**Staatus:** ettepanek
**Seotud:** ADR 0006 (Meili legacy-väljanimed), ADR 0039 (sisuvälja keel on
väljanimes), ADR 0063 (osa kokkuvõte keelega väljades)

## Kontekst

Teose `title` on üks string. Käsikirjadel on see enamasti kataloogija koostatud
(deskriptiivne) pealkiri ja osa neist kannab mõlemat keelt ` / `-ga liidetuna
(mõõdetud 2026-10-06: 166 käsikirjast 24 sisaldab ` / `-d):

```
Tartu Ülikooli (Academia Gustaviana) senati protokollid : kontseptid / Minutes of the Senate of …
```

Kolm probleemi:

1. **Teine keel ei jõua lugejani.** Kaart lõikab pealkirja kahele reale
   (`WorkCard.tsx`, `line-clamp-2`) — ingliskeelne osa ei ole kunagi näha, ka mitte
   ingliskeelses liideses.
2. **` / ` ei ole eraldaja.** ISBD-s tähendab ta vastutusandmeid („… põhikiri /
   ümber kirjutanud H. Baumann"), mujal on ta nimevariandi sees („Oesel [Ösel /
   Saaremaa]"). Automaatne poolitus annaks vale tulemuse.
3. **Tüüp ei ütle, kuidas pealkiri tekkis.** Trükise pealkiri on allikast
   transkribeeritud ega kuulu tõlkimisele; käsikirja deskriptiivne pealkiri on
   kataloogija tõlgendus ja seega keeleline. Aga segateos (nt `17qy3r`: trükitud
   disputatsioon + käsikirjaline osa, tüüp `Q87167`) kannab trükise pealkirja —
   reegel „käsikiri ⇒ tõlgitav pealkiri" oleks vale.

## Otsus

1. **`title`** jääb põhipealkirjaks oma keeles — otsing, sortimine, Meili
   `title`. Väljanimi ei muutu (ADR 0006); täisreindeks on vaja ainult uute
   väljade pärast (punkt 6), mitte ümbernimetuse.
2. **`title_devised: true`** — pealkiri on koostatud, mitte transkribeeritud.
   Puudumine = `false`. Kuvamisotsus tuleneb sellest lipust, **MITTE `type`-ist**.
3. **`title_en`** (hiljem vajadusel `title_de` jne) — pealkirja tõlge, keel
   väljanimes nagu ADR 0039/0063. Uus keel = uus väli; kuvamisreegel ei muutu.
4. **`title_original`** — allikast transkribeeritud pealkiri, kui see erineb
   `title`-ist (käsikiri, mille enda pealkiri ei ole põhipealkiri). `title` EI
   tähenda „originaal": enamikul käsikirjadel (kirjad, aruanded, dokumendikogud)
   oma pealkirja pole, ja kui `title` kannaks kord originaali, kord koostatut,
   oleks sortimise ja Meili `title`-i tähendus kõikuv. Näide `0ajcsn`:

   | väli | väärtus |
   |---|---|
   | `title` | Tartu Ülikooli (Academia Gustaviana) senati protokollid : kontseptid |
   | `title_en` | Minutes of the Senate of Tartu Ülikool (Academia Gustaviana) : drafts |
   | `title_original` | Protocollum Sub Rectore Magnifico Andreae Virginio D. D. Theol. |
   | `title_devised` | `true` |

5. **Kuvamine** käib ühe abilise kaudu (`workDisplayTitle(work, lang)`), mitte
   igas komponendis eraldi:

   | | liidese keele tõlge olemas | tõlget pole |
   |---|---|---|
   | koostatud | põhireal tõlge; teose lehel originaal väiksemalt all | `title` |
   | transkribeeritud | põhireal `title`; tõlge teise reana | `title` |

   Koostatud pealkirjaga teose kaardil on `title_original` teine rida. Põhjus,
   miks koostatud pealkiri on ees: lugeja otsib dashboardilt, MIS dokument see
   on; samasarjalised originaalpealkirjad („Protocollum Sub Rectore …") ei erista
   teoseid. Sama on arhiivikirjelduse tava (koostatud pealkiri põhiline,
   originaal märkuses). Teose lehel on näha kõik väljad.

6. **Otsing:** `title_en` ja `title_original` (ja iga hilisem `title_*`) lähevad
   `meili_doc.py`-sse — igas dokumendis olemas, vajadusel tühja stringina —,
   `SEARCHABLE_ATTRIBUTES`-isse (`meili_settings.py`) JA dashboardi
   `attributesToSearchOn`-i (`searchService.ts`). Ainult indeksisse lisamine ei
   piisa: dashboard otsib selgesõnalise väljaloendi järgi. Rakendub täisreindeksiga.
7. **Migratsioon:** 24 ` / `-ga kirjet jagatakse **käsitsi kinnitatud nimekirja**
   järgi, mitte regexiga (vt punkt 2 kontekstis). Kõigile käsikirjadele, mille
   pealkiri on deskriptiivne, seatakse `title_devised: true` sama nimekirja alusel.

## Tagajärjed

- Uus pealkirja kuvamiskoht kasutab `workDisplayTitle`-it — paljas `work.title`
  näitaks ingliskeelsele lugejale eestikeelset deskriptiivset pealkirja.
- Uus pealkirjaväli = `meili_doc.py` + `SEARCHABLE_ATTRIBUTES` + dashboardi
  `attributesToSearchOn`; puudub üks, ei leia dashboard teda.
- ` / ` pealkirja sees ei ole enam lubatud keelte eraldajana; vorm võiks selle
  peale hoiatada.
- ` / `-pealkirjade allikas oli ADA lookup (`/admin/ada/lookup`): Gemini
  ingliskeelne masintõlge liideti pealkirja `"{et} / {en}"` kujul. Nüüd tuleb
  tõlge `title_en_suggestion`-is ja läheb upload'i `title_en`-i — ühte lahtrisse
  kahte keelt EI liideta.
- Upload kannab väljad loomisest (`create_upload`) ja sammu 3 vormist
  (`update_upload_meta` allow-list) impordini. Käsikirja tüübiga upload saab
  `title_devised: true` vaikimisi — see on salvestatud otsus, mitte kuvamisaegne
  tuletus tüübist.
- Segateose materjal (trükis/käsikiri osade kaupa) on eraldi küsimus — see
  ADR ei lahenda, kuidas `type` ja OCR-mudel osade lõikes käituvad.
