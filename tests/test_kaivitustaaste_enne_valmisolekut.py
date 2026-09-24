"""Käivitustaasted lõpevad ENNE, kui server päringuid vastu võtab (#389).

Iga taaste otsustab lokaalse state'i hetktõmmise põhjal. Kui ta jookseb
daemon-lõimes ja `lifespan` jõuab `yield`-ini teda ootamata, võib uus päring
(nt „Rakenda" → CAS `awaiting_split → applying`) jõuda taaste lugemise ja
kirjutuse vahele — ja taaste lähtestaks päriselt käimasoleva töö.

Taasted on siin aeglustatud: vana kujuga (daemon-lõim) on nad `yield`-i
hetkel alles pooleli ja test kukub deterministlikult.
"""
import asyncio
import threading
import time

from server import main


TAASTED = [
    ("server.ada.fetch", "taasta_rippuvad_fetchid"),
    ("server.upload.apply_recovery", "taasta_rippuvad_applyd"),
    ("server.upload.import_work", "taasta_rippuvad_impordid"),
    ("server.upload.prepress", "taasta_rippuvad_eelvaated"),
]


def _vaigista_kaivitus(monkeypatch):
    """Kõik taastega mitteseotud käivitussammud no-op'iks."""
    noop = lambda *a, **k: None
    for nimi in (
        "load_client_errors", "build_work_id_cache", "run_git_fsck",
        "warm_git_index", "start_git_commit_graph_loop", "rebuild_indices",
        "metadata_watcher_loop", "_keepwarm_loop", "_ensure_filterable_attributes",
        "start_historical_regions_warm_loop", "start_upload_sync_loop",
        "start_reocr_background",
    ):
        monkeypatch.setattr(main, nimi, noop)
    monkeypatch.setattr(main, "check_render_concurrency", lambda: None)
    import server.auth
    import server.prosopography.places_ops as places_ops
    import server.prosopography.auto_enrich_runner as auto_enrich_runner
    monkeypatch.setattr(server.auth, "warn_if_no_superadmin", noop)
    monkeypatch.setattr(places_ops, "validate_places_config", noop)
    # Muidu registreerub päris planeerija ja käivitub taastelõim, mis skannib
    # päris `data/config/prosopography`-t (võimalik võrk + git-commit testi ajal).
    monkeypatch.setattr(auto_enrich_runner, "start", noop)


def test_taasted_on_lopetatud_enne_yield_i(monkeypatch):
    import importlib
    _vaigista_kaivitus(monkeypatch)

    loop_loim = []
    lopetatud = []
    loimed = []

    def aeglane(nimi):
        def taaste():
            loimed.append(threading.get_ident())
            time.sleep(0.2)
            lopetatud.append(nimi)
        return taaste

    for moodul, nimi in TAASTED:
        monkeypatch.setattr(importlib.import_module(moodul), nimi, aeglane(nimi))

    async def kaivita():
        loop_loim.append(threading.get_ident())
        async with main.lifespan(main.app):
            return list(lopetatud)

    valmis_hetkel = asyncio.run(kaivita())

    assert sorted(valmis_hetkel) == sorted(n for _, n in TAASTED)
    # ADR 0002: failisüsteemi-I/O ei tohi sündmussilmust blokeerida.
    assert loimed and all(t != loop_loim[0] for t in loimed)


def test_uhe_taaste_erand_ei_peata_kaivitust_ega_teisi(monkeypatch):
    import importlib
    _vaigista_kaivitus(monkeypatch)
    lopetatud = []

    def kukub():
        raise RuntimeError("katki")

    def ok(nimi):
        def taaste():
            time.sleep(0.1)
            lopetatud.append(nimi)
        return taaste

    for i, (moodul, nimi) in enumerate(TAASTED):
        monkeypatch.setattr(importlib.import_module(moodul), nimi,
                            kukub if i == 0 else ok(nimi))

    async def kaivita():
        async with main.lifespan(main.app):
            return list(lopetatud)

    assert sorted(asyncio.run(kaivita())) == sorted(n for _, n in TAASTED[1:])
