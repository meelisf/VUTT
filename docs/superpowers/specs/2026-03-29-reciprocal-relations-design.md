# Vastastikused seosed prosopograafias

**Kuupäev:** 2026-03-29
**Ulatus:** Isiku kaardil seose lisamisel/eemaldamisel uuendatakse automaatselt ka teise osapoole kaart.

---

## Kontekst

Praegu saab `PersonEditPage`-l lisada seoseid (`relations`) teistele isikutele. Seos on ühepoolne — kui A märgib seose B-le, siis B kaardil ei kajastu midagi. Eesmärk on muuta seosed vastastikuseks ning luua alus tulevikuks (seosegraafikute visualiseerimine).

---

## Andmemudel (MVP — praegune implementatsioon)

> **Scope:** ainult väljad `name`, `type` (string), `target_id`, `reciprocal_auto`.
> `type_id` ja `type_labels` **ei kuulu sellesse implementatsiooni** — vt tulevikuvaade.

Käsitsi lisatud seos:
```json
{ "name": "Johann Müller", "type": "õpetaja", "target_id": "vutt:Pabc123" }
```

Automaatselt lisatud vastastikune seos:
```json
{ "name": "Andreas Berg", "type": "", "target_id": "vutt:Pxyz789", "reciprocal_auto": true }
```

`reciprocal_auto: true` tähendab:
- seos loodi automaatselt `sync-reciprocals` poolt, mitte kasutaja poolt käsitsi
- UI saab seda vajadusel eristada (nt hall tekst, ikoon)
- eemaldamisel (kui A kaardilt seos B-le eemaldatakse) eemaldatakse B kaardilt ainult read kus `reciprocal_auto: true && target_id == A.id` — käsitsi sisestatud seosed jäävad puutumata
- tulevased migratsioonid ja audit on selgemad

Kui kasutaja hiljem täidab automaatselt loodud seose `type` välja ja salvestab, jääb `reciprocal_auto: true` alles (päritolu ei muutu), aga seos on nüüd kasutaja poolt rikastatud.

Vastastikune seos lisatakse ainult siis, kui `target_id` on olemas (lingitud isik). Käsitsi nimega seosed (ilma `target_id`-ta) ei käivita vastastikkust.

---

## Backend

### Uus moodul: `server/prosopography/reciprocal_ops.py`

Kogu loogika on selles failis. Ei lisata `ops.py`-sse ega `router.py`-sse inline.

**Põhifunktsioon:**
```python
def sync_reciprocals(
    person_id: str,
    old_relations: list,
    new_relations: list,
    a_label: str,
    username: str,
) -> list[str]:
    """
    Võrdleb A vana ja uut relations-nimekirja (mõlemad server-side).
    Lisab/eemaldab vastastikuseid seoseid puudutatud B kaartidel.
    Tagastab uuendatud isikute ID-d.
    """
```

**Loogika:**
1. Leiab `target_id`-ga seosed mis **lisati** (`old_relations`-s puudu, `new_relations`-s olemas)
2. Leiab `target_id`-ga seosed mis **eemaldati** (`old_relations`-s olemas, `new_relations`-s puudu)
3. Iga lisatud `target_id` B kohta:
   - Loeb B kaardi
   - Kui B-l on juba rida kus `target_id == A.id` → ei muuda (idempotentne)
   - Muul juhul lisab `{ "name": a_label, "type": "", "target_id": A.id, "reciprocal_auto": true }`
4. Iga eemaldatud `target_id` B kohta:
   - Eemaldab B kaardilt read kus `target_id == A.id` **ja** `reciprocal_auto == true` — käsitsi seosed jäävad puutumata
5. Uuendab B kaarte otse (`atomic_write_json`), ilma `updated_at` konfliktikontrollita

### Router PUT endpoint muudatus

Eraldi endpointi **ei looda**. Sync toimub olemasoleva PUT `/prosopography/{person_id}` sees:

```python
@router.put("/{person_id:path}")
async def prosopography_update(person_id, request, user=Depends(_require_role("editor"))):
    data = await _get_json(request)
    # Loe vana seis ENNE salvestust — server-side diff
    old_person = get_person(person_id)
    old_relations = (old_person or {}).get("relations", [])
    # Salvesta uus seis
    person = update_person(person_id, data, username=user["username"])
    # Sync reciprocals server-side diffiga
    a_label = (person.get("name") or {}).get("label", "")
    sync_reciprocals(person_id, old_relations, person.get("relations", []), a_label, username=user["username"])
    enrich_entity_labels_from_person_async(person)
    return person
```

**Miks see on parem kui eraldi endpoint `previous_relations`-iga:**
- Server loeb vana seisu ise — ei sõltu kliendi mälupeeklist
- Diff on range ja concurrency-safe (vana fail loetakse vahetult enne salvestust)
- Frontend ei pea midagi lisaks tegema

---

## Frontend

### `PersonEditPage.tsx` muudatused

