# Prosopograafia: isiku otsimine märksõna järgi

**Kuupäev:** 2026-07-31
**Staatus:** kinnitatud, ootab teostusplaani

## Probleem

Isikukaartidel on väli `tags` (märksõnad) — Wikidata-põhised entiteedid, nt
`{"label": "pietism", "id": "Q193664", "labels": {"et": "pietism", "en": "Pietism", …}}`.
Märksõnu saab lisada (`TagsList.tsx`, `PersonDetailPage`) ja neid **kuvatakse juba**
isikukaardil (`PersonCard.tsx:107–128`, pildi alumine vasak nurk) ning detailvaates.

Märksõna järgi **ei saa isikut leida**: `q`-otsing vaatab ainult nime, sort_name'i ja
aliaseid; ühtki märksõna-filtrit ei ole. Märksõnad on seetõttu praktiliselt kasutusest
väljas — serveris on 5 isikut märksõnaga, 4 unikaalset (`kantsler` Q373085,
`trükkal` Q175151, `pietism` Q193664, `Hernhuutlus` Q159318).

## Lähtekoht

`prosopography_index.json` **sisaldab juba märksõnu** täiskujul koos mitmekeelsete
labelitega — `_index_entry_from_person` kirjutab `"tags": person.get("tags") or []`
(`person_search.py:571`). Kontroll serveris: 2072/2072 kirjel on `tags` väli olemas.

**Migratsiooni ega indeksi ümberehitust ei ole vaja.**

## Lahendus

Kolm sisenemisteed märksõnani, kõik sama filtri peal:

1. **Vaba otsing** (`q`) leiab ka märksõna järgi.
2. **Märksõna-filter** külgribal (`PersonAdvancedFilters`), üksikvalik nagu teised filtrid.
3. **Klikitavad sildid** isikukaardil ja detailvaates → viivad filtreeritud nimekirja.

### Mitmikvaliku-valmidus

Mitut märksõna korraga valida praegu ei saa, aga vajadus võib tekkida. Seetõttu on
**andmelepe massiiv juba algusest peale** — backendi ei ole hiljem vaja puutuda:

- sisemine filter võtab `tags: Optional[list[str]]`, mitte skalaari;
- HTTP-leping toetab kordust: `?tag=Q193664&tag=Q159318`;
- URL-olek frontendis on `string[]` (`searchParams.getAll('tag')`).

**Semantika: JA** — isikul peavad olema kõik loetletud märksõnad. Ühe väärtuse korral
on JA ja VÕI identsed, seega tänane käitumine sellest ei sõltu; JA on facet-filtrite
tavapärane kitsendav käitumine.

**Teadlikult aktsepteeritud piirang:** kui URL-is on mitu `tag` väärtust, mõjuvad kõik
tulemusele, aga külgriba filter näitab valituna ainult esimest. Ülejäänud on seega
nähtamatu, kuid toimiv filter — "power user" režiim käsitsi koostatud või jagatud
URL-ide jaoks. Frontend **ei** kanoniseeri URL-i laadimisel ega kuva liigseid väärtusi.
(Uue märksõna valimine külgribalt asendab kõik senised — see on kasutaja tegevus,
mitte vaikne ümberkirjutus.) Mitmikvaliku UI ehitamisel see piirang kaob.

Väide, et hilisem mitmikvalik puudutab "ainult UI-kihti", kehtib backendi lepingu
kohta. Frontendis tuleb siis üle vaadata ka aktiivsete filtrite esitus ja URL-testid.

## Backend

### `server/prosopography/person_search.py`

**`_entry_tags(entry) -> list[dict]`** — normaliseerib indeksikirje `tags` kujule
`{id, label, labels}`. Talub nii dict- kui string-elemente (nagu `_entry_occupations`),
aga **ei** loe varuvariandina täiskaardilt: indeks on täielik. Tühjad/vigased elemendid
jäetakse vahele.

**Sisendi normaliseerimine — `_normalize_tag_query(value) -> list[str]`**

Ühine kõigile teedele (GET, POST, kaart). Teeb järjekorras:

1. string → üheelemendiline loend; loend → loend; `None` → `[]`;
2. `strip()` iga väärtuse ümbert;
3. tühjade väärtuste eemaldus (`?tag=` ei tekita filtrit);
4. duplikaatide eemaldus **järjekorda säilitades**;
5. **tühi tulemus tähendab „filtrit pole"**, mitte „ükski kirje ei vasta".

Võrdlus on tõstutundetu `casefold()` kaudu — see kehtib **nii labelitele kui
Q-koodidele**, seega töötab ka käsitsi kirjutatud `q193664`.

**`q`-otsing** (`_filter_index_entries`) laieneb märksõnadele. Vaste, kui otsingusõna
(tõstutundetult):
- sisaldub märksõna `label`-is, **või**
- sisaldub mõne keele `labels`-väärtuses (et/en/de/la — kõik, mis kirjes on), **või**
- võrdub `casefold()`-itult märksõna `id`-ga (nii leiab nii `Q193664` kui `q193664`).

