# Eksemplari pildi märge ja piltide haldus — disain

**Seis:** disain, kasutaja kinnitas 2026-11-27 (teise agendi ülevaatus sisse viidud).
**Seotud:** ADR 0079 (eksemplari pildid), ADR 0076 (eksemplari kiht), spets
`2026-11-10-eksemplari-leht-design.md`, ADR 0053 (lehe kommentaarid lehe luku all).

## Miks

Kahe eksemplari kõrvutamisel tulevad välja erinevused, mis käivad konkreetse lehe/pildi
kohta: ühel eksemplaril on vahemik olemas, teisel puudu; ühel on lõpus gratulatsioonid,
teisel mitte. Eksemplari kirje `condition`/`notes` kannab seda tervikuna, aga lehtede
vaates ja kõrvutuses seda ei näe. Kasutaja tahab:

- **pildi juurde märget**, mille olemasolu on näha juba enne avamist — märge ise on vihje,
  et seal võib olla midagi sisulist;
- et märget näeks ka see, kes **eksemplaride lehele ei lähe** (töölaual töötaja).

Kõrvaltähelepanek, mis viis teise osani: „Muuda pilte" nimekiri on kasutu (masina vaade):
pilti ennast muuta ei saa, ainult tema andmeid; „Tunnistaja leht (tüvi)" lahter on
arusaamatu; litsents käib tervele impordile, mitte üksikule pildile. Lisaks avanes redaktor
ruudustiku alla ekraanilt välja (kontrollitud tootmises 2026-11-27: 20 pildi korral algas
redaktor 1534 px juures, nähtav ala 1009 px) ja nupud paistsid tegevusetud.

## Eesmärgid

1. Eksemplari pildil on **üks kirjeldav märge** (lihttekst). Avalik: näeb ka väljalogitud
   lugeja. Toimetab see, kellel on eksemplaride kirjutusõigus (praegu admin +
   `can_write_work`, sama mis eksemplari kirjel ja piltidel — õigust EI laiendata).
2. Märkusega pildil on **kollane täpp** pisipildil (eksemplari lehe ruudustik, pildivaate
   ja kõrvutuse pisipiltide riba).
3. Pildivaates ja kõrvutuses on iga poole tööriistaribal lehe numbri kõrval väike nupp
   **„Lisa märge"**; märke olemasolul **kollane „Märge"**. Klõps avab nupu all hüpikakna
   märke tekstiga; toimetajal „Muuda". Märke puudumisel avab klõps toimetajale kohe tühja
   kasti. (Kasutaja mockup 2026-11-27.)
4. **Töölaua „Lehekülje märkmed"** näitab lehe kommentaaride kõrval ka selle lehega
   **paaris** olevate eksemplari piltide märkeid (ainult lugemiseks, link kõrvutusse).
5. Kõrvutuses **teose lehtede poolel** näitab nupp lehe kommentaare (olemasolev süsteem)
   lugemiseks; lisamine käib töölaual (link). Kommentaaridega lehel on nupp kollane.
6. Päises on **„Kõrvuta" kõige olulisem** nupp; „Kopeeri link" muutub väikeseks
   ikoonnupuks (nagu töölaua püsilingi kopeerimine).
7. **„Muuda pilte" nimekiri kaob.** Järjestamine ja kustutamine käivad samamoodi nagu
   teose halduses lehtedel (valik → tegevusriba → mustandjärjekord → salvesta/tühista).
   „Lisa pilte" (failide üleslaadimine) saab oma väikese dialoogi.

## Mitte-eesmärgid

- Märge ei ole kommentaariahel (autor, vastused) — selleks on lehe kommentaarid.
- Ei tule otsinguindeksisse (Meili) — eksemplari pilte seal pole ja see on eraldi otsus.
- Paarita pildi märge (nt gratulatsioonid, mida alus ei sisalda) EI jõua töölauale — lehte,
  kuhu see kuuluks, pole. Ta on näha eksemplari vaates (täpp + nupp).
- Litsentsi ja allika käsitsi muutmine üksiku pildi kaupa kaob kasutajaliidesest. Andmed
  jäävad; erijuhte ei kata.