Frontend-i muudatused on **minimaalsed** — sync toimub automaatselt PUT endpointis.

**UI märge relations listis**

`PersonEditPage` relations `renderItem`-is kuvatakse lingitud seosele (`target_id` olemas) väike `↔` märge.

Kui seos on **äsja lisatud** (tühi `type`): tooltip "Automaatne vastasseos lisatakse [nimi] kaardile; täpsusta tüüp vajadusel käsitsi."

Kui seos on **juba salvestatud** ja kannab `reciprocal_auto: true` märget: tooltip "Automaatne vastasseos; täpsusta tüüp vajadusel käsitsi."

Ei ole vaja `initialRelationsRef`-i ega eraldi service kutseid.

---

## Tulevikuvaade

### Seosegraaف ja seose allikate võrdsus

Kõik seosed on graafi mõistes võrdse kaaluga — erinev on ainult päritolu. Kahte tüüpi seoseid:

| Allikas | Näited | Salvestamine |
|---|---|---|
| **Käsitsi** | juhendaja, isa, vend, kolleeg | `person.relations[]` |
| **Teosest tuletatud** | kaasautor, pühendaja, õnnitleja, eessõna autor | teoste `creators[]` metaandmed |

Teosest tuletatud seosed kuvatakse `PersonDetailPage`-l eraldi read-only sektsioonina — neid ei kirjutata isiku `relations`-i, et vältida andmete duplikatsiooni ja käsitsi vigade tekkimist. See ei tähenda et need on "teisejärgulised" — mõlemad allikad on **võrdse tähtsusega**.

Graafi mootori jaoks on mõlemad lihtsalt **servad** (edges):
```
(A) --[roll: "eessõna autor", allikas: "teos X"]--> (B)
(A) --[roll: "juhendaja", allikas: "käsitsi"]--> (C)
```

Serva andmemudel tuleviku graafi jaoks:
```json
{
  "source_id": "vutt:Pabc",
  "target_id": "vutt:Pxyz",
  "type": "juhendaja",
  "type_id": "Q...",
  "edge_source": "manual" | "work",
  "work_id": "nanoid (kui edge_source=work)",
  "work_role": "eessõna autor (kui edge_source=work)"
}
```

`reciprocal_ops.py` loob praegu käsitsi seoste kahepoolsuse. Tulevikus lisandub:
- Teostest tuletatud seoste kuvamine `PersonDetailPage`-l (read-only)
- Graafikute visualiseerimine (react-force-graph vms)
- Kauguse-põhine isikute otsimine ("näita kõiki kes on seotud X-ga 2 astme kaudu")

### Seose tüüp Wikidatast

Praegu on `type` vabatekstiline string (nt `"õpetaja"`). Tulevikus peaks `type` saama `LinkedEntity`-ks:

**See ei kuulu praegusesse implementatsiooni.**

Tuleviku andmemudel (eraldi spec + migratsioon):
```json
{
  "name": "Johann Müller",
  "type": "õpetaja",
  "type_id": "Q37226",
  "type_labels": { "et": "õpetaja", "en": "teacher", "de": "Lehrer", "la": "magister" },
  "target_id": "vutt:Pabc123"
}
```

Wikidata sisaldab suhteliike (teacher Q37226, student Q48282, colleague Q3075502 jne). Kasutajaliides saaks kasutada `EntityPicker`-it (olemasolev komponent), mis annaks automaatselt tõlked ja standardiseeritud koodid.

Struktuur on tagasiühilduv — `type_id` ja `type_labels` on valikulised lisaväljad, vabatekstiline `type` jääb alles. Migratsioon on kerge kuna praegu on seoseid märgitud minimaalselt.

---

## Konsistentsimudel — teadlik kompromiss

PUT endpoint täidab toimingud järjestikku:

1. `update_person()` kirjutab A faili kettale
2. `sync_reciprocals()` uuendab B kaarte

Kui samm 2 ebaõnnestub (nt failikirjutusviga), jääb A salvestatuks aga B-d uuendamata. Süsteem **ei taga tugevat transaktsioonilist konsistentsi**.

See on **teadlik kompromiss**:

- **A kaart on primaarne** — kasutaja muudatus salvestatakse alati, isegi kui sync ebaõnnestub
- **Vastastikune sync on järelprotsess** — best-effort, mitte garanteeritud
- Ebaõnnestumine on erandlik (kohalik failisüsteem, mitte võrk), seega praktikas harv
- Tulevikus saab lisada retry-loogika või async queue, kui vajadus tekib

---

## Välistused

- Seose `type` ei sünkroniseerita (vastastikune seos jääb tühja tüübiga — kasutaja täidab käsitsi)
- Mitu samaaegset salvestamist ei ole käsitletud (`updated_at` kontroll puudub sync-is B kaartidel)
- Lingimata seosed (ainult nimi, pole `target_id`) ei käivita vastastikkust