Olemasolev nime/aliase-vaste jääb muutmata; märksõna-vaste lisandub VÕI-harusse.

**`tags`-filter** — uus parameeter `tags: Optional[list[str]]` funktsioonides
`_filter_index_entries`, `list_persons`, `get_person_map_markers`.

Kirje läbib filtri, kui **iga** loetletud väärtuse kohta leidub kirjel vastav märksõna.
Üksiku väärtuse vaste on andestav (käsitsi kirjutatud URL peab töötama): normaliseeritud
väärtus võrdub `casefold()`-itult kas märksõna `id`-ga, `label`-iga või mõne
`labels`-väärtusega.

**`get_person_facets`** tagastab uue välja:

```json
"tags": [{ "value": "Q193664", "label": "pietism", "labels": {"et": "…", "en": "…"}, "count": 1 }]
```

`value` = Q-kood kui olemas, muidu label; järjestus `(-count, label.lower())`.

**Loenduse dedup:** ühe isiku sama märksõna tõstab `count`-i **maksimaalselt ühe võrra**.
Grupeerimisvõti: normaliseeritud Q-kood kui olemas, muidu `casefold()`-itud label.
`_entry_tags` talub nii dict- kui string-kuju ja vanades andmetes võib sama märksõna
korduda, seega on dedup vajalik, mitte teoreetiline. Kui sama Q-koodiga kirjetel on
erinevad `labels`, võidab esimene kohatud täisobjekt.

**Facets-funktsiooni signatuur ei muutu** ja `tag` **ei** lisandu sinna. Täpsuse mõttes:
`get_person_facets` ei ole täielikult globaalne — see kutsub `list_persons(q, gender,
ids, collection)`, st arvutab filtreeritud hulga pealt, aga **ei** arvesta külgriba
filtreid (`origin_group`, `institution`, `status_id` jt). Märksõna-facet järgib sama
käitumist: `tag` valik ei kitsenda facet-loendeid.

### `server/prosopography/router.py`

`tag` lisandub kolme endpointi:

| Endpoint | Kuju |
|----------|------|
| `GET /prosopography` | `tag: Optional[List[str]] = Query(None)` |
| `POST /prosopography/query` | `data.get("tag")` — talub nii stringi kui loendit |
| `GET /prosopography/map` | `tag: Optional[List[str]] = Query(None)` |

Kõik kolm annavad väärtuse edasi `_normalize_tag_query` kaudu, seega on käitumine
teede vahel identne.

Facets-endpointi signatuur ei muutu.

## Frontend

### `src/prosopography/services/prosopographyService.ts`

- `listPersons`, query-variant ja kaardi-päring: `tag?: string | string[]`.
- URL-i kirjutamine `append`-iga igale väärtusele (mitte `set`) — see on selle failis
  ainus koht, kus korduv parameeter tekib, ja seetõttu kõige tõenäolisem regressioonikoht.
  Serialiseerimine eraldatakse puhtaks abifunktsiooniks (nt `appendTagParams(url, tag)`),
  et see oleks vitestiga kaetav ilma DOM-ita.
- Facets-tüüpi lisandub `tags: { value: string; label: string; labels?: Record<string, string>; count: number }[]`.
- **`tag` ei lähe facets-päringusse.**

### `src/prosopography/pages/PersonsPage.tsx`

- `const tags = searchParams.getAll('tag')` — olek on **loend**.
- `setTag(v: string)` kirjutab ühe väärtuse: kustutab kõik senised `tag` võtmed ja
  lisab uue, säilitades muud filtrid ja nullides `offset`-i.
- `tags` edasi listingu- ja kaardipäringusse. **Mitte** facets-päringusse.
- Lisandub "puhasta kõik" võtmete hulka (rida ~371) ja filtrimuutusel offseti nullimisse.

### `src/prosopography/components/PersonAdvancedFilters.tsx`

