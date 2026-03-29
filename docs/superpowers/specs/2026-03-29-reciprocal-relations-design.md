# Vastastikused seosed prosopograafias

**Kuupäev:** 2026-03-29
**Ulatus:** Isiku kaardil seose lisamisel/eemaldamisel uuendatakse automaatselt ka teise osapoole kaart.

---

## Kontekst

Praegu saab `PersonEditPage`-l lisada seoseid (`relations`) teistele isikutele. Seos on ühepoolne — kui A märgib seose B-le, siis B kaardil ei kajastu midagi. Eesmärk on muuta seosed vastastikuseks ning luua alus tulevikuks (seosegraafikute visualiseerimine).

---

## Andmemudel

Seose objekt (muutmata):
```json
{ "name": "Johann Müller", "type": "õpetaja", "target_id": "vutt:Pabc123" }
```

Vastastikune seos lisatakse tühi `type`-ga:
```json
{ "name": "Andreas Berg", "type": "", "target_id": "vutt:Pxyz789" }
```

Vastastikune seos lisatakse ainult siis, kui `target_id` on olemas (lingitud isik). Käsitsi nimega seosed (ilma `target_id`-ta) ei käivita vastastikkust.

---

## Backend

### Uus moodul: `server/prosopography/reciprocal_ops.py`

Kogu loogika on selles failis. Ei lisata `ops.py`-sse ega `router.py`-sse inline.

**Põhifunktsioon:**
```python
def sync_reciprocals(person_id: str, previous_relations: list, username: str) -> list[str]:
    """
    Võrdleb A eelmist ja praegust relations-nimekirja.
    Lisab/eemaldab vastastikuseid seoseid puudutatud B kaartidel.
    Tagastab uuendatud isikute ID-d.
    """
```

**Loogika:**
1. Loeb A praeguse seisu failist
2. Leiab `target_id`-ga seosed mis **lisati** (olid `previous_relations`-s puudu)
3. Leiab `target_id`-ga seosed mis **eemaldati** (olid `previous_relations`-s, praegu puudu)
4. Iga lisatud `target_id` B kohta:
   - Loeb B kaardi
   - Kui B-l on juba rida kus `target_id == A.id` → ei muuda
   - Kui B-l on käsitsi-nimi rida mis vastab A nimele (ilma `target_id`-ta) → asendab lingitud seosega (c-variant)
   - Muul juhul lisab `{ name: A.label, type: '', target_id: A.id }`
5. Iga eemaldatud `target_id` B kohta:
   - Eemaldab B kaardilt read kus `target_id == A.id`
6. Uuendab B kaarte otse (`atomic_write_json`), ilma `updated_at` konfliktikontrollita (automaatne sync)

### Uus endpoint: `POST /prosopography/{person_id}/sync-reciprocals`

```python
# router.py-s, kutsub reciprocal_ops.sync_reciprocals()
@router.post("/{person_id:path}/sync-reciprocals")
async def prosopography_sync_reciprocals(person_id, request, user=Depends(_require_role("editor"))):
    data = await _get_json(request)
    previous_relations = data.get("previous_relations", [])
    synced = sync_reciprocals(person_id, previous_relations, username=user["username"])
    return {"synced": synced}
```

---

## Frontend

### `PersonEditPage.tsx` muudatused

**1. `initialRelations` ref**

Kui draft laaditakse serverist, salvestatakse `relations` eraldi ref-i:
```ts
const initialRelationsRef = useRef<RelationDraft[]>([]);
// laadimise callback-is:
initialRelationsRef.current = [...loadedPerson.relations];
```

See ei muutu kui kasutaja drafti muudab — saadetakse sync-endpointile.

**2. UI märge relations listis**

`ProsopoPersonPicker` komponendi kõrval (või `PersonEditPage` relations renderItem-is) kuvatakse lingitud seosele (`target_id` olemas) väike `↔` märge. Tooltip: "Vastastikune seos uuendatakse ka [nimi] kaardil".

Kui kasutaja eemaldab seose millel oli `target_id` (võrreldes `initialRelationsRef`-iga), tooltip: "Vastastikune seos eemaldatakse ka [nimi] kaardilt".

**3. Salvestamise järjekord `handleSave`-s**

```ts
// 1. Salvesta A (praegune loogika)
await savePerson(id, draft);

// 2. Sync vastastikused seosed
await syncReciprocals(id, initialRelationsRef.current);

// 3. Uuenda ref pärast edukat salvestamist
initialRelationsRef.current = [...draft.relations];
```

Sync viga ei blokeeri A salvestamise edu — kuvatakse eraldi hoiatus.

### `prosopographyService.ts` lisand

```ts
export async function syncReciprocals(personId: string, previousRelations: RelationDraft[], token: string): Promise<{ synced: string[] }> {
  // POST /prosopography/{personId}/sync-reciprocals
  // body: { previous_relations: previousRelations }
}
```

---

## Tulevikuvaade

`reciprocal_ops.py` loob sisuliselt kahepoolsete seoste graafi. Tulevikus on selle põhjal võimalik:
- Seosegraafikute visualiseerimine (react-force-graph vms)
- Kauguse-põhine isikute otsimine ("näita kõiki kes on seotud X-ga 2 astme kaudu")
- Seose tugevuse/tüübi statistika

---

## Välistused

- Seose `type` ei sünkroniseerita (vastastikune seos jääb tühja tüübiga — kasutaja täidab käsitsi)
- Mitu samaaegset salvestamist ei ole käsitletud (edge case, `updated_at` kontroll puudub sync-is)
- Lingimata seosed (ainult nimi, pole `target_id`) ei käivita vastastikkust
