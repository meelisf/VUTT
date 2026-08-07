# 0016 — Igal välisel rikastusallikal on varutee ja lühike timeout

**Staatus:** kehtib

## Kontekst

Prosopograafia rikastus (`server/prosopography/enrichment.py`) ja isikuotsing
(`EnrichmentSearch`) sõltuvad neljast välisallikast: Wikidata SPARQL, GND,
VIAF ja kohalik AA-fail. 2026-08-07 läksid neist kaks korraga katki, kahel
erineval põhjusel, ja tagajärg oli suurem kui kummagi allika kaotus eraldi.

**VIAF muutis API-t.** Vanad JSON-teed `/viaf/{id}/justlinks.json` ja
`/viaf/{id}/viaf.json` ei vasta enam 200-ga — need on **404**, päriselt maha
võetud. Uus `viaf.org/en/viaf/{id}` on Cloudflare'i taga Next.js-rakendus,
mis laeb andmed kliendipoolselt: HTML-is neid ei ole ja skriptitud päringule
vastab Cloudflare 403-ga. Meie kood oli tükk aega vaikselt katki — kasutaja
nägi ainult „Andmete laadimine ebaõnnestus".

**lobid.org kadus võrgust.** Mitte tõrge, vaid täielik kättesaamatus: ei ICMP,
ei TCP 80, ei TCP 443, kahest sõltumatust võrgust. lobid oli GND ainuke tee
**mõlemal** poolel — serveris rikastus, brauseris otsing.

Ja siin tuli välja tegelik kahju. `EnrichmentSearch.handleSearch` käivitab
kolm otsingut `Promise.allSettled`-iga, mis ootab **kõiki**. Rippuv lobid-päring
15 s timeoutiga hoidis kogu välisotsingut kinni ja võttis terved Wikidata
tulemused endaga kaasa. Kasutajale paistis, et katki on ka Wikidata — mis ta ei
olnud: serveripoolne SPARQL vastas kogu aeg 0,2 sekundiga. **Üks maas allikas
lõhkus kolm.**

## Otsus

Iga väline rikastusallikas peab taluma teise allika seisakut. Kolm reeglit:

1. **Igal allikal on varutee eelistatuma allika taga.** GND: esmalt
   `lobid.org` (annab kohad ja ametid siltidega), tõrke korral otse
   `d-nb.info` JSON-LD (server) ja `services.dnb.de` SRU (brauser). Varutee
   ei pea olema sama rikkalik — parem osaline vastus kui mitte ühtegi.

2. **Timeout-eelarve peab mahtuma kliendi omasse.** Kliendi
   `fetchWithTimeout` katkestab rikastuse eelvaate 15 s pealt. Serveripoolne
   ahel (allikas + varutee) peab lõppema enne seda, seega esimese lüli timeout
   on `_LOBID_TIMEOUT = 4`, mitte tavapärane 15. Ahel, mille summa ületab
   kliendi eelarve, on sama katki kui varuteeta ahel.

3. **Eelvaate koondpäring ei tohi oodata aeglaseimat allikat.** Kui allikaid
   küsitakse paralleelselt ühe tulemuse jaoks, saab iga allikas oma lühikese
   timeouti — üks maas allikas ei tohi teiste tulemusi kinni hoida.

VIAF-i rikastus käib nüüd sisusobitusega (content negotiation) vana tee peal:
`GET https://viaf.org/viaf/{id}` päisega `Accept: application/rdf+xml`. See
vastab endiselt 200-ga ka meie enda User-Agentiga.

## Tagajärjed

- **Uue välisallika lisamisel küsi kohe: mis juhtub, kui see on maas?** Kui
  vastus on „otsing ei tööta", ei ole allikas valmis. Ilma varuteeta allikas
  on lubatud ainult siis, kui ta ei jaga koondpäringut teiste allikatega.

- **Brauseripoolne allikas nõuab CSP `connect-src` rida** —
  `nginx.host.conf`, **KAHEL real** (`add_header` ja `more_set_headers`), ja
  hostis `/etc/nginx/sites-available/vutt`. Ilma selleta blokeerib brauser
  päringu vaikselt ja veaotsing algab jälle nullist.

- **Brauseripoolne allikas nõuab CORS-i allika enda poolelt.**
  `services.dnb.de` saadab `access-control-allow-origin: *`, seega sobib.
  `d-nb.info` EI saada — tema on ainult serveripoolseks kasutuseks.

- **DNB varutee ei anna sünni-/surmakohta ega ameteid.** DNB viitab neile
  ainult GND-URI-ga ilma sildita; lobid lahendas sildid ise. Nende toomine
  nõuaks eraldi päringut iga viite kohta. Kohad ja ametid tulevad tagasi
  automaatselt, kui lobid taastub — varutee ei ole püsiv allakäik.

- **Tõrge tuleb logida.** Enne seda neelasid kõik fetcherid iga erindi
  (`except Exception: return None`) ja tagastasid ühe ja sama teate
  „Andmete laadimine ebaõnnestus". Logides ei olnud midagi, mistõttu ei olnud
  võimalik eristada võrgutõrget, 403-blokeeringut ja vale ID-d. Iga fetcheri
  veaharu logib nüüd `logger.warning`-uga URL-i ja erindi.

- **VIAF-i RDF-il on kaks lõksu**, mõlemad testidega kaetud
  (`tests/test_enrichment_viaf.py`):
  `schema:name` ja `schema:alternateName` **liidavad ees- ja perekonnanime
  tühikuta** („KarlKühlstaedt"). Tühik pannakse tagasi sama kirje
  `givenName`/`familyName` osade järgi — täpne sobitus, MITTE suurtähe-heuristika,
  mis lõhuks „McDonald"i. Ja `schema:gender` on samuti Wikidata Q-kood
  (Q6581097 = mees), seega seotud ID-d loetakse **ainult** `schema:sameAs` alt.

- **`skos:altLabel` VIAF-ist ei kõlba aliasteks** — pööratud kujul ja eluaastad
  on nime küljes kinni („Kühlstädt, Karl1805-1838").

## Alternatiivid

**Kraapida `explore.gnd.network`-i või VIAF-i uut veebiliidest.** Mõlemad on
HTML-liidesed botituvastusega ja muutuvad ette teatamata — täpselt see, mis
praeguse rikke põhjustas. Mõlemal on olemas ametlik masinliides. Lükati tagasi.

**Loobuda lobidist ja kasutada ainult DNB-d.** Lihtsam kood, aga kaotaks
lobidi parema asetuse otsingus ning kohtade ja ametite sildid. Lükati tagasi:
lobid jääb eelistatuks, DNB varuteeks.

**Ainult timeouti lühendada, varuteeta.** Otsing ei jääks kinni, aga GND
rikastus ei töötaks seisaku ajal üldse. Ebapiisav.

## Viited

- `server/prosopography/enrichment.py` — `_fetch_viaf` / `_parse_viaf_rdf`,
  `_fetch_gnd` / `_fetch_gnd_dnb` / `_parse_dnb_jsonld`, `_LOBID_TIMEOUT`
- `src/services/gndService.ts` — `searchGndLobid` → `searchGndSru`
- `src/prosopography/components/personForm/EnrichmentSearch.tsx` — koondotsing
- `nginx.host.conf` — CSP `connect-src` (kaks rida)
- Testid: `tests/test_enrichment_viaf.py`, `tests/test_enrichment_gnd.py`
- Seotud: ADR 0002 (blokeeriv I/O ei kuulu `async def` sisse — sama
  õppetund ühe aeglase väliskutse mõjust tervikule)
