"""ADR 0064 migratsioon: ainult kinnitatud pealkiri jagatakse, kordus on no-op."""
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "migrate_title_translations",
    Path(__file__).resolve().parent.parent / "scripts" / "migrate_title_translations.py",
)
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)

ET, EN = mig.SPLITS["0ajcsn"]


def test_kinnitatud_pealkiri_jagatakse_ja_originaal_lisandub():
    u = mig.title_updates("0ajcsn", {"title": f"{ET} / {EN}"})
    assert u == {"title": ET, "title_en": EN, "title_devised": True,
                 "title_original": mig.ORIGINALS["0ajcsn"]}


def test_muutunud_pealkiri_jaetakse_vahele():
    assert mig.title_updates("0ajcsn", {"title": "Käsitsi parandatud"}) == {}


def test_kordus_on_no_op():
    meta = {"title": ET, "title_en": EN, "title_devised": True, "title_original": mig.ORIGINALS["0ajcsn"]}
    assert mig.title_updates("0ajcsn", meta) == {}


def test_nimekirjast_valjas_teost_ei_puututa():
    """Baumanni vastutusandmed jms — ` / ` olemas, aga nimekirjas pole."""
    assert mig.title_updates("jbc88t", {"title": "… põhikiri / ümber kirjutanud H. Baumann"}) == {}


def test_nimekirjas_on_20_teost():
    assert len(mig.SPLITS) == 20