Uus `FilterSection` "Märksõnad" (ikoon `Tag` lucide'ist), items facetidest, label
lokaliseeritud aktiivsesse keelde (`labels[lang] ?? labels.en ?? label`).

`FilterSection` ise **jääb muutmata** — see on jagatud teiste filtritega ja on
üksikvalik. Märksõna-sektsioonile antakse `tags[0] ?? ''`. Mitmikvaliku hetkel muutub
ainult see üks sektsioon; `FilterSection`-i üldistamine on siis lokaalne otsus, mitte
praegu ette tehtud abstraktsioon.

`activeCount` arvestab **`tags.length`**, mitte tõeväärtust — nii on loendur kohe õige
ka mitme väärtusega URL-i puhul. `hasActive` arvestab `tags.length > 0`.

### `src/prosopography/components/PersonCard.tsx`

Olemasolevad märksõna-sildid (read 115–127) muutuvad klikitavaks → `/persons?tag=<value>`.

**Kaardi juur ei ole `<Link>`** — see on `div role="link"` + `onClick` + `onKeyDown`
(`PersonCard.tsx:284-293`). Pesastatud ankru probleemi seega ei teki ja DOM-i ümber
ehitama ei pea.

Koodis on täpselt see muster juba olemas: päritolukoht (`PersonCard.tsx:154-165`) on
`<button type="button" onClick={e => { e.stopPropagation(); onOriginClick(); }}>` sama
diviga sees. Märksõnad järgivad identset mustrit — `onTagClick` prop `CardInner`-ile,
`useNavigate` `PersonCard`-is, `stopPropagation` et kaardiklikk isikuvaatesse ei käivituks.

Valikurežiimis (`selectMode`) renderdatakse märksõnad **mitteklikitavate siltidena**
(`onTagClick` jäetakse andmata) — valiku-käitumine jääb peale, nagu ka `onOriginClick`
puhul praegu (`PersonCard.tsx:266` ei anna seda edasi).

Teadaolev piirang, mida see muudatus **ei** lahenda: interaktiivne element
`role="link"` sees ei ole a11y mõttes ideaalne. See on koodibaasi väljakujunenud muster
ja selle parandamine on eraldi töö, mitte selle featuuri osa.

### `src/prosopography/pages/PersonDetailPage.tsx`

Sama sildil (read ~589+). Kustutusnupp (`X`) jääb muutmata; klikitavaks muutub
ainult sildi tekstiosa.

### i18n

Uued võtmed `prosopography` nimeruumis, **mõlemasse keelde korraga** — `fallbackLng`
on väljas (ADR 0011), puuduv võti katkestab buildi (`localeParity.test.ts`).
Ei kasutata `t()` vaikeväärtust varuvariandina (ADR 0011 lõks).

## Testid

**Pytest — filtriloogika** (`tests/test_prosopography_ops.py` mustri järgi):
- `tags`-filter Q-koodi järgi, sh tõstutundetult (`q193664`);
- `tags`-filter labeli järgi (tõstutundetu, ka mitte-eesti keeles);
- **kahe märksõnaga päring → JA-loogika** — lukustab lepingu enne, kui UI selleni jõuab;
- normaliseerimine: tühikud ümber, tühi `?tag=`, duplikaadid — tühi tulemus = filtrit pole;
- legacy string-kujul märksõna indeksikirjes;
- `q` leiab isiku märksõna labeli järgi (et ja en), samuti Q-koodi järgi;
- `get_person_facets` tagastab `tags` õigete loenditega;
- sama märksõna duplikaat ühel isikul **ei** suurenda facet-`count`-i;
- märksõnadeta isik ei lekki tulemustesse.

**Pytest — HTTP-tasand** (`TestClient`, olemas `tests/conftest.py`-s):
- `GET` korduvate parameetritega `?tag=A&tag=B`;
- `POST /query`, kus `tag` on kord string ja kord loend — sama tulemus;
- `GET /map` rakendab sama filtrit.

**Frontend:** `npm run typecheck`, olemasolev `localeParity.test.ts` ja üks vitest
`appendTagParams` peal (string vs loend vs `undefined` → õige arv `tag` võtmeid).

**Komponenditeste ei kirjutata.** Projektis ei ole `@testing-library`-t ega jsdom'i ja
ühtki `.test.tsx` faili ei eksisteeri — testitakse ainult puhtaid funktsioone. Terve
komponenditesti-stäki lisamine on selle featuuri skoobist väljas; kaardi klikikäitumine
kontrollitakse käsitsi.

## Mida teadlikult EI tehta

- **Mitmikvaliku UI** — leping on valmis, kasutajaliides mitte (YAGNI).
- **Märksõnade sünkimine Meilisearchi** — isikuotsing käib indeksifailist, mitte Meilist.
- **Migratsioon ega indeksi ümberehitus** — `tags` on indeksis juba olemas.
- **`FilterSection`-i üldistamine mitmikvalikuks** — tehakse siis, kui vaja.
- **Aktiivsete filtrite sildiriba** — mitmikvaliku UI osa, mitte selle featuuri oma.
- **Facetide ristfiltreerimine** — märksõna valik ei kitsenda facet-loendeid, täpselt
  nagu ükski teine külgriba filter praegu.
- **Facetide sortimine kuvatava tõlke järgi** — backend sordib põhilabeli järgi;
  nelja märksõna juures pole vahet.
- **Komponenditestide stäkk** (`@testing-library`, jsdom).

## Teadaolev tagajärg

Kuna `q` otsib nüüd ka märksõnu, annab otsing "kantsler" lisaks nimevastetele ka
isikud, kellel on see märksõna. See on teadlik valik — märksõna peab olema leitav
ka ilma külgriba filtrit avamata.
