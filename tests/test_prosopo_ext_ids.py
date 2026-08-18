"""Väliste identifikaatorite ühtne vorming (issue #240).

Andmetes esines sama skeem kahel kujul — `AA:341` ja `341`, `GND:1029967695` ja
`1029967695` — mis lõhkus kaks asja korraga: rikastuse URL (`lobid.org/gnd/GND:123`
→ 404) ja dublikaadikontrolli, mis võrdleb `scheme:id` võtit stringina.

Kanooniline kuju on PALJAS identifikaator: skeem on juba eraldi väli, prefiks
selle sees on üleliigne. Frontendi vorm tegi seda juba osaliselt
(`personForm/helpers.ts`) — see moodul on sama reegli ainus allikas.
"""
import pytest

from server.prosopography.ext_ids import normalize_ext_id


@pytest.mark.parametrize("raw,expected", [
    ("GND:1029967695", "1029967695"),
    ("gnd:104367439X", "104367439X"),
    (" 172827663 ", "172827663"),
    ("1029967695", "1029967695"),
])
def test_gnd_prefiks_ja_tyhikud_eemaldatakse(raw, expected):
    assert normalize_ext_id("gnd", raw) == expected


def test_gnd_kontrollnumber_suureks():
    """GND kontrollnumber on X; väiketäht murraks URL-i võrdluse."""
    assert normalize_ext_id("gnd", "104367439x") == "104367439X"


@pytest.mark.parametrize("raw,expected", [
    ("AA:341", "341"),
    ("aa:341", "341"),
    ("album_academicum:341", "341"),
    (" 243", "243"),
])
def test_aa_prefiks_eemaldatakse(raw, expected):
    assert normalize_ext_id("album_academicum", raw) == expected


@pytest.mark.parametrize("raw", ["VIAF:42149542770600301291", "viaf:42149542770600301291"])
def test_viaf_prefiks_eemaldatakse(raw):
    assert normalize_ext_id("viaf", raw) == "42149542770600301291"


@pytest.mark.parametrize("raw", ["Q20933569", "q20933569", "wikidata:Q20933569", "wd:Q20933569"])
def test_wikidata_kanooniline_on_suur_q(raw):
    assert normalize_ext_id("wikidata", raw) == "Q20933569"


def test_voeoerast_skeemist_prefiksit_ei_eemaldata():
    """`AA:341` gnd-väljal on andmeviga, mitte prefiks — ära vaikselt paranda."""
    assert normalize_ext_id("gnd", "AA:341") == "AA:341"


def test_tundmatu_skeem_ainult_trimmitakse():
    assert normalize_ext_id("orcid", " 0000-0002-1825-0097 ") == "0000-0002-1825-0097"


@pytest.mark.parametrize("scheme,raw", [
    ("gnd", None),
    ("gnd", ""),
    ("gnd", "   "),
    ("gnd", "GND:"),
    ("album_academicum", "AA:"),
])
def test_tyhi_vaartus_annab_tyhja_stringi(scheme, raw):
    assert normalize_ext_id(scheme, raw) == ""


# ─────────────────────────────────────────────────────────────
# Kirjutus- ja rikastustee kasutavad sama reeglit
# ─────────────────────────────────────────────────────────────

from unittest.mock import MagicMock, patch  # noqa: E402


def _fake_save_with_git(file_path, content, username, message=None):
    """Kirjutab faili päriselt (aga ilma gitita) — muidu ei leia get_person kaarti."""
    import os
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
    return {"success": True, "commit_hash": "abc12345"}


def _patched_ops(tmp_path):
    """create_person/add_identifier isoleeritud kaustas, ilma gitita."""
    return (
        patch("server.prosopography.ops.PROSOPOGRAPHY_DIR", str(tmp_path)),
        patch("server.prosopography.ops.save_with_git", _fake_save_with_git),
        patch("server.prosopography.ops._update_index_entry"),
        patch("server.prosopography.ops._update_aliases_entry"),
    )


def test_create_person_salvestab_id_kanoonilisel_kujul(tmp_path):
    p1, p2, p3, p4 = _patched_ops(tmp_path)
    with p1, p2, p3, p4:
        from server.prosopography import ops
        person = ops.create_person(
            {"name": "Laurentius Ludenius",
             "identifiers": [{"scheme": "gnd", "id": "GND:1029967695"}]},
            "testuser",
        )
    assert person["identifiers"] == [{"scheme": "gnd", "id": "1029967695"}]


def test_add_identifier_ei_lisa_sama_id_teist_kuju(tmp_path):
    """`GND:123` lisamine kaardile, kus on juba `123`, ei tohi teha teist kirjet."""
    p1, p2, p3, p4 = _patched_ops(tmp_path)
    with p1, p2, p3, p4, \
         patch("server.prosopography.enrichment.fetch_and_diff",
               MagicMock(return_value={"auto_filled": {}, "conflicts": []})):
        from server.prosopography import ops
        person = ops.create_person(
            {"name": "Test", "identifiers": [{"scheme": "gnd", "id": "1029967695"}]},
            "testuser",
        )
        updated, _ = ops.add_identifier(person["id"], "gnd", "GND:1029967695", "testuser")

    gnd = [i for i in updated["identifiers"] if i["scheme"] == "gnd"]
    assert len(gnd) == 1
    assert gnd[0]["id"] == "1029967695"


def test_ensure_prosopo_ei_tee_dublikaati_prefiksi_pärast(tmp_path):
    """Metaandmete salvestus tõi `GND:123`, kaardil on `123` — sama isik."""
    from server.prosopography import ext_id_index
    p1, p2, p3, p4 = _patched_ops(tmp_path)
    with p1, p2, p3, p4:
        from server.prosopography import ops
        ext_id_index.invalidate()
        olemas = ops.create_person(
            {"name": "Test", "identifiers": [{"scheme": "gnd", "id": "1029967695"}]},
            "testuser",
        )
        ext_id_index.invalidate()
        tulemus = ops.ensure_prosopo_for_entity(
            {"id": "GND:1029967695", "label": "Test", "source": "gnd"}, "testuser"
        )
    ext_id_index.invalidate()
    assert tulemus["id"] == olemas["id"]


def test_fetch_and_diff_normaliseerib_id_enne_paringut():
    """`lobid.org/gnd/GND:123` andis 404 — rikastus ebaõnnestus vaikselt."""
    from server.prosopography import enrichment
    mock_fetch = MagicMock(return_value={})
    with patch.object(enrichment, "_fetch_gnd", mock_fetch):
        enrichment.fetch_and_diff("gnd", "GND:122483294", {"name": {"label": "x"}})
    mock_fetch.assert_called_once_with("122483294")
