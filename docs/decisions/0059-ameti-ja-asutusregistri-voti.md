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
