"""Kasutajate jagatud cache-objekti loe-muuda-salvesta lukk (ADR 0043 p3).

`load_users()` tagastab JAGATUD dicti. Kui muudatus toimub väljaspool lukku,
võib teine lõim serialiseerida poolikut olekut või kaotada oma muudatuse.
"""
import copy
import threading
import time

import pytest

KOLLEKTSIOONID = {"sample": {"name": {"et": "Näidis"}, "visibility": "restricted"}}


def test_kaks_kirjutajat_ei_kaota_teineteise_muudatust(backend_env, monkeypatch):
    """Kadunud uuenduse ja ummiku suitsutest.

    NB: see test EI eristaks üksi vana koodi uuest — `save_users` võtab lukku
    ka praegu, nii et teine lõim jääb juba `load_users()`-is ootele. Tegelik
    invariant („kontroll ja muutmine on SAMA luku all") on kaetud allpool
    `test_users_transaction_hoiab_lukku_kogu_bloki`-ga ja struktuurivalvuriga
    `test_koik_kirjutajad_kasutavad_users_transactionit`.
    """
    auth = backend_env["auth"]
    # `get_cached_collections` loeb PÄRIS config-teed — testides patchitakse
    # see alati (vt tests/test_user_collections_api.py `_patch_restricted`).
    monkeypatch.setattr(auth, "get_cached_collections", lambda: KOLLEKTSIOONID)

    alustatud = threading.Event()
    lase_edasi = threading.Event()
    paris_write = auth.atomic_write_json
    kirjutatud = []

    def aeglane_write(path, data):
        # Serialiseerimise AJAL peab dict olema muutumatu: teine lõim ootab lukku.
        alustatud.set()
        lase_edasi.wait(timeout=5)
        kirjutatud.append(copy.deepcopy(data))
        paris_write(path, data)

    monkeypatch.setattr(auth, "atomic_write_json", aeglane_write)

    admin = {"username": "admin", "role": "admin"}
    vead = []

    def esimene():
        ok, _sonum, _ = auth.update_user_edit_collections("contrib", ["sample"], admin)
        if not ok:
            vead.append("esimene")

    def teine():
        alustatud.wait(timeout=5)
        # Peab OOTAMA luku taga, mitte lugema poolikut cache'i.
        ok, _sonum, _ = auth.update_user_edit_collections("contrib_muu", ["sample"], admin)
        if not ok:
            vead.append("teine")

    t1 = threading.Thread(target=esimene)
    t2 = threading.Thread(target=teine)
    t1.start()
    t2.start()
    alustatud.wait(timeout=5)
    time.sleep(0.3)
    lase_edasi.set()
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert vead == []
    # Kumbki muudatus ei kao: kaks samaaegset kirjutajat seerialiseeruvad,
    # mitte ei kirjuta teineteist üle.
    assert kirjutatud[0]["contrib_muu"]["edit_collections"] == ["muu"]
    kasutajad = auth.reload_users_cache()
    assert kasutajad["contrib"]["edit_collections"] == ["sample"]
    assert kasutajad["contrib_muu"]["edit_collections"] == ["sample"]


def test_users_transaction_hoiab_lukku_kogu_bloki(backend_env):
    auth = backend_env["auth"]
    with auth.users_transaction() as users:
        # RLock on sama lõime jaoks reentrantne; `locked()` puudub RLock-il,
        # seega kontrollime, et teine lõim EI saa lukku.
        sai_luku = []

        def proovi():
            sai_luku.append(auth.users_lock.acquire(blocking=False))
            if sai_luku[-1]:
                auth.users_lock.release()

        t = threading.Thread(target=proovi)
        t.start()
        t.join(timeout=5)
        assert sai_luku == [False]
        assert "admin" in users


def test_koik_kirjutajad_kasutavad_users_transactionit():
    """Valvur: uus `save_users` kutse ilma lukuta on vaikne regressioon.

    Grep-tasemel kontroll on siin tahtlik — käitumistestiga ei saa tõestada,
    et KEEGI EI kirjuta lukuta. Kutsuja peab `save_users`-i juurde võtma ka
    `users_transaction`-i (või olema auth.py enda lukustatud tee).
    """
    import pathlib
    import re

    juur = pathlib.Path(__file__).resolve().parents[1]
    lubatud_ilma = {
        "server/auth.py",           # siin ON lukk (users_transaction / save_users ise)
        "server/registration.py",   # AJUTINE — eemalda Task 4 sammus 5
    }
    for fail in sorted((juur / "server").rglob("*.py")):
        suhteline = str(fail.relative_to(juur))
        if suhteline in lubatud_ilma:
            continue
        tekst = fail.read_text(encoding="utf-8")
        if re.search(r"\bsave_users\s*\(", tekst):
            assert "users_transaction" in tekst, (
                f"{suhteline} kutsub save_users-i ilma users_transaction-ita"
            )
        assert "atomic_write_json(USERS_FILE" not in tekst, (
            f"{suhteline} kirjutab users.json-i save_users-ist mööda"
        )
