# tests/test_strip_image_filename.py
import importlib.util
import os

_SCRIPT = os.path.join(os.path.dirname(__file__), "..", "scripts", "migrate_strip_image_filename.py")
_spec = importlib.util.spec_from_file_location("migrate_strip_image_filename", _SCRIPT)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
strip = _mod.strip_leading_image_name


def test_strips_own_image_name():
    raw = "r_acad_dorp_1645_29_0001.jpg\nDISPUTATIO THEOLOGICA\nIn"
    fixed, did = strip(raw, "/x/r_acad_dorp_1645_29_0001.txt")
    assert did is True
    assert fixed == "DISPUTATIO THEOLOGICA\nIn"


def test_case_insensitive_and_extensions():
    for line in ("A_0001.JPG", "A_0001.jpeg", "A_0001.png"):
        fixed, did = strip(f"{line}\ntekst", "/x/A_0001.txt")
        assert did is True
        assert fixed == "tekst"


def test_strips_following_blank_lines():
    raw = "p1.jpg\n\n\nSisu"
    fixed, did = strip(raw, "/x/p1.txt")
    assert did is True
    assert fixed == "Sisu"


def test_leaves_real_text_untouched():
    raw = "DISPUTATIO THEOLOGICA\nIn caput"
    fixed, did = strip(raw, "/x/p1.txt")
    assert did is False
    assert fixed == raw


def test_ignores_different_filename():
    # Juhtiv rida on MÕNE MUU lehe pildinimi → EI puutu (0 valepositiivi reegel)
    raw = "p2.jpg\ntekst"
    fixed, did = strip(raw, "/x/p1.txt")
    assert did is False
    assert fixed == raw


def test_filename_only_page_becomes_empty():
    fixed, did = strip("p1.jpg", "/x/p1.txt")
    assert did is True
    assert fixed == ""


def test_strips_filename_prefix_on_same_line():
    # Variant B: failinimi + tühik + päris tekst samal real → jäta ainult tekst
    raw = "r_acad_dorp_1633_16_17_0002.jpg 1633:16 LESSUS. I.\nteine rida"
    fixed, did = strip(raw, "/x/r_acad_dorp_1633_16_17_0002.txt")
    assert did is True
    assert fixed == "1633:16 LESSUS. I.\nteine rida"


def test_prefix_needs_whitespace_boundary():
    # "p1.jpgX" ei ole failinimi-token → ei puutu
    raw = "p1.jpgX rest"
    fixed, did = strip(raw, "/x/p1.txt")
    assert did is False
    assert fixed == raw


def test_does_not_strip_filename_mid_text():
    # Nimi ei ole esimesel real → ei puutu
    raw = "Sisu\np1.jpg"
    fixed, did = strip(raw, "/x/p1.txt")
    assert did is False
    assert fixed == raw


def test_any_name_strips_foreign_filename():
    # Ümbernimetatud fail: tekstis vana skaneeringu nimi, ei vasta failinimele.
    raw = "r_acad_dorp_1633_16_17_0002.jpg 1633:16 LESSUS\nrida2"
    # Range reegel EI puutu (nimi ei vasta failinimele)
    fixed, did = strip(raw, "/x/1633-16-Menius-xta9hx-2ywsfa.txt")
    assert did is False
    # any_name reegel eemaldab
    fixed, did = strip(raw, "/x/1633-16-Menius-xta9hx-2ywsfa.txt", any_name=True)
    assert did is True
    assert fixed == "1633:16 LESSUS\nrida2"


def test_any_name_whole_line_filename():
    raw = "r_acad_dorp_1633_16_17_0006.jpg\nSisu"
    fixed, did = strip(raw, "/x/foo.txt", any_name=True)
    assert did is True
    assert fixed == "Sisu"


def test_any_name_does_not_strip_real_text():
    raw = "In principio erat verbum\nrida2"
    fixed, did = strip(raw, "/x/foo.txt", any_name=True)
    assert did is False
    assert fixed == raw