- Paari (`page`) käsitsi sisestus kaob kasutajaliidesest — paar tekib ainult kõrvutuses
  („Salvesta paar"), nagu praegu.

## Anti-eesmärgid (läbikukkumine ka siis, kui tehniliselt töötab)

- Uus järjestamisvõte (lohistamine, nooled). Halduses on itereeritud mitu korda ja kõik
  muud võtted osutusid kasutajatele segaseks — kasutatakse SAMA mudelit.
- Märge, mida lugeja ei näe või mille olemasolu ei paista enne avamist.
- Märke kast, mis võtab pildi laiuse püsivalt ära (paneel) — märge on peidus, kuni seda küsitakse.

## Kaalutud lähenemised

**Kus märge elab (valitud 1):**

1. *Kaks hoidlat, töölaual mõlemad nähtavad* — pildi märge pildi kirjes, lehe kommentaarid
   lehe JSON-is; töölaua märkmepaneel näitab paaris piltide märkeid kõrval. Annab soovitud
   nähtavuse, kumbki olemasolev mudel jääb puutumata. **Valitud.**
2. *Üks süsteem* — lehe kommentaarid saavad sihi (leht või eksemplari pilt). Ühtne, aga
   piltide märkmed vajaksid indeksit ja kommentaaride taastet piltidel ning kirjeldavast
   märkest saaks ahel, mida kasutaja ei tahtnud.
3. *Ainult pildil* — töölaual töötaja ei märkaks. Tagasi lükatud.

Täiesti ühtne „kõik lehe märkmetes" ei ole võimalik: pilt seostub teose lehega ainult
salvestatud paari kaudu ja paarita pildile (sageli just see, mis erineb) lehte pole.

**Märke kuvamine pildivaates:** parempoolne paneel vs märge pildi all vs nupp + hüpikaken.
Valitud kasutaja mockupi järgi **nupp + hüpikaken** (pilt jääb täislaiusesse).

**Järjestamine:** halduse mudel (valitud kasutaja nõudel), mitte lohistamine ega nooled.

## Disain

### 1. osa — pildi märge

**Andmed.** Eksemplari pildikirjele uus väli `note` (lihttekst, kärbitud, tühi = võtit
pole). `server/exemplar_images.py`: `_IMAGE_KEYS` += `note`, `_MAX["note"]` (ettepanek
2000). Kirjutus käib olemasoleva `PATCH /works/{id}/exemplars/{eid}/images` kaudu
(revision-lukk, üks commit). `note` ei ole `source`-i osa, nii et impordi muutumatu allikas
teda ei puuduta.

**Liitmisleping (ülevaatus 2026-11-27, p 1).** PATCH saadab kogu pildiloendi; vana klient
(laetud enne `note`-i) ei tea välja olemasolust. Seepärast `_merge_image`-is:
**puuduv `note` võti säilitab salvestatud väärtuse, selgesõnaliselt saadetud tühi väärtus
kustutab.** (`label` jääb senise semantika juurde.) Klient: järjestuse mustand hoiab ainult
pildi-ID-sid; salvestamisel võetakse ülejäänud väljad VÄRSKEST manifestist, mitte mustandi
ajal laetud koopiast. Märke salvestus saadab värske manifesti + ühe muudetud `note`-i.

**Samaaegne märke muutmine (ülevaatus 2, p 2).** Värske manifest üksi ei kaitse: kui A avab
märke, B salvestab vahepeal oma paranduse ja A salvestab värskelt laetud revisjoniga, asendaks
A B paranduse vaikselt. Seepärast seob mustand **avamisel nähtud märke väärtuse** (`base`).
Salvestamisel laeb klient värske manifesti; kui selle pildi `note` ≠ `base`, ei kirjutata,
vaid näidatakse sama võrdlust mis 409 korral (sisestatud tekst + serveri värske märge).

**Pildivaade (`ExemplarImageModal`) ja kõrvutus (`ExemplarCompareModal`).**
- Tööriistaribal lehe sildi järel nupp „Lisa märge" / kollane „Märge" (ikoon `icons.ts`-ist,
  ADR 0086 — vajadusel uus mõiste + valvuri sõnastik).
- Hüpikaken nupu all: märke tekst; toimetajale „Muuda" → tekstikast + Salvesta/Tühista.
  Hüpikaknas toimetaja jaoks ka „Silt" (`label`) — ainus koht, kus silti edaspidi muuta.
- **Mustandi kaitse (ülevaatus p 4).** Mustand on seotud pildi ID-ga. Olemasolev
  `useUnsavedChangesGuard` laseb sama `pathname`-iga üleminekud läbi, aga kõrvutuse pilt ja
  jada vahetuvad `?cmp=`/`?image=` kaudu — seepärast küsib sama `UnsavedChangesDialog`
  kinnitust ka pildi vahetusel (nooled, pisipilt, jada valik), hüpikakna ja vaaturi
  sulgemisel ning lehelt lahkumisel. 409 (revision) korral jääb sisestatud tekst kasti
  alles ja kõrval näidatakse serveri värsket märget, et kasutaja saaks võrrelda.
- Lugejale (pole õigust, märget pole) nuppu ei näidata.
- „Kopeeri link" → väike ikoonnupp (`CopyLinkButton` ikooni kujule); „Kõrvuta" jääb
  päises esmaseks nupuks.

**Teose lehtede pool kõrvutuses (ülevaatus p 2).** Sama nupp, aga sisu = lehe kommentaarid
(olemasolev mudel): kommentaaride olemasolul kollane „Märkmed (N)", hüpikaken näitab
kommentaare **lugemiseks** ja lingi „Lisa märge töölaual". **Lingi sihtkoht (ülevaatus 2,
p 3):** paljas `/work/<id>/<lk>` avaks kasutaja eelistatud vahekaardi (`initialEditorTab`).
Uus lingiparameeter (nt `?notes=add`) avab „Info ja annotatsioonid" vahekaardi ja viib
kommentaarikasti juurde (sama tee mis juhise `addNote`, `AnnotationsTab.tsx:91`). Linki
näidatakse ainult kasutajale, kellel on teose muutmisõigus (`canEditWork(user, work)`,
sama mis töölaua `readOnly`) — sisselogimisest üksi ei piisa. Uut lehe kommentaari ei
salvestata kõrvutusest: töölaud lisab kommentaari
üldise `/save` kaudu (tekst, metaandmed, `base`, `content_generation`), eraldi
kommentaaripõhist lisamisteed ei ole ja uut lehe JSON-i kirjutajat ei tehta. Nii järgib
lisamisõigus automaatselt töölaua reeglit; eksemplari pildi märke muutmine nõuab admini.
Kommentaarideta lehel näidatakse ainult linki (muutmisõigusega kasutajale). Pisipiltide ribal kollane
täpp kommentaaridega lehel.

