"""Väliste ID-de indeksisse ei kirjutata aegunud kaardiversiooni (spekk §4.6, ADR 0048).

Varem kutsus iga kirjutustee `_update_index_entry`-t PÄRAST `person_lock`-i
vabastamist ja `ext_id_index.update_for_person` kustutas isiku kõik võtmed ning
lisas need talle antud koopiast. Järjestus:
  1. A (ID-sid mittemuutev salvestus) salvestab vana ID-loendiga, vabastab luku;
  2. B lisab ID ja uuendab indeksi;
  3. A hilinenud indeksiuuendus kirjutab vana loendi tagasi → B ID kaob indeksist;
  4. järgmine loomine peab ID-d vabaks → duplikaat.
"""
import threading

from server.prosopography import ext_id_index, indices, person_crud


def test_hilinenud_indeksiuuendus_ei_kustuta_vahepeal_lisatud_id(prosopo_env, monkeypatch):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}])
    monkeypatch.setattr("server.prosopography.enrichment.fetch_and_diff",
                        lambda *a, **k: {"auto_filled": {}, "conflicts": []})

    originaal = indices._update_index_entry
    kaivitatud = {"b": False}

    def konks(person):
        # A on salvestanud ja lukust väljas; B lisab ID enne A indeksiuuendust.
        if not kaivitatud["b"]:
            kaivitatud["b"] = True
            t = threading.Thread(target=person_crud.add_identifier,
                                 args=("vutt:Paaa", "gnd", "123", "b"))
            t.start()
            t.join()
        originaal(person)

    monkeypatch.setattr(indices, "_update_index_entry", konks)

    kaart = person_crud.get_person("vutt:Paaa")
    person_crud.update_person("vutt:Paaa", {"notes": "A", "updated_at": kaart["updated_at"]}, "a")

    assert kaivitatud["b"]
    assert ext_id_index.find_person_id("gnd", "123") == "vutt:Paaa"
