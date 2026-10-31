# Eksemplari kiht ja paber.ut.ee (#696) — kavandi täpsustused

**Kuupäev:** 2026-10-31  
**Alus:** [issue #696](https://github.com/meelisf/VUTT/issues/696), [arutelufail](../superpowers/specs/2026-10-19-eksemplari-kiht-ja-paber-arutelu.md) ja [järelkontroll](2026-10-31-eksemplari-kiht-jarelkontroll.md).

## Hinnang ja ulatus

Põhisuund on mõistlik. Varasemad ülevaatused katavad tehnilised riskid hästi, kuid enne ADR-i vajab kavand veel mõne mõiste täpsustamist. Allpool on kavandi lahtised kohad ja soovitused, mitte olemasoleva eksemplarikihi vead.

Loeti issue põhiteksti ja kommentaare, arutelufaili ning järelkontrolli. Valitud koodikohtades kontrolliti `archive_refs` kirjutamisteed ja otsingu esimese lehe filtreid. Kogu lähteandmestikku ega tootmisandmeid ei auditeeritud; teste ei käivitatud. Rakenduskoodi ja GitHubi sisu ei muudetud.

## 1. Tekstitunnistaja reegel on dokumendis vastuoluline

Arutelufaili andmemudeli alguses on „Teosel on 0…n eksemplari, üks neist tekstitunnistaja”, hiljem aga „kinnitatud vaikimisi tekstitunnistajaid on teose kohta kuni üks”.

**Soovitus:** kasutada läbivalt viimast reeglit. See lubab ka lehtedeta teoseid ja teadmata päritoluga skaneeringuid. Kinnitamata päritolu ei tohi migratsiooniga muutuda vaikimisi kinnitatud seoseks.

## 2. Vaatluse ühiku sõnastus on vastuolus asukohavälja ettepanekuga

Andmemudeli tabel kirjeldab vaatlust kui üht vesimärki „eksemplari kindlas kohas”, kuid „Otsustatud” osa `locus`-ettepanek (näited `a2, a3`, `c4, d2`) ja paber.ut.ee näidisvaatlused (7/1, 7/5, 7/6) on koondvaatlused: üks vesimärgitüüp mitme asukohaga.

**Soovitus:** viia tabeli sõnastus kooskõlla koondvaatlusega. Impordis säilitada algne asukohatekst ja mitte jagada seda automaatselt eraldi vaatlusteks.

## 3. Eksemplari paberiandmete pärimine vajab täpsustust

Ettepanek „vaatlusel ainult erinevuse korral” jätab lahtiseks, kas puuduv väärtus tähendab teadmata väärtust või eksemplari vaikeväärtuse kasutamist.

**Soovitus:** määrata vaatluste mudelis (etapp 3, mitte eksemplari-ADR) puuduvate ja päritud väärtuste tähendus ning üldandmete muutmise mõju. Eksemplari üldandmete hilisem muutmine ei tohiks märkamatult muuta varasemate vaatluste tähendust.

## 4. „Andmed ei ole ohus” on liiga tugev järeldus

HTML-ist kättesaadavus näitab ülevõtmise võimalikkust, kuid ei tõesta andmestiku täielikkust ega pikaajalist säilimist.

**Soovitus:** sõnastada väide ülevõtmise võimalusena. Lisada etapi 1 vastuvõtukriteeriumidesse kirjete ja piltide inventuur, kontrollsummad ning puuduvate failide ja katkiste seoste raport. Säilimise hinnang peaks põhinema kontrollitud arhiivikoopial.

## 5. Samade URL-ide säilitamine eeldab majutuse ja domeeni korraldust

Staatilise koopia valmistamine üksi ei taga vanade linkide töötamist. See sõltub ka sellest, kus koopiat teenindatakse ning kes saab olemasoleva domeeni ja URL-ide suunamist korraldada.

Arutelus on majutus juba lahtine küsimus („Arhiveerimine VUTT-i serveris või ÜR-i veebimajutuses?”) ja 5Dvisioniga suhtlemine otsustatud; lisaks tuleb selgitada, kes haldab domeeni ja suunamisi.

**Soovitus:** eristada koopia tehniline valmistamine selle avalikku kasutuselevõttu puudutavatest kokkulepetest. „Paar päeva” sobib esialgseks tehniliseks hinnanguks, mitte kogu arhiveerimise kinnitatud tähtajaks.

## Varasema järelkontrolli kinnitused

Järelkontrolli §1 ja §5 eeltingimused kehtivad endiselt: `server/metadata_ops.py` lubab `archive_refs`-i üldise metaandmete salvestuse kaudu (`clean_archive_refs()`) ja `src/services/searchService.ts` filtreerib teoseotsingus ning loendurites `lehekylje_number = 1`.

## Soovitatav järgmine samm

Koostada eraldi arhiveerimise tööülesanne koos kontrollitavate valmimistingimustega. Sellele järgnevad kuivkäivitusega sobitusraport ja eksemplarikihi ADR. Enne vaatluste mudeli kinnitamist lahendada paberiandmete pärimise tähendus.

## Arutelufaili muudatused

Selle ülevaatuse põhjal parandati arutelufailis (2026-10-31): §1 — reegli pealkiri ja andmemudeli lause „kuni üks kinnitatud tekstitunnistaja”; §2 — vaatluse rida tabelis („üks vesimärgitüüp ühes eksemplaris, üks või mitu asukohta”); §4 — „Andmed ei ole ohus” → „Ülevõtmine on võimalik”, täielikkus kontrollimata.
