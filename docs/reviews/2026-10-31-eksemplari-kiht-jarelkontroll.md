# Eksemplari kiht ja paber.ut.ee (#696) — järelkontroll

**Kuupäev:** 2026-10-31  
**Kontrollitud kood:** `eead0218` (main).  
**Alus:** [issue #696](https://github.com/meelisf/VUTT/issues/696), selle [täpsustav kommentaar](https://github.com/meelisf/VUTT/issues/696#issuecomment-6542788241), [arutelufail](../superpowers/specs/2026-10-19-eksemplari-kiht-ja-paber-arutelu.md) ja [varasem koodiülevaatus](2026-10-31-eksemplari-kiht-koodi-ulevaade.md).

## Hinnang ja ulatus

Kavandatud teos → eksemplar → vaatlus ning eraldi vormiregister sobivad praeguse arhitektuuriga. Varasema ülevaatuse soovitused — vaatluse oma `locus`, vaatluste eraldi fail, piltide alamkaustad ja lehtede sidumine lehetüvedega — on põhjendatud. Enne etapi 2 ADR-i tuleb täpsustada migratsiooni, vanade kirjutamisteede sulgemist ja seoste käitumist lehetoimingutel.

Allpool on praegusest koodist tuletatud **kavandi riskid ja soovitused**, mitte väited juba teostatud eksemplarikihi vigade kohta. Tootmisandmeid ega paber.ut.ee täielikku andmestikku selles kontrollis ei auditeeritud.

## 1. Eksemplaride migratsioon peab sulgema vana kirjutamistee

**Kooditõend:**

- [`clean_archive_refs()`](../../server/metadata_ops.py#L40) ehitab iga kirje uuesti ainult väljadest `archive_id`, `reference` ja valikuline `url`.
- [`save_work_metadata()`](../../server/metadata_ops.py#L277) rakendab seda puhastust alati, kui uuendus sisaldab `archive_refs` välja.
- Kliendi [`cleanArchiveRefs()`](../../src/utils/buildMetadataPayload.ts#L88) teeb sama; [`buildMetadataPayload()`](../../src/utils/buildMetadataPayload.ts#L138) lisab arhiiviviited tavalisse metaandmete salvestusse.

**Tagajärg:** kui eksemplarikiht ehitada lihtsalt olemasolevate `archive_refs` kirjete lisaväljadeks, kaovad tavalisel metaandmete salvestamisel näiteks `id`, `is_text_witness`, lehetüved ja muud uued omadused. Eraldi eksemplariotspunkt üksi seda ei väldi, kui vana kirjutamistee jääb avatuks.

**Soovitus:** hoida autoriteetset `exemplars` välja `_metadata.json`-is ning muuta seda ainult oma otspunktidega, järgides [teose osade kirjutamise mustrit](../../server/routers/work_parts.py#L1). Üleminekul võib `archive_refs` jääda eksemplaridest tuletatud ühilduvuskujuks, kuid sellel ei tohi olla sõltumatut kirjutajat. Alternatiiv on laiendada olemasolevat välja, kuid ka siis tuleb uuendada kõik puhastajad ja sulgeda üldise vormi kaudu kogu massiivi ülekirjutamine.

Migratsioon peab hõlmama ka lugejaid: näiteks [hoidja kasutuse kontroll](../../server/routers/collections.py#L296) ja [Meili metaandmete ehitus](../../server/meili_doc.py#L716) loevad praegu ainult `archive_refs` välja. Kahe kuju ajutine olemasolu ei tohi tekitada kahte tõeallikat.

## 2. Üks arhiiviviide ei tõesta üht füüsilist eksemplari

**Kooditõend:** [ADA kaardistus](../../server/ada/mapping.py#L136) teeb igast `dc.identifier.other` väärtusest eraldi arhiiviviite. [Olemasolev test](../../tests/test_ada_mapping.py#L166) kinnitab mitme väärtuse muutmise mitmeks kirjeks. [`ArchiveRef`](../../src/types.ts#L62) ei sisalda füüsilise eksemplari identiteeti ega tekstitunnistaja märget.

**Järeldus:** kood tagab viidete säilimise, kuid ei tõesta nende üksühest vastavust füüsilistele eksemplaridele. See ei tõesta ka vastupidist; tegelik vastavus vajab andmete kontrolli. Arutelufaili reegel „iga praegune kirje on üks eksemplar” on seetõttu liiga tugev automaatse migratsiooni eeldus.

**Soovitus:**

- Anda eksemplarile püsiv ID, mida hoidja või kohaviida parandamine ei muuda; vaatlus viitab sellele ID-le.
- Säilitada migratsioonis algne viide ja päritolu ning märkida ebaselged vastavused ülevaatusele.
- Mitte valida esimest arhiiviviidet automaatselt tekstitunnistajaks. Lubada kontrollimata seosel jääda määramata.
- ADR-is määrata eraldi reegel kinnitatud tekstitunnistajale ja lehtedeta või veel migreerimata teosele. Soovitus on kuni üks kinnitatud vaikimisi tekstitunnistaja teose kohta ning erandlike lehtede selgesõnaline päritolu.

## 3. Pildi asendamine võib muuta eksemplari, kuigi lehetüvi säilib

**Kooditõend:** [`replace-image`](../../server/routers/pages.py#L141) valib olemasoleva failinime ja tüve, [varundab vana pildi ning kirjutab uue sama tee peale](../../server/routers/pages.py#L170). Lõpus [sünkroniseerib see Meili](../../server/routers/pages.py#L203), kuid ei anna edasi teadet eksemplari päritolu muutumisest.

**Tagajärg kavandile:** lehetüvi on stabiilne viide digitaalsele lehekohale, kuid ei taga füüsilise allika samasust. Näiteks Uppsala lehe asendamisel Tartu lehega võiksid vanad vaatlused ekslikult jääda uue pildiga seotuks. Just selline allika vahetamine on #696 üks lähtejuhtumeid.

**Soovitus:** pildi asendamisel eristada sama eksemplari uut skaneeringut ja teise eksemplari lehte. Nõuda päritolu kinnitamist või märkida seotud vaatlused ülevaatusele. Vaatluse eksemplariseos peab säilima ka siis, kui vastav pilt teose põhilehtede hulgast eemaldatakse või asendatakse. Vaikimisi tekstitunnistaja muutmine vajab samuti selget reeglit olemasolevate lehtede ja vaatluste jaoks.

## 4. Osade lehesünk vajab vaatluste puhul teistsuguseid reegleid

**Kooditõend:** [`remap_parts()`](../../server/work_parts.py#L371) asendab poolitatud lehetüve mõlema poolega, eemaldab puuduvad tüved ja märgib tühjaks jäänud osa `needs_review` olekusse. [`refresh_work_mentions()`](../../server/prosopography/relations.py#L156) kutsub osade sünki ning saab poolitamisel tüvede vastavuse.

**Tagajärg:** sama tehniline ühenduskoht sobib eksemplarikihile, kuid osade semantikat ei saa muutmata vaatlustele üle kanda. Tekstiosa võib jätkuda mõlemal poolel; vesimärk võib paikneda ainult ühel poolel.

**Soovitus:**

- Eksemplari päritolu võib poolitamisel päranduda mõlemale poolele, kui lähtepilt oli sama eksemplari laotus.
- Vaatluse leheviite võib remappida kandidaatidena mõlemale poolele, kuid täpne paiknemine tuleb märkida kontrollimist vajavaks.
- Lehe kustutamine peab säilitama vaatluse, eksemplariseose ja `locus`-e; eemaldada või kehtetuks märkida tuleb ainult digitaalne leheviide.
- Vaadata poolitamise ja kustutamise kõrval üle pildi asendamine ja vaikimisi tekstitunnistaja muutmine. Pelgalt lehenumbrite ümberarvutus ei kata neid juhtumeid.

## 5. Sünteetiline „leht 0” üksi ei lahenda lehtedeta teost

**Kooditõend:** [`build_work_documents()`](../../server/meili_doc.py#L744) tagastab piltideta teosele tühja dokumentide loendi. [Meili sünk](../../server/meilisearch_ops.py#L216) eemaldab sel juhul ka varasemad lehe- ja kirjadokumendid. Samal ajal [avalehe otsing](../../src/services/searchService.ts#L419) ja näiteks [teosepõhised tahuloendurid](../../src/services/searchService.ts#L116) eeldavad `lehekylje_number = 1` dokumenti.

**Täpsustus varasemale ülevaatusele:** sünteetiline dokument lehenumbriga 0 ei ilmuks olemasoleva avalehe päringusse. Selle loomine oleks ainult üks osa lahendusest.

**Soovitus:** kavandada lehtedeta teose tugi tervikliku tööna: kirje loomine, indekseerimine, leidmine, avamine metaandmete/eksemplaride vaates, kaanepildi puudumine ning loendurite ja statistika käitumine. ADR-is valida, kuidas teose kirje otsingus eristub lehedokumendist. Lehtedeta kirjete vajadus tuleb selgitada enne importi: kui mõni allikakirje ei sobitu olemasoleva teosega, vajab uurija sellele siiski kohta.

## 6. Teose õigused ei kata avaliku teose privaatset vaatlust

**Kooditõend:** [`can_read_work()`](../../server/access_ops.py#L32) lubab avaliku teose kõigile. [Pildiserveri kontroll](../../server/image_server.py#L65) lubab samuti avaliku või jagatava teose pildid ilma vaatlustaseme kontrollita. [Teose osade lugemisotspunkt](../../server/routers/work_parts.py#L60) kasutab teose lugemisõigust.

**Tagajärg:** olemasolev teose õiguste mudel sobib baaspiiranguks, aga ei peida avaliku teose juures avaldamiseelset vaatlust. Eraldi router või fail ei anna iseenesest täiendavat nähtavuskontrolli.

**Soovitus:** otsustada enne etappi 3, kas vaatlustel on üldse avaldamiseelne olek. Kui on, rakendada teose ligipääsule lisaks vaatluse nähtavust API-s, otsinguindeksis ja MCP-s. Fotode poliitika tuleb otsustada eraldi: „kõik fotod avalikuks” võib olla teadlik valik, kuid siis ei saa lubada, et peidetud vaatlus tähendab ka selle fotode peitmist. Kui fotod peidetakse koos vaatlusega, peab seda kontrollima ka pildiserver, mitte ainult kasutajaliides.

## Soovitatav järjekord ja impordi nõuded

1. **Arhiveerimine.** Säilitada algsed allika ID-d ja URL-id ning kirjelduse/piltide seosed.
2. **Kuivkäivitusega sobitusraport.** Näidata kindlad, mitmetähenduslikud ja vasteta sobitused. Sellest selgub ka lehtedeta teoste vajadus ja see, millised kataloogitunnused vajavad struktureeritud välja.
3. **Eksemplaride ADR.** Fikseerida püsivad ID-d, vana kirjutamistee sulgemine, tekstitunnistaja määramatus ja lehetoimingute reeglid.
4. **Etapp 2.** Rakendada eksemplarikiht koos migratsiooni ja olemasolevate lugejate kohandamisega.
5. **Etapp 3.** Lisada vaatlused, nende nähtavus, fotod ja import pärast eeltingimuste täitmist.

Impordi korduskäivitus ei tohi tekitada duplikaate. Soovitus on kasutada allika nimeruumiga ID-d ning eristada allikast imporditud väärtusi uurija hilisematest parandustest. See on impordi kavandi nõue, mitte kontrollitud olemasoleva impordi omadus.

Issue põhitekst tuleks viia kommentaari ja arutelufailiga kooskõlla: kontrollimise ajal sisaldas see endiselt varasemat ettepanekut võtta vaatluse asukoht transkriptsioonitägidest ilma oma väljata. Praegune [`work_scheme()`](../../server/page_address.py#L34) rakendab leheaadressi ainult käsikirjale; `locus` jääb iseseisvalt vajalikuks.

## Tehtud kontrollid ja piirangud

- Läbitud olemasolevad testid:

  ```sh
  .venv/bin/python -m pytest -q tests/test_ada_mapping.py tests/test_work_parts.py tests/test_page_address.py
  ```

  Tulemus: **96 passed**, üks Starlette/AnyIO aegumishoiatus. Need testid kontrollivad olemasolevat käitumist, mitte tulevase eksemplarikihi õigsust.

- Eraldi isoleeritud kontrollis käivitati lähtekoodist loetud `clean_archive_refs()` ning `remap_parts()` koos `_ordered()` abifunktsiooniga. Esimene eemaldas sisendkirjest `id` ja `is_text_witness`; teine muutis `spread` leheviite vastavuse `spread → [left, right]` puhul mõlemaks pooleks. Funktsioonid loeti AST abil ilma serverimoodulite importimise ja andmefailide kirjutamiseta.
- Tootmisandmete eksemplaride vastavust, #696 üksiknäidete praegust kettaseisu ega 522 allikakirje automaatse sobituse osakaalu ei kontrollitud. Neid ei saa koodi põhjal kinnitada.
- Rakenduskoodi selles ülevaatuses ei muudetud.
