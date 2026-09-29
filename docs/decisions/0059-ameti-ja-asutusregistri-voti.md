# 0059 — Ameti ja asutuse identiteet on VUTT-i registrivõti

**Kuupäev:** 2026-09-27
**Staatus:** kehtib
**Seotud:** #462, #471; ADR 0014, 0040, 0058

## Kontekst

Isikukaartide `occupations[]` ja `education[]` sisaldavad allikast pärit nimetusi,
mis võivad olla lühendid või ajaloolised nimekujud. Q-kood puudub paljudel ametitel
ja asutustel. Ameti „asutus” võib hoopis olla tegevuspiirkond.

## Otsus

- Autoriteetsed `data/config/occupations.json` ja `institutions.json` on VUTT-i
  püsivõtmega objektid. Kirje kannab valikulist Q-koodi (`id`), silte ja
  nimevariante. Asutusel on liik ja valikuline `place_key` kohtade registrisse.
- Isikufakti `occupation_key` ja `institution_key` osutavad registri võtmele.
  Vana `occupation.id` ja `institution_id` on Q-koodi ühilduvusväljad: võtmega
  kirje salvestamisel võetakse need registrist või jäetakse Q-koodita kirjel ära.
  Allika `label` ja `institution` jäävad sõnasõnalise faktina alles.
- Ametil on kas `institution_key` või otsene `place_key`, mitte mõlemad.
  Haridusel võib olla `institution_key`, kuid mitte otsene `place_key`.
- Registrikirje kinnitatakse admini eraldi toiminguga, mis kirjutab
  `save_config_with_git` kaudu. Isikufakti kinnitamine ei loo registrikirjet.
- Migratsioon teeb esmalt ülevaatustabeli ega muuda kaarte. Nimevariant on
  kandidaat; mitmetähendusliku vaste valib inimene. Elukäigu kaardikoht tuleb
  kinnitatud `place_key`-st; ainult asutuse sildist kohta ei arvata.

## Tagajärjed

MCP kandidaatotsing võib tagastada mitu vastet. Ilma registrifailideta näitab ta
`registry_available=false` ega esita puudumist uue kirjena. Isikukaartide ja
registrifailide migratsioon vajab päris andmeid ning eraldi ülevaatust.

## Täiendus 2026-09-27: koht ajas

Asutus võib olla eri aegadel eri kohas (Academia Gustavo-Carolina: Tartu 1690–1699,
Pärnu 1699–1710). Registrikirjel on valikuline `place_periods: [{place_key, from?, to?}]`;
`place_key` jääb vaikekohaks. Elukäigu kaart valib koha faktide aasta järgi
(`institutionPlaceKey`: esimene sobiv periood, aastata fakt → vaikekoht). Isikufakt
ise kohta ei kanna — reegel „haridusel pole otsest `place_key`-d" kehtib edasi.

Q-kood on valikuline ka siis, kui Wikidata kirje kaob: AGC kirje Q138710754 kustutati
Wikidatast ja eemaldati registrist; identiteet on VUTT-i võti.


## Täiendus 2026-09-28: registrikirje ettepaneku realt

`new_registry_candidate` rida jäi lukku, kuni admin lõi registrilehel kirje ja
toimetaja valis selle uuesti. Nüüd saab admin isikuvormi ettepanekupaneelis
(`RegistryCandidatePicker` → `RegistryEntryForm`) kirje luua või muuta: sama
`PUT /registries/{kind}/{key}` (`save_config_with_git`), eeltäidetud allika
sõnastusega nimevariandiks, ja salvestatud võti läheb rea parandusse. Otsus
jääb samaks: registrikirje on admini eraldi toiming, isikufakti kinnitamine
seda ei loo. Nimi on normaliseeritud kuju („notar"), allika sõnastus jääb
kaardile ja variandiks.

## Täiendus 2026-09-29: agent pakub registrikirje, see tekib kinnitusel

Ettepaneku rida võib kanda uut kirjet (`occupation_entry`, `institution_entry`;
`key` kirje sees). Esitusel kontrollitakse `validate_entry`-ga ja lükatakse tagasi, kui
võti või Q-kood on registris juba olemas (agent kasutab olemasolevat). Kirje luuakse
ALLES toimetaja kinnitusel, uue toiminguga `registries.ensure`: lugemine, võrdlus ja
kirjutus ühe luku all; sama kirje (sama Q, Q-koodita sama et-nimi) seotakse, erinev on
`registry_conflict`. `put` jääb registrilehe ülekirjutuseks. Agendi juhis: vali lähim
olemasolev kirje, uus on erand.

## Täiendus 2026-09-29: seos nähtavaks, kirje loomine aknas, tegutsemisaeg

Isikuvormis nägi Q-koodiga, aga registrivõtmeta asutus („Rostocki Ülikool",
Q159895) välja sama moodi kui seotud kirje, kuigi elukäigu kaart leiab asutuse
koha ainult võtme kaudu. Nüüd kannab sidumata väli silti „Registriga sidumata"
(asutusel „— kaardile ei jõua"). Kindla vaste korral pakutakse „Seo: …":
Q-koodiga väli seotakse AINULT sama Q järgi (nimevaste Q-koodita kirjega kaotaks
fakti Q); Q-koodita väli täpse sildi või nimevariandi järgi; mitu kandidaati →
ei pakuta (`registrySuggestion`).

Uus kirje tekib ühes aknas (`RegistryEntryModal`) nii registrilehelt kui isikuvormi
sidumata väljalt, sama käiguga nagu koha lisamine: Wikidata otsing → kandidaadi
sildid, aliased, P31 liik, P571/P576 aastad, koht (P276/P131/P159 → kohtade
register ainult üheselt sama Q järgi) → kontroll → salvestus. Kontroll: sama
Q-kood registris → uut ei looda, pakutakse olemasolevat; sarnane nimi → inimene
kinnitab „see on teine kirje". **Võtme genereerib server** (`POST
/registries/{kind}`, `registries.create`): nimest slug, kokkupõrkel algusaasta,
siis järjekorranumber; valik, Q-kontroll ja kirjutus ühe luku all. Sama Q → 409
olemasoleva võtmega. Otsus jääb samaks: kirje on admini eraldi toiming.

Asutusel on valikuline tegutsemisaeg `active_from` / `active_to` (täisaastad).
See eristab samanimelisi asutusi (Tartu gümnaasium 1630–1632 ≠
kubermangugümnaasium 1804–1890) valikus, hoiatuses ja võtmes. See EI OLE koht
ajas (`place_periods`) ega mõjuta kaarti.

Registrilehel valitakse vaikekoht kohtade registrist (`PlacePicker`) ja „Koht
ajas" read kontrollitakse enne saatmist (`parsePlacePeriods`: kuju, ainult
aastad, tundmatu võti). Vaba võtmesisestust enam pole.
