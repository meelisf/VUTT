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
- Diff tehakse server-side vahetult enne salvestust, mistõttu see on usaldusväärsem ega sõltu kliendi lokaalsest seisust (ei ole täielikult concurrency-safe — vt konsistentsimudel)
- Frontend ei pea midagi lisaks tegema

---

## Frontend

### `PersonEditPage.tsx` muudatused

Frontend-i muudatused on **minimaalsed** — sync toimub automaatselt PUT endpointis.

**UI märge relations listis**

`PersonEditPage` relations `renderItem`-is kuvatakse lingitud seosele (`target_id` olemas) väike `↔` märge.

Kõigile lingitud seostele (`target_id` olemas): tooltip "Vastasseos uuendatakse automaatselt [nimi] kaardil salvestamisel."

Kui seos kannab `reciprocal_auto: true` märget (serverist laetud): tooltip "Automaatne vastasseos; täpsusta tüüp vajadusel käsitsi."

Ei ole vaja `initialRelationsRef`-i ega eraldi service kutseid.

---

## Tulevikuvaade

### Seosegraaf ja seose allikate võrdsus

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

**Vea käsitlus `sync_reciprocals` ebaõnnestumisel:**
- Viga logitakse serveris (`logger.error`)
- API vastus jääb **200** — A salvestamine õnnestus, sync on järelprotsess
- Klient ei saa veateadet (sync ebaõnnestumine ei blokeeri kasutajat)
- Viga on nähtav serveri logides (`docker logs vutt-backend`)

See on **teadlik kompromiss**:

- **A kaart on primaarne** — kasutaja muudatus salvestatakse alati, isegi kui sync ebaõnnestub
- **Vastastikune sync on järelprotsess** — best-effort, mitte garanteeritud
- Ebaõnnestumine on erandlik (kohalik failisüsteem, mitte võrk), seega praktikas harv
- Tulevikus saab lisada retry-loogika või async queue, kui vajadus tekib

---

## Implementatsiooni servajuhud

Järgmised stsenaariumid tuleb `reciprocal_ops.py` kirjutamisel läbi mõelda.

### 1. Mitu seost sama isikuga

A-l võib olla B-ga mitu seost erineva `type`-ga (nt "õpetaja" + "kolleeg"). Kui kasutaja eemaldab neist ühe, ei tohi B kaardilt vastasseos kaduda — A-l on B-le ikka ülejäänud viide.

**Reegel:** diff baseerub `target_id`-de **hulkadel** (`set`), mitte ridade 1:1 võrdlusel. B vastasseos eemaldatakse ainult siis, kui A-l ei jäänud B-le **mitte ühtegi** `target_id` viidet.

```python
old_ids = {r["target_id"] for r in old_relations if r.get("target_id")}
new_ids = {r["target_id"] for r in new_relations if r.get("target_id")}

added = new_ids - old_ids    # B-dele, kellele lisati seos
removed = old_ids - new_ids  # B-dele, kellelt eemaldati viimane seos
```

### 2. Rikastatud automaatse seose kustutamine

B logib sisse, näeb auto-seost (`reciprocal_auto: true`) ja täidab `type` välja ("õpilane"). Hiljem A kustutab oma seose B-ga. Spek ütleb: eemaldatakse read kus `reciprocal_auto: true` — see tähendab B kaotab käsitsi sisestatud `type` info.

**MVP raames aktsepteeritav kompromiss.** Tuleb märkida koodi kommentaarina. Tulevikus, kui `type` on Wikidata entiteet, võib kaaluda: "kui `reciprocal_auto: true` aga `type` pole tühi → muuda `reciprocal_auto: false` (konverteeri käsitsi seoseks) selle asemel et kustutada."

### 3. Lõputu tsükli vältimine

`sync_reciprocals` uuendab B kaarte otse `atomic_write_json`-iga, **mitte** `update_person()` kaudu. See on kriitiline — `update_person()` kutsub omakorda `sync_reciprocals`-i, mis tekitaks lõputu tsükli. Tuleb jälgida, et see eristus koodi jõuab.

### 4. Nime muutumise kaskaad (stale cache)

A muudab oma nime. B kaardil olev vastasseos kannab endiselt vana nime — `name` väli on denormaliseeritud koopia. Sync toimub ainult `relations` muutuste korral, mitte nime muutuse korral (selleks on eraldi `_propagate_name_to_works`-tüüpi loogika).

MVP raames ei ole probleem, sest tuleviku UI peaks toetuma `target_id`-le ja tõmbama aktuaalse nime reaalajas. Teadmine lihtsalt: `name` võib B kaardil vananeda.

---

## Välistused

- Seose `type` ei sünkroniseerita (vastastikune seos jääb tühja tüübiga — kasutaja täidab käsitsi)
- Mitu samaaegset salvestamist ei ole käsitletud (`updated_at` kontroll puudub sync-is B kaartidel)
- Lingimata seosed (ainult nimi, pole `target_id`) ei käivita vastastikkust