**Täpp.** Eksemplari lehe ruudustikus ja mõlema modaali pisipiltide ribal: märkusega pildil
(või kommentaaridega teose lehel) väike kollane täpp nurgas.

**Töölaua sild.** Töölaua „Lehekülje märkmed" paneel näitab lehe kommentaaride all
plokki „Eksemplaride märkmed": iga selle lehega paaris oleva märkusega eksemplari pildi kohta
rida `<hoidja> <kohaviit>: <märge>` + link kõrvutusse (`/work/<id>/exemplar/<eid>?cmp=…`).
Ainult lugemiseks. Andmed tulevad serverist (vt lahtised otsused), lugeja õigus
`can_read_work`.
- **Paari kehtivus (ülevaatus p 5).** Sillavastuses loetakse paar kehtivaks ainult siis, kui
  pildi `page` tüvi on teose praeguses leheloendis (`enumerate_page_images`) — sama reegel
  mis eksemplari lehel; nii ei teki linki kustutatud või poolitatud lehele ka pooleli
  koristuse ajal.
- **Juhis (ülevaatus p 5).** „Lehekülje märkmed" juhis (`AnnotationsTab`, `pageNotes` loendur)
  loeb ka paaris piltide märkmed; kui lehel on ainult eksemplari märge, juhis ilmub ja viib
  märkmete plokini.

### 2. osa — piltide haldus ilma nimekirjata

