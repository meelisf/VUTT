"""Liitmine kopeerib pildi sihtkaardile, kui sihil pilti ei ole (#240).

Pildifail elab `images/`-kaustas, mitte kaardi JSON-is — enne seda jäi
liidetava kaardi ainuke pilt tombstone'i taha (Glück, 2026-10-30).
"""
import pytest

from server.prosopography import merge_ops


@pytest.fixture
def env(prosopo_env, monkeypatch):
    monkeypatch.setattr(merge_ops, "_rebind_work_parts", lambda *a, **k: None)
    prosopo_env.images = prosopo_env.dir / "images"
    return prosopo_env


def _pilt(env, nanoid, sisu, ext=".jpg"):
    env.images.mkdir(exist_ok=True)
    (env.images / f"{nanoid}{ext}").write_bytes(sisu)


def test_allika_pilt_kopeeritakse_pildita_sihile(env):
    env.write("src", image_url="/api/files/prosopography/vutt%3APsrc/image?v=1")
    env.write("tgt", image_url=None)
    _pilt(env, "src", b"allika-pilt")

    merge_ops.merge_person("vutt:Psrc", "vutt:Ptgt", "admin")

    assert (env.images / "tgt.jpg").read_bytes() == b"allika-pilt"
    assert env.read("tgt")["image_url"].startswith("/api/files/prosopography/vutt%3APtgt/image?v=")
    # Kopeerimine, mitte liigutamine: tombstone jääb taastatavaks.
    assert (env.images / "src.jpg").exists()


def test_webp_laiend_sailib(env):
    env.write("src")
    env.write("tgt")
    _pilt(env, "src", b"webp", ext=".webp")

    merge_ops.merge_person("vutt:Psrc", "vutt:Ptgt", "admin")

    assert (env.images / "tgt.webp").read_bytes() == b"webp"


def test_sihi_oma_pilt_jaab(env):
    sihi_url = "/api/files/prosopography/vutt%3APtgt/image?v=9"
    env.write("src")
    env.write("tgt", image_url=sihi_url)
    _pilt(env, "src", b"allika-pilt")
    _pilt(env, "tgt", b"sihi-pilt")

    merge_ops.merge_person("vutt:Psrc", "vutt:Ptgt", "admin")

    assert (env.images / "tgt.jpg").read_bytes() == b"sihi-pilt"
    assert env.read("tgt")["image_url"] == sihi_url


def test_pildita_allikas_ei_muuda_sihti(env):
    env.write("src")
    env.write("tgt", image_url=None)

    merge_ops.merge_person("vutt:Psrc", "vutt:Ptgt", "admin")

    assert env.read("tgt").get("image_url") is None
    assert not (env.images / "tgt.jpg").exists()
