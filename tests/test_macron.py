"""ADR 0062: lühendusmärk on makron. Juhtumid kattuvad LOSS-i
`scripts/lyhend_makron.py --test`-iga (Kurrendi treeningandmed) — kaart peab olema sama."""
import unicodedata as ud

import pytest

from server.macron import convert_text, is_guarded, tilde_words, to_macron

NFC = lambda s: ud.normalize("NFC", s)  # noqa: E731


@pytest.mark.parametrize("sisend, oodatud", [
    ("Camm\u0303erherr", "Camm\u0304erherr"),
    ("cũ nõ dẽ", "cū nō dē"),
    ("vñ weñ", "vn\u0304 wen\u0304"),
    ("q\u0303", "q\u0304"),
    ("m\u0305", "m\u0304"),                 # ülakriips → makron
    ("8\u0305", "8\u0305"),           # numbri vinculum jääb
    ("ῖ υ\u0303", "ῖ υ\u0303"),       # kreeka jääb
    ("a ~ b", "a ~ b"),               # eraldiseisev kordusmärk jääb
    ("ā\u0304", "ā"),                 # topeltmakron → üks
    ("Õ", "Ō"),
])
def test_to_macron_kaart(sisend, oodatud):
    tul, _ = to_macron(sisend)
    assert tul == NFC(oodatud)


def test_to_macron_loendab_ja_annab_nfc():
    tul, n = to_macron("cũ m\u0303 ā\u0304")
    assert n == 3
    assert tul == NFC(tul)


def test_to_macron_muutuseta_tekst_on_nfc_ja_null():
    lahutatud = "e\u0304"                  # juba makron, aga NFD-kujul
    tul, n = to_macron(lahutatud)
    assert n == 0 and tul == "ē"


@pytest.mark.parametrize("keeled, oodatud", [
    (["est"], True), (["et"], True), (["la", "es"], True), (["por"], True),
    (["lat", "ger"], False), ([], False), (None, False), (["EST "], True),
])
def test_keelevalvur(keeled, oodatud):
    assert is_guarded(keeled) is oodatud


def test_tilde_words_leiab_lahutatud_ja_precomposed():
    assert tilde_words("Jõgi nõ m\u0303ea cum") == ["Jõgi", "nõ", NFC("m\u0303ea")]
    assert tilde_words("ῖ υ\u0303 8\u0305") == []


def test_convert_text_valvuriga_keel_ei_muuda_vaid_raporteerib():
    tekst = "Jõgi ja nõ"
    uus, n, aruanne = convert_text(tekst, ["est", "lat"])
    assert uus == tekst and n == 0
    assert aruanne == ["Jõgi", "nõ"]


def test_convert_text_muu_keel_teisendab():
    uus, n, aruanne = convert_text("nõ cũ", ["lat"])
    assert uus == "nō cū" and n == 2 and aruanne == []