- Eemaldada „Muuda pilte" nupp ja `ExemplarImageEditor` nimekirjavaade.
- Eksemplari lehe piltide ruudustikus toimetajale **valikurežiim** (nupp „Vali" vms): klõps
  valib, Shift+klõps vahemik — nagu `WorkManage`-is. Väljaspool valikurežiimi avab klõps
  suure pildi nagu praegu (lugeja käitumine ei muutu).
- Valiku korral all **tegevusriba** halduse eeskujul: „Liiguta [nr] pildi järele" koos
  eelvaatega, „Kustuta valitud". Järjekord on mustand; riba ütleb, mitu pilti on mujal, ja
  pakub „Salvesta järjekord" / „Tühista muudatused". Loogika: `utils/blockReorder.ts`
  (`computeBlockMoveOrder`); salvestus olemasoleva `PATCH …/images` kaudu (järjekord),
  kustutus olemasoleva `DELETE …/images/{image_id}` kaudu.
- **Kustuta valitud (ülevaatus p 6):** olemasolev `DELETE …/images/{image_id}` kustutab ühe
  pildi ja tõstab revisjoni. Kustutused käivad järjest, iga järgmine eelmise vastuse
  revisjoniga. Tõrke korral peatub ja teade ütleb, mis kustutati ja mis jäi; vaade laeb
  manifesti uuesti. Salvestamata järjestuse ajal on kustutus blokeeritud (nagu
  `WorkManage`: „Enne kustutamist salvesta või tühista järjekorra muudatused").
- „Lisa pilte" → väike dialoog (failid + allikaliik/viide, nagu praegu redaktori ülaosas).
- Tegevusriba z-kiht nagu halduses (`z-[1100]`, päise all).

### Aluse vahetus (ülevaatus p 3, kasutaja otsus 2026-11-27)

Aluse vahetuse järelsamm eemaldab lähtepildid manifestist (`promote.py`,
`remove_source_ids`) ja koos nendega nende märkmed. Märget uuele lehele EI kanta —
lõpetamine peab jääma korratavaks (ADR 0089) ja seda ei tehta keerulisemaks. Selle asemel:
vahetuse eelvaade (`promote.preview`) loendab märkusega lähtepildid ja dialoog hoiatab
(„N pildil on märge; need jäävad ainult ajalukku"). Märge on gitis manifesti ajaloos alles.

**Lõppkontroll (ülevaatus 2, p 1).** Eelvaate ja asenduse vahel võib keegi lähtepildile märke
lisada; praegune `recheck_locked` võrdleb ainult päritolu (`origins_changed`) ja toimetatud
lehti (`edited_pages_changed`). Seepärast: kinnitus kannab nende **märkusega piltide ID-de
hulka, mille asendus tegelikult eemaldab** (`remove_source_ids` ∩ märkusega pildid;
`promote.confirmed_noted`), ja lõppkontroll arvutab selle uuesti. Hulga muutumisel 409
`noted_images_changed` → dialoog näitab uut hulka ja küsib uue kinnituse (sama tee mis
`edited_pages_changed`, `POST /admin/upload/{id}/promote/confirm`).

## Piirangud ja invariandid

- Õigused: kirjutus `can_write_work` + admin (olemasolev `_writable`), lugemine
  `can_read_work`. Uut õigusmudelit ei tule.
- i18n: iga uus võti et + en korraga (ADR 0011, kaks valvurit).
- Natiivseid dialooge ei kasutata; kinnitus `useConfirm`, teated `useNotify`.
- Ikoonid `icons.ts`-ist (ADR 0086).
- Lehe kommentaari ei lisata kõrvutusest — link viib töölauale (`/save`); uut lehe JSON-i
  kirjutajat ei tehta.
- Muutusteta salvestus on no-op (ADR 0012) — `write_manifest_locked` juba järgib seda.

## Ehitaja otsustada

- Töölaua silla andmeallikas: soovitus väike lugemisotspunkt (nt
  `GET /works/{id}/exemplar-image-notes` → `{tüvi: [{eid, holder, shelfmark, image_id, note}]}`)
  või väli olemasolevas `GET /works/{id}/exemplars` vastuses; töölaud laeb selle teose kohta
  korra. `server/cache.py`-sse ei panda (vastus sõltub lugemisõigusest).
- Märke maksimumpikkus (ettepanek 2000).
- Hüpikakna täpne komponent (olemasolev popover-muster, kui on).
- Kas `CopyLinkButton` muudetakse ikooniks kõigis kasutuskohtades või saab variandi.
- 1. ja 2. osa on eraldi PR-id; 1. osa enne. Kuni 2. osani jääb vana nimekiri alles, aga
  silt ja märge muudetakse juba hüpikaknas.

## Testid

- Server: `note` salvestub, kärbitakse, tühi eemaldab võtme; impordi allikas jääb muutumatuks;
  õiguseta 403; sillaotspunkt annab ainult paaris piltide märkmed ja austab lugemisõigust.
- Frontend: nupp kollane märke olemasolul; lugejale ilma märketa nuppu pole; toimetaja
  salvestab märke; täpp ruudustikus; töölaua paneel näitab paaris pildi märget;
  valikurežiim + liiguta + salvesta järjekord; kustuta valitud.
