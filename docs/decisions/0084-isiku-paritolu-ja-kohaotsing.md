# 0084. Üks päritolukoht ja ühine kohaotsing

Kuupäev: 2026-11-13. Staatus: vastu võetud, teostatud.

Isikuvormi sünnikoht (Wikidata viide kuupäeva sees) ja eraldi päritolukoht
(koharegistri võti) dubleerisid teineteist. Kohavalikud peitusid väikese
„täpsem” nupu taga ning olemasoleva registrikoha Q-koodi muutmine ei laadinud
koordinaate. Tønder Q3223979-l olid Wikidatas P625 koordinaadid olemas, kuid
VUTT-i registris `coordinates: null`.

## Vorm ja andmed

Üks „Eluandmed” plokk, kõrvuti sünd ja surm. Aasta, kuu, päev, **Päritolu** ja
**Surmakoht** on alati nähtaval. „Kuupäeva täpsustused” avab ainult
ligikaudsuse, enne/pärast ja kalendri; täidetud täpsustused avanevad kohe.
Päritolu ja surmakoht jäävad enne avanevat osa, ühele visuaalsele tasemele.

Päritolu tähendab kõige täpsemat teadaolevat sünni- või päritolukohta:
linn, kihelkond või piirkond. See ei ole väide, et piirkonnana teadaolev
päritolu tõendab seal sündimist. Ajalooline grupeerimine jääb koharegistri
ülesandeks (ADR 0052). Surmakoht on eraldi fakt.

Kanooniline koha seos on `origin.place`. Uus vorm ei loo eraldi
`birth.place` seost, kui koht on registris lahendatud. Vana sünnikoht
leitakse Q-koodi järgi, nimi üksi ei seo. Täpsemat kohta eelistatakse
automaatselt ainult registri `parent_key` ahela tõendi alusel.
**Sama päritolugrupp üksi ei tõenda, et üks registrikoht sisaldab teist.**
Näiteks kui Riial on vaid `group: liivimaa`, aga puudub `parent_key: Livland`,
jääb vana Riia/Livland paari automaatne ühendamine ülevaatusele.

Vastuoluline varasem sünnikoht on vormis nähtav hoiatusena. Toimetaja
salvestatud valik määrab päritolu; varasem sünnikoht säilib kaardi `notes`
väljal koos Q-koodiga. Algse sünni-/surmakuupäeva märkused ja lähteandmed
säilivad. Lahendamata, registrivõtmeta vana sünnikoht jääb ühes päritoluväljas
nähtavaks ning säilib andmetes kuni toimetaja selle seob. Avalik kaart näitab
ühte „Päritolu” rida; sünnikuupäev ei korda kohta.

## Kohaotsing

Sama otsing töötab päritolu, surmakoha ning registrikoha lisamise ja muutmise
juures. Kohalik register enne Wikidatat. Wikidata vaste juures on kirjeldus,
Q-kood ja nimevariandid; otsida saab nime või Q-koodi järgi ning valida keelt.
Vaste valimisel laaditakse detailid ja koordinaadid enne vormi täitmist.
Detailipäringu tõrge ei jäta vormi poolikut Wikidata seost. Olemasoleva koha
muutmisel on laaditud väljad enne salvestamist toimetatavad; kohalikud nimed,
ajalooline grupp ja ülempiirkond säilivad. Koordinaatide käsiparandus eemaldab
Wikidata päritolumärke, kui arvväärtused muutuvad.

Brauseri otsing ootab 500 ms sisestuspausi ja eirab vananenud vastuseid.
Kõik päringud lähevad VUTT-i proksi kaudu. Otsing kasutab `wbsearchentities`
ja ühte partiilist detailipäringut geograafiliste kandidaatide eristamiseks;
isikuid ei pakuta, SPARQL-i ega päringut iga kandidaadi kohta ei kasutata.
Wikidata kirjeldused aitavad eristada näiteks linna, valda ja raudteejaama.

Proksi olemasolev piirang on 30 päringut minutis IP kohta. Kohtade Wikidata
transpordil on protsessi piires ühine lukk, kuni üks uus päring sekundis,
piiratud vahemälu (otsing 2 min, entiteedid 1 h) ja `Retry-After`/`maxlag`
ühine ooteaeg. Brauser koondab samaaegsed samad päringud, kasutab vahemälu
ning austab HTTP 429 `Retry-After` päist. Tõrge ei tähenda „vasteid pole”.
Mitme backend-protsessi korral on transpordi vahemälu ja ooteaeg protsessipõhine.

Sama Q-koodi ei saa lisada teise võtme alla. Uue koha lisamine märgib
`_create_only`, mida server kontrollib registri kirjutusluku all; nimekokkupõrge
ei kirjuta teist kohta üle.

## Olemasolevate andmete audit

Pärast juurutust käivita backend-konteineris esmalt:

```sh
python3 scripts/unify_person_origins.py
```

Vaikimisi ainult aruanne, ilma võrgu ja kirjutamiseta. `review` read vajavad
toimetaja otsust. `--apply` rakendab ainult ühesed Q-koodi ja registrihierarhia
alusel ühendamised tavapärase isikukirjutaja, `updated_at` kontrolli ja indeksite
uuenduse kaudu. See ei täida koordinaate ega muuda koharegistri hierarhiat.
Auditit ega migratsiooni ei käivitata rakenduse käivitumisel automaatselt.
