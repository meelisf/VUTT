"""
Testid ``_patch_config_const`` helperile (Faas 0 conftest infra).

Kaetud käitumine:
- konstandi olemasolu vähemalt ühes moodulis → patchitakse kõigil omanikel
- konstandi puudumine KÕIGIS moodulites → ``AttributeError`` (turvavõrk,
  mis tabab "vaikset testi-katkemist": kui refaktoreering tõstab konstandi
  routerisse, aga unustab conftesti moodulite loetelu uuendada)
- mitte-omanikke ignoreeritakse (ei looda fantoomatribuute)

See helper on refaktoreeringu Faas 0 tuum: see tagab, et endpointide tõstmine
``routers/*.py``-sse ei tekita vaikselt katkisi teste. Vt
``docs/REFACTOR_main_py_2026-06-25.md``.
"""
import pytest


def test_patch_const_raises_when_no_module_owns_it(monkeypatch):
    """Turvavõrk: kui konstant puudub kõikidest loetletud moodulitest, viskab
    ``AttributeError`` — just see signaal, mis varem ``monkeypatch.setattr(main,
    ...)`` raising=True vaikimisi andis ja mida ``raising=False`` oleks kaotanud."""
    from tests.conftest import _patch_config_const

    with pytest.raises(AttributeError) as exc:
        _patch_config_const(
            monkeypatch,
            {"OLEMATU_KONSTANT_XYZ123": "väärtus"},
            modules=["server.main"],
        )
    # Veateade peab mainima konstandi nime, et arendaja teaks, mida parandada.
    assert "OLEMATU_KONSTANT_XYZ123" in str(exc.value)


def test_patch_const_raises_across_all_listed_modules(monkeypatch):
    """Kui loetletud on mitu moodulit aga ükski ei omasta konstantit → ikka
    ``AttributeError`` (otsiruum tühi)."""
    from tests.conftest import _patch_config_const

    with pytest.raises(AttributeError):
        _patch_config_const(
            monkeypatch,
            {"OLEMATU_KONSTANT_XYZ123": "väärtus"},
            modules=["server.main", "server.upload_ops"],
        )


def test_patch_const_succeeds_when_at_least_one_module_owns(monkeypatch):
    """Konstandi olemasolu vähemalt ühes moodulis → patch õnnestub."""
    from tests.conftest import _patch_config_const
    from server.routers import collections as collections_router

    _patch_config_const(
        monkeypatch,
        {"COLLECTIONS_FILE": "/tmp/test-collections-xyz"},
        modules=["server.routers.collections"],
    )
    assert collections_router.COLLECTIONS_FILE == "/tmp/test-collections-xyz"


def test_patch_const_patches_all_owners(monkeypatch):
    """Kui konstant on mitmes moodulis (nt UPLOADS_DIR main-is + upload_ops-is + upload-routeris),
    patchitakse kõik."""
    from tests.conftest import _patch_config_const
    from server import main
    import server.upload_ops as upload_ops
    import server.routers.upload as upload_router

    _patch_config_const(
        monkeypatch,
        {"UPLOADS_DIR": "/tmp/test-uploads-xyz"},
        modules=["server.main", "server.upload_ops", "server.routers.upload"],
    )
    assert main.UPLOADS_DIR == "/tmp/test-uploads-xyz"
    assert upload_ops.UPLOADS_DIR == "/tmp/test-uploads-xyz"
    assert upload_router.UPLOADS_DIR == "/tmp/test-uploads-xyz"


def test_patch_const_ignores_non_owners_without_creating_phantoms(monkeypatch):
    """Mitte-omanikku (nt ``server.work_meta`` ei impordi UPLOADS_DIR-i) ignoreeritakse
    ja talle EI looda fantoomatribuuti — loetelu peab jääma täpseks."""
    from tests.conftest import _patch_config_const
    import server.work_meta as work_meta

    _patch_config_const(
        monkeypatch,
        {"UPLOADS_DIR": "/tmp/test-uploads-xyz"},
        modules=["server.upload_ops", "server.work_meta"],  # work_meta ei oma UPLOADS_DIR-i
    )
    # work_meta peab jääma puutumata: ei UPLOADS_DIR-i atribuuti ega muudatust
    assert not hasattr(work_meta, "UPLOADS_DIR"), (
        "work_meta ei tohiks saada fantoom UPLOADS_DIR-i — see tähendaks, et "
        "helper loob kasutuid atribuute ja varjab vale mulje kaetusest."
    )
