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
   `title`. Väljanimi ei muutu, täisreindeksit pole vaja (ADR 0006).
2. **`title_devised: true`** — pealkiri on koostatud, mitte transkribeeritud.
   Puudumine = `false`. Kuvamisotsus tuleneb sellest lipust, **MITTE `type`-ist**.
3. **`title_en`** (hiljem vajadusel `title_de` jne) — pealkirja tõlge, keel
   väljanimes nagu ADR 0039/0063. Uus keel = uus väli; kuvamisreegel ei muutu.
4. **Kuvamine** käib ühe abilise kaudu (`workDisplayTitle(work, lang)`), mitte
   igas komponendis eraldi:

   | | liidese keele tõlge olemas | tõlget pole |
   |---|---|---|
   | koostatud | põhireal tõlge; teose lehel originaal väiksemalt all | `title` |
   | transkribeeritud | põhireal `title`; tõlge teise reana | `title` |

5. **Otsing:** `title_*` väljad lähevad `meili_doc.py`-sse ja otsitavate väljade
   hulka (`meili_settings.py`) — ingliskeelne päring leiab ingliskeelse pealkirja.
6. **Migratsioon:** 24 ` / `-ga kirjet jagatakse **käsitsi kinnitatud nimekirja**
   järgi, mitte regexiga (vt punkt 2 kontekstis). Kõigile käsikirjadele, mille
   pealkiri on deskriptiivne, seatakse `title_devised: true` sama nimekirja alusel.

Teadlikult EI tehta praegu: eraldi `title_original` välja (käsikirja enda
pealkiri, nt *Protocollum Senatus*). Tühi väli segaks vormi; lisamine hiljem ei
murra midagi.

## Tagajärjed

- Uus pealkirja kuvamiskoht kasutab `workDisplayTitle`-it — paljas `work.title`
  näitaks ingliskeelsele lugejale eestikeelset deskriptiivset pealkirja.
- ` / ` pealkirja sees ei ole enam lubatud keelte eraldajana; vorm võiks selle
  peale hoiatada.
- ADA import (`server/ada/mapping.py`) võtab praegu ainult `[et]` `dc.title`-i;
  kui ADA kirjel on `[en]` pealkiri, tuleb see `title_en`-i ja lipp `true`.
- Segateose materjal (trükis/käsikiri osade kaupa) on eraldi küsimus — see
  ADR ei lahenda, kuidas `type` ja OCR-mudel osade lõikes käituvad.
