# 0056 — Isikuseose liik tuleneb rollipaarist ühes kohas; teose faktid ei kopeeri kogusid

**Staatus:** kehtib

## Kontekst

Isiku seosed arvutati kahes kohas eri reeglitega (`work_relations_ops` ainult `creators`,
`relations.get_person_relation_network_ids` + `_persons_in_collection`). Märksõna-isikud,
mainimised ja trükkalid jäid välja; kaardi ja isikulehe isikute hulk võis lahkneda.
`works_creators_index` uuenes ainult `call_ptw=True` teel ning kirjutati üle ilma uute
väljadeta (#461).

## Otsus

- Seose liik (`academic`, `dedicated`, `cotext`, `mention`, `printer`, `family`) tuleneb
  rollipaarist AINULT `server/prosopography/network_rules.py` `classify_pair`-is.
  Funktsioon on sümmeetriline: fookuse vahetus ei muuda liiki ega suunda.
- Võrgustiku ehitaja on üks (`network.build_person_network`); isikuleht ja `/persons`
  seoste kaart kasutavad sama.
- Teose faktid (`works_creators_index.json`) kirjutab AINULT `update_work_facts`, mida
  kutsutakse tingimusteta `update_work_collections` kõrval. Kogud ja avalikkus
  loetakse `work_collections_index.json`-ist; teoste indeksisse neid ei kopeerita.
- Trükikoht on `place.kind = "print"`, mitte kohtumiskoht.

## Tagajärjed

- Uus roll: lisa ta `network_rules.CREATOR`/`KNOWN`-i ja reeglitabelisse; muidu
  käsitletakse teda kaastekstina ja logitakse üks kord.
- Uus teose fakt, mida võrgustik vajab: lisa `_work_facts_entry`-sse (üks ehitaja
  rebuildile ja uuendusele, ADR 0007).
- #464 (teose osad) ja #465 (toimumiskoht) lisavad `evidence.part_id` ja
  `place.kind ∈ {event, sent_from}`, ilma vaateid muutmata.
