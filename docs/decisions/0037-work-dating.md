# Teose dateering päeva või kuu täpsusega

Teos saab valikulise `dating` objekti. Kuupäev tähendab allikal seisvat kuupäeva;
kalendrit vaikimisi ei eeldata ega teisendata. Iga kirja eraldi kirjeks jagamine
on eraldi sisutöö.

```json
{
  "dating": {
    "start": "1803-05-15",
    "end": "1804-06-15",
    "calendar": "julian",
    "kind": "uncertain",
    "approximate": false,
    "source_text": "15-05-1803 - 15-06-1804",
    "note": "Uurija põhjendus"
  }
}
```

Ainus kohustuslik võti on `start`. Kuju `1803`, `1803-05` või `1803-05-15`
säilitab täpsuse; puuduvaid komponente ei täideta. `end` lisab vahemiku.
`kind=span` tähendab kirjutamist perioodi jooksul, `uncertain` võimalikku
kirjutamisaega nende piiride vahel. Puuduv kind ei eelda kumbagi tõlgendust.
Kalendri valikud on julian, gregorian, swedish; välja puudumine tähendab määramata.
`approximate` ei tekita automaatselt suvalist veapiiri. Teadaolevad võimalikud
piirid tuleb märkida vahemikuna. Algne vabatekst säilib `source_text` väljal.

`year` ja `year_display` säilivad ühilduvuseks. Struktureeritud dateeringu
salvestamisel tuletatakse need serveris. Vana vabateksti ei migreerita üle:
indekseerimisel ja kuvamisel tuvastatakse vaid ühesed arvulised kuupäevad ja
vahemikud. Sajandite ja `ca.` senine aastaparser töötab edasi.

Meilisearch: `dating` kannab struktuuri; `date_start`, `date_end` on YYYYMMDD
arvulised piirid, `date_sort` alguspiir. Puuduva kuu/päeva otsingupiirid on
01/01 ja 12/31; päeva 31 ülemine piir on sentinel, mitte väide tegeliku
kuupäeva kohta. Võrreldakse **kirjal seisvaid numbreid**, mitte eri kalendrite
ühtsele ajateljele teisendatud hetki. Teadmata dateeringu piirid on 0.

UX: metaandmetes Dateering + Täpsusta; kuud sõnalise valikuna, päev valikuline.
Kalender, ebakindlus ja märkus on Dateeringu lisainfo all. Eesti ja inglise
kuva tulevad tõlgetest. Otsingus säilivad aastalahtrid; Täpsusta avab kuud ja
päevad. Kokku pandud filtril jääb täpne piirang sõnaliselt nähtavaks.
URL-i `ys` ja `ye` toetavad lisaks aastatele osalisi ISO-kuupäevi. Aastapäring
kasutab seniseid year_start/year_end välju; kuu/päevapäring date_start/date_end.
Kattuvus kaasab ka vähem täpsed dateeringud, tulemused tähistavad seda.
Vigane või tagurpidi otsinguvahemik ei laienda otsingut vaikselt.

MCP aastafilter kasutab samuti kattuvust ning kuvab year_display enne year-i.
MCP päevafiltrid, kõigi aastate kuufilter ja kuunimede tõlgendamine vabatekstilisest
otsingukastist ei kuulu sellesse muudatusse.

## Kasutuselevõtt

1. Paigalda backend koos uute indekseerimisväljadega.
2. Käivita backendiga samas keskkonnas `python3 scripts/backfill_work_dates.py --data-dir data`.
3. Rakenda `--apply` abil. Skript lisab indeksi seadetesse filtrid ja sortimise
   ning uuendab ainult nelja dateeringuvälja olemasolevatel dokumentidel.
   Algseid metaandmefaile ei muudeta ja indeksit ei kustutata.
4. Korda eelvaadet: ootel muudatusi peab olema 0. Seejärel paigalda frontend.

Samaaegsed metaandmete muudatused backfill'i ajal võivad nõuda teist läbimist;
viimane eelvaade peab olema puhas. Vanale frontendile on uued väljad kahjutud.
Täisindeksi loomine kasutab samu dateeringufunktsioone ja kanoonilisi seadeid.
