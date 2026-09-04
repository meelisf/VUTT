"""Migratsiooniskripti puhas loogika (#293).

Skript ise kirjutab läbi `save_work_metadata`, aga teisendus on puhas ja
testitav ilma failisüsteemita.
"""
import importlib.util
import os

_SPEC = importlib.util.spec_from_file_location(
    "fix_ada_creators_role",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                 "scripts", "fix_ada_creators_role.py"),
)
_MOD = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MOD)

paranda = _MOD.paranda_creators
on_ada = _MOD.on_ada_teos


def test_label_kuju_muutub_name_kujuks():
    """3 kirjet tootmises olid selles kujus — VUTT ei tunne `label` võtit."""
    uus, n = paranda([{"label": "Klinger, Friedrich Maximilian von"}])
    assert uus == [{"name": "Klinger, Friedrich Maximilian von", "role": "auctor"}]
    assert n == 1
    assert "label" not in uus[0], "vana võti peab kaduma — kaks tõeallikat sama nime kohta"


def test_rollita_name_kirje_saab_auctori():
    """15 kirjet tootmises: käsitsi seotud, aga roll puudu. `id`/`source` jäävad."""
    uus, n = paranda([{"name": "Friedrich Maximilian Klinger",
                       "id": "vutt:P0hus97", "source": "manual"}])
    assert uus == [{"name": "Friedrich Maximilian Klinger", "role": "auctor",
                    "id": "vutt:P0hus97", "source": "manual"}]
    assert n == 1


def test_olemasolevat_rolli_EI_muudeta():
    """Ka siis, kui roll EI OLE auctor — respondens jääb respondensiks."""
    sisse = [{"name": "X", "role": "respondens", "id": "vutt:P1"}]
    uus, n = paranda(sisse)
    assert uus == sisse
    assert n == 0


def test_idempotentne():
    """Kordusjooks ei tohi midagi muuta (ADR 0012: muutusteta salvestus = no-op)."""
    uus, _ = paranda([{"label": "Klinger"}])
    uus2, n2 = paranda(uus)
    assert uus2 == uus
    assert n2 == 0


def test_tyhi_ja_vigane_sisend():
    assert paranda(None) == ([], 0)
    assert paranda([]) == ([], 0)
    uus, n = paranda(["mitte-dikt"])
    assert uus == ["mitte-dikt"] and n == 0


def test_ainult_ada_teosed():
    assert on_ada({"external_url": "http://hdl.handle.net/10062/7822"})
    assert not on_ada({"external_url": "https://example.org/x"})
    assert not on_ada({})
    assert not on_ada({"external_url": None})
