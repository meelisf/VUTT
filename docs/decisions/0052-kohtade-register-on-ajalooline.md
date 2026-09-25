# ADR 0052 — Kohtade register on ajalooline; tänapäevane halduskuuluvus seotakse grupiga ankrute kaudu

**Kuupäev:** 2026-09-25
**Staatus:** vastu võetud (ankrute loend: esialgne, vaadatakse teostuses üle)
**Issue:** #427 · **Seotud:** ADR 0040, ADR 0048, #240

## Kontekst

#427 tahab sünnikoha Q-koodist automaatselt registrikoha ja päritolu. Plaan oli
käia Wikidata P131 („asub haldusüksuses") ahelat üles, kuni leidub registris
olev Q-kood, ja pärida sealt grupp.

Kuivkäivitus tootmises (2026-09-25, 48 kaarti sünnikohaga ja päritoluta):
30 Q-kood registris, 7 leiti ahelaga, 11 ei leitud. Ahelaga leiti AINULT Rootsi
kohti, enamik Rootsi (Q34) tasemel → grupp `rootsi`, mitte svealand/gootaland.
Eesti ja Saksa kohtadest ei leitud ühtki.

Põhjus: **register on ajalooline, P131 tänapäevane.** Registri tipud on
ajaloolised piirkonnad (Livland ilma Q-koodita, Estland = ajalooline kubermang
Q4532871, Sachsen ja Thüringen ilma Q-koodita, Rootsi ajaloolised maakonnad).
Tänapäevane ahel (Keila → Harju maakond → Eesti; Strängnäs → Södermanlandi
län → Rootsi) ei puutu neid kunagi. Lisaks on osa kohti registris olemas ILMA
Q-koodita (Viru-Nigula, Rathenow, Wettin, Berlin …) — automaatne lisamine
teeks neist duplikaadid.

Gruppidel ei olnud kirja pandud kriteeriumi, ja see oli näha: Delitzsch oli
`pohja-saksamaa`, temast 20 km lõunas Halle `kesk-saksamaa`; Dresden ja Zwönitz
põhjas, Magdeburg keskel.

## Otsus

### 1. Grupp on ajaloolise kuuluvuse väide

| Grupp | Kriteerium |
|---|---|
| `eesti` / `liivimaa` | Rootsi-aegne provints: Põhja-Eesti → Eestimaa; Lõuna-Eesti ja Põhja-Läti (Vidzeme) → Liivimaa. Tartu, Pärnu, Riia → Liivimaa. |
| `gootaland` / `svealand` / `norrland` | Rootsi ajalooline maakond (landskap). `rootsi` ainult siis, kui maakond pole teada. |
| `pohja-saksamaa` / `kesk-saksamaa` | **Benrathi joon** (alamsaksa vs ülemsaksa keeleala): joonest põhjas → Põhja-Saksamaa. Magdeburg põhjas; Halle, Leipzig, Dresden, Weimar lõunas. `kesk-saksamaa` = „Kesk- ja Lõuna-Saksamaa", st kõik joonest lõunas. |
| `kuramaa` | Kuramaa hertsogkond (Kurzeme, Zemgale): Jelgava (Mitau), Kuldīga (Goldingen), Bauska. |
| ülejäänud | Nimi ütleb (Soome, Karjala, Ingerimaa); `muu` = väljaspool neid. |

Kriteerium on kasutajale nähtav grupi valiku juures (`placeModal.groupHint`).
Olemasolevate kohtade gruppe kood ümber EI kirjuta — vastuolud on andmetöö (#240).

### 2. Ankrud: tänapäevane haldusüksus → grupp

`origin_groups.json` grupp saab välja `wikidata_anchors: [Q…]` — tänapäevased
haldusüksused, mis kuuluvad TERVIKUNA sellesse gruppi. Tänapäevased üksused
EI lähe `places.json`-i (ilmuksid kaardile ja päritolufiltrisse).

Ahelakäik (P131, parim auaste, piiratud sügavus): esimene leid võidab —
**registrikoht** annab `parent_key` (grupp päritakse `_walk_to_group`-iga),
**ankur** annab ainult `group` (ilma `parent_key`-ta). Mõlemad puuduvad →
koht ilma grupita → admini järjekord (ADR 0048 ülevaatusmärge).

Üksus, mida kriteeriumi joon läbib, jääb ankruta — parem järjekord kui vale grupp.
Ankruks sobib ka madalam tase (maakond/Landkreis), kui kõrgem on poolitatud.

Esialgne loend (Q-koodid lahendatakse ja kontrollitakse teostuses):

- **eesti:** Harju, Rapla, Lääne, Järva, Lääne-Viru, Ida-Viru maakond
- **liivimaa:** Tartu, Võru, Põlva, Valga, Viljandi, Jõgeva maakond; Vidzeme
- **kuramaa:** Kurzeme, Zemgale (2026-09-25 viidi Jelgava, Goldingen, Bauska,
  Iecava ja Tērvete registris `liivimaa` alt `kuramaa` alla)
- **ankruta:** Pärnu maakond (Hanila/Varbla/Koonga olid Eestimaa), Saare ja
  Hiiu maakond (Saaremaa oli Rootsi ajal eraldi provints)
- **svealand:** Stockholmi, Uppsala, Södermanlandi, Västmanlandi, Örebro,
  Värmlandi, Dalarna län
- **gootaland:** Östergötlandi, Jönköpingi, Kronobergi, Kalmari, Gotlandi,
  Blekinge, Skåne, Hallandi, Västra Götalandi län
- **norrland:** Gävleborgi, Västernorrlandi, Jämtlandi, Västerbotteni, Norrbotteni län
- **pohja-saksamaa:** Schleswig-Holstein, Hamburg, Bremen, Niedersachsen,
  Mecklenburg-Vorpommern, Brandenburg, Berlin; Saksi-Anhaltist ja
  Nordrhein-Westfalenist joonest põhja jäävad Landkreis'id
- **kesk-saksamaa:** Sachsen, Thüringen, Hessen, Bayern, Baden-Württemberg,
  Rheinland-Pfalz, Saarland; Saksi-Anhaltist ja NRW-st joonest lõunasse
  jäävad Landkreis'id

Lihtsustus teadlikult: Brandenburg tervikuna põhjas (Lausitz on joone lähedal);
län ≈ landskap (Stockholmi län katab Uppland + Södermanland, mõlemad Svealand).

### 3. Nimevaste on ettepanek, mitte seos

Kui Q-koodi järgi registrikohta ei leidu, aga registris on sama nime
(võti, `historical_names`, sildid) kirje ILMA Q-koodita, ei looda uut kohta.
Järjekorda läheb ettepanek lisada Q-kood olemasolevale kirjele. Automaatselt
ei seota: „Kadrina kirikumõis" ≠ „Kadrina", „Kambja kihelkond" ≠ „Kambja".

## Tagajärjed

- Ankrute muutmine muudab ainult TULEVASI automaatseid määranguid; salvestatud
  `group` / `origin` jäävad (päritolu ei kirjutata kunagi üle, #427 otsus 1).
- `origin_groups.json` on autoriteetne konfiguratsioon → kirjutus ainult
  `save_config_with_git`-iga (ADR 0040).
- Ankrute katvus on mõõdetav: kuivkäivitus `resolve()` peal enne ja pärast.

## Teostus (#427 PR B)

- `server/prosopography/place_resolve.py`: `resolve_place` (võrk, lukust väljas) →
  `plan_register_entry` (puhas) → `ensure_register_place` (kirjutus).
- **`places_write_lock`** (`places_ops`) — KÕIK `places.json` loe-muuda-kirjuta
  teed (`put_place`, `delete_place`, `merge_places`, `refresh_all_place_labels`,
  automaatne lisamine) käivad selle all ja loevad registri luku all uuesti.
  Võrgupäringut luku all ei tehta. Uus kirjutaja → sama lukk.
- Käivitub automaatrikastuse lõpus (`run_auto_enrichment`, samm 1c) ja
  tagantjärele (`run_place_fill`, `scripts/backfill_places_from_birth.py`).
  Käsitsi muudetud sünnikoht praegu automaatselt ei käivitu.
- Kaardi märked (`review.reasons`): `origin_from_birth`, `place_needs_group`,
  `place_name_match`; üksikasjad `review.place_proposals`
  (`{field, qid, kind, key?}`) — järjekorra UI tuleb #426 PR 4-ga.
  Kinnitatud ülevaatust ei avata; ülevaateta vanale kaardile tekib `pending`
  (`created_via: "place_backfill"`).
- UI: sama Q-koodiga sünnikoht ja päritolu → üks rida
  („Sünni- ja päritolukoht", `birthPlaceIsOrigin`).
