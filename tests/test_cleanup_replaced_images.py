"""Koristusskripti liigitusreegel (#325).

Skript kustutab ._trash/{work_id}/replaced_images/ alt AINULT kärpe/pöörde jäägid.
`replace-image` koopiad peavad jääma: see tee kustutab ._originals kirje, seega on
tema varukoopia ainus olemasolev. Vale liigitus = pöördumatu andmekadu, nii et
reegel on siin lukus.
"""
import importlib.util
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _load_script():
    spec = importlib.util.spec_from_file_location(
        "cleanup_replaced_images",
        PROJECT_ROOT / "scripts" / "cleanup_replaced_images.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


SCRIPT = _load_script()


def test_transform_ajatempel_tuvastatakse():
    """Mikrosekundi-rühm lõpus = transform_page_image / restore_original_page_image."""
    m = SCRIPT.TRANSFORM_RE.match("r_acad_dorp_1649_7_8_vt_1649_1_0003_20260907_125448_781102.jpg")
    assert m is not None
    assert m.group("base") == "r_acad_dorp_1649_7_8_vt_1649_1_0003"
    assert m.group("ext") == ".jpg"


def test_replace_image_ajatempel_ei_kuulu_kustutamisele():
    """Ilma mikrosekunditeta = replace-image → EI tohi vastet anda."""
    assert SCRIPT.TRANSFORM_RE.match("r_acad_dorp_1649_7_8_vt_1649_1_0003_20260907_125448.jpg") is None


def test_nanoid_failinimi_ja_png():
    m = SCRIPT.TRANSFORM_RE.match("1649-7-Inclytae-9ghbrc-vs5vh1_20260907_125459_478162.png")
    assert m is not None and m.group("ext") == ".png"


def test_baas_mis_ise_lopeb_numbritega_ei_eksita():
    """Kaheksakohaline lõpp baasis + replace-image tempel ei tohi näida transformina."""
    assert SCRIPT.TRANSFORM_RE.match("skann_20250101_20260907_125448.jpg") is None


def test_kustutab_ainult_kui_pristine_originaal_on_olemas(tmp_path, monkeypatch):
    trash = tmp_path / "._trash" / "w1" / "replaced_images"
    trash.mkdir(parents=True)
    originals = tmp_path / "._originals" / "w1"
    originals.mkdir(parents=True)

    kaetud = trash / "leht_a_20260907_125448_781102.jpg"      # ._originals olemas
    orb = trash / "leht_b_20260907_125448_781102.jpg"          # ._originals puudub
    asendus = trash / "leht_c_20260907_125448.jpg"             # replace-image
    for f in (kaetud, orb, asendus):
        f.write_bytes(b"x")
    (originals / "leht_a.jpg").write_bytes(b"originaal")

    monkeypatch.setattr(SCRIPT, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(SCRIPT, "TRASH_DIR", str(tmp_path / "._trash"))
    monkeypatch.setattr(SCRIPT, "ORIGINALS_DIR", str(tmp_path / "._originals"))

    kustutatavad, sailivad, orvud = SCRIPT.kogu_kandidaadid()
    assert [Path(t).name for t, _ in kustutatavad] == [kaetud.name]
    assert [Path(t).name for t, _ in sailivad] == [asendus.name]
    assert [Path(t).name for t, _ in orvud] == [orb.name]
