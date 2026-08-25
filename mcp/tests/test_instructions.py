"""Serveri juhend: jõuab kliendini ja mahub kliendi lõikepiiri sisse.

Claude Code lõikab `instructions`-i 2048 märgi pealt („Server instructions
truncated from N to 2048 chars"). Üle mineku märkaks alles see, kelle juhendi
LÕPP vaikselt kaob — seepärast valvur.
"""
from vutt_mcp.instructions import SERVER_INSTRUCTIONS
from vutt_mcp.server import build_server

# Claude Code'i lõikepiir; teised kliendid võivad olla helded, see on rangeim.
KLIENDI_LAGI = 2048


class FakeClient:
    def meili_search(self, body):
        return {"hits": [], "totalHits": 0}

    def api_get(self, path, params=None):
        return {}


def test_juhend_mahub_kliendi_lakke():
    assert len(SERVER_INSTRUCTIONS) <= KLIENDI_LAGI, (
        f"juhend on {len(SERVER_INSTRUCTIONS)} märki — Claude Code lõikab "
        f"{KLIENDI_LAGI} pealt ja LÕPP kaob vaikselt")


def test_server_annab_juhendi_kaasa():
    server = build_server(client=FakeClient(), base_url="https://x.test")
    assert server.instructions == SERVER_INSTRUCTIONS


def test_juhend_nimetab_keelekihid():
    """Peamine ummikusse jooksmise koht: eestikeelne päring ladina korpusesse."""
    for märksõna in ("ladina", "saksa", "rootsi", "sekundaar"):
        assert märksõna in SERVER_INSTRUCTIONS.lower()


def test_juhend_nimetab_tooriistad_toojarjekorras():
    for tööriist in ("list_filter_values", "search_works", "search_pages",
                     "get_pages", "search_persons", "list_literature",
                     "get_literature_pages"):
        assert tööriist in SERVER_INSTRUCTIONS


def test_juhend_selgitab_sonaosa_reeglit():
    """Esimene sõna peab olema terve; ilma selle reeglita otsivad agendid
    käändelõpuga täissõnu.

    Absoluutarve siia EGA dokumentatsiooni ei panda — korpus kasvab ja
    mõõdetud vastete arv vananeb. Reegel on püsiv, number mitte."""
    assert "sõnaosa" in SERVER_INSTRUCTIONS
    assert "VIIMANE" in SERVER_INSTRUCTIONS
    assert "orati" in SERVER_INSTRUCTIONS


def test_juhend_ei_luba_kitsast_ajapiiri():
    """Vana sõnastus „varauusaegse (1632-1710) trükikorpuse" pani agendi
    hilisemat materjali veaks pidama — matusetrükised, vennastekoguduse
    materjalid ja sekundaarkirjandus jäävad sellest vahemikust välja."""
    assert "1632" not in SERVER_INSTRUCTIONS
    assert "sekundaarkirjandust" in SERVER_INSTRUCTIONS


def test_juhend_ei_sisalda_arve():
    """Lehekülgede ja kaartide hulgad muutuvad iga upload'iga; juhend elab
    koodis ja vananeks vaikselt. Suurusjärk öeldakse sõnadega."""
    import re
    kahtlased = re.findall(r"~\s*\d[\d\s]*", SERVER_INSTRUCTIONS)
    assert not kahtlased, f"juhendis on vananevad arvud: {kahtlased}"
