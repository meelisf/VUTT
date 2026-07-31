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
**andmelepe massiiv juba algusest peale** — hilisem laiendus puudutab ainult UI-kihti:

- sisemine filter võtab `tags: Optional[list[str]]`, mitte skalaari;
- HTTP-leping toetab kordust: `?tag=Q193664&tag=Q159318`;
- URL-olek frontendis on `string[]` (`searchParams.getAll('tag')`).

**Semantika: JA** — isikul peavad olema kõik loetletud märksõnad. Ühe väärtuse korral
on JA ja VÕI identsed, seega tänane käitumine sellest ei sõltu; JA on facet-filtrite
tavapärane kitsendav käitumine.

## Backend

### `server/prosopography/person_search.py`

**`_entry_tags(entry) -> list[dict]`** — normaliseerib indeksikirje `tags` kujule
`{id, label, labels}`. Talub nii dict- kui string-elemente (nagu `_entry_occupations`),
aga **ei** loe varuvariandina täiskaardilt: indeks on täielik. Tühjad/vigased elemendid
jäetakse vahele.

**`q`-otsing** (`_filter_index_entries`) laieneb märksõnadele. Vaste, kui otsingusõna
(tõstutundetult):
- sisaldub märksõna `label`-is, **või**
- sisaldub mõne keele `labels`-väärtuses (et/en/de/la — kõik, mis kirjes on), **või**
- võrdub märksõna `id`-ga (nii leiab ka `Q193664`).

Olemasolev nime/aliase-vaste jääb muutmata; märksõna-vaste lisandub VÕI-harusse.

**`tags`-filter** — uus parameeter `tags: Optional[list[str]]` funktsioonides
`_filter_index_entries`, `list_persons`, `get_person_map_markers`.

Kirje läbib filtri, kui **iga** loetletud väärtuse kohta leidub kirjel vastav märksõna.
Üksiku väärtuse vaste on andestav (käsitsi kirjutatud URL peab töötama):
`value == t.id` **või** `value.lower()` võrdub `t.label`-i või mõne `labels`-väärtusega
(tõstutundetult).

**`get_person_facets`** tagastab uue välja:

```json
"tags": [{ "value": "Q193664", "label": "pietism", "labels": {"et": "…", "en": "…"}, "count": 1 }]
```

`value` = Q-kood kui olemas, muidu label. Arvutus filtreeritud hulga pealt, sama mustriga
nagu `institutions`; järjestus `(-count, label.lower())`. Facets-funktsiooni signatuur
ei muutu (facetid ei ole ristfiltreeritud — nagu praegugi).

### `server/prosopography/router.py`

`tag` lisandub kolme endpointi:

| Endpoint | Kuju |
|----------|------|
| `GET /prosopography` | `tag: Optional[List[str]] = Query(None)` |
| `POST /prosopography/query` | `data.get("tag")` — normaliseeritakse `_as_list` abifunktsiooniga (string → üheelemendiline loend, loend → loend, `None` → `None`) |
| `GET /prosopography/map` | `tag: Optional[List[str]] = Query(None)` |

Facets-endpointi signatuur ei muutu.

## Frontend

### `src/prosopography/services/prosopographyService.ts`

- `listPersons`, query-variant ja kaardi-päring: `tag?: string | string[]`.
- URL-i kirjutamine `append`-iga igale väärtusele (mitte `set`).
- Facets-tüüpi lisandub `tags: { value: string; label: string; labels?: Record<string, string>; count: number }[]`.

### `src/prosopography/pages/PersonsPage.tsx`

- `const tags = searchParams.getAll('tag')` — olek on **loend**.
- `setTag(v: string)` kirjutab praegu ühe väärtuse (asendab olemasoleva).
- `tags` edasi nii listingu-, kaardi- kui facets-päringusse.
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

Kaart on ise `Link`, seega **pesastatud `<a>` ei sobi** (kehtetu HTML). Kasutame
`<button>` + `e.preventDefault()` + `e.stopPropagation()` + `useNavigate`.
Valikurežiimis (`selectMode`) klikk **ei** navigeeri — valiku-käitumine jääb peale.

### `src/prosopography/pages/PersonDetailPage.tsx`

Sama sildil (read ~589+). Kustutusnupp (`X`) jääb muutmata; klikitavaks muutub
ainult sildi tekstiosa.

### i18n

Uued võtmed `prosopography` nimeruumis, **mõlemasse keelde korraga** — `fallbackLng`
on väljas (ADR 0011), puuduv võti katkestab buildi (`localeParity.test.ts`).
Ei kasutata `t()` vaikeväärtust varuvariandina (ADR 0011 lõks).

## Testid

**Pytest** (`server/prosopography` testid):
- `tags`-filter Q-koodi järgi;
- `tags`-filter labeli järgi (tõstutundetu, ka mitte-eesti keeles);
- **kahe märksõnaga päring → JA-loogika** — lukustab lepingu enne, kui UI selleni jõuab;
- `q` leiab isiku märksõna labeli järgi (et ja en), samuti Q-koodi järgi;
- `get_person_facets` tagastab `tags` õigete loenditega;
- märksõnadeta isik ei lekki tulemustesse.

**Frontend:** `npm run typecheck` + olemasolev `localeParity.test.ts`.

## Mida teadlikult EI tehta

- **Mitmikvaliku UI** — leping on valmis, kasutajaliides mitte (YAGNI).
- **Märksõnade sünkimine Meilisearchi** — isikuotsing käib indeksifailist, mitte Meilist.
- **Migratsioon ega indeksi ümberehitus** — `tags` on indeksis juba olemas.
- **`FilterSection`-i üldistamine mitmikvalikuks** — tehakse siis, kui vaja.

## Teadaolev tagajärg

Kuna `q` otsib nüüd ka märksõnu, annab otsing "kantsler" lisaks nimevastetele ka
isikud, kellel on see märksõna. See on teadlik valik — märksõna peab olema leitav
ka ilma külgriba filtrit avamata.
