"""#675 C: võtmepõhine lukuregister (`server/keyed_locks.py`)."""
import gc
import threading

from server.keyed_locks import KeyedLocks


def test_sama_voti_sama_lukk_eri_voti_eri_lukk():
    reg = KeyedLocks()
    assert reg.get("a") is reg.get("a")
    assert reg.get("a") is not reg.get("b")


def test_remove_unustab_luku():
    reg = KeyedLocks()
    vana = reg.get("a")
    reg.remove("a")
    assert reg.get("a") is not vana
    reg.remove("puudub")          # ei viska


def test_factory_rlock():
    reg = KeyedLocks(factory=threading.RLock)
    with reg.get("a"):
        with reg.get("a"):        # sama lõim võtab uuesti
            pass


def test_weak_lukk_elab_hoidmise_ajal_ja_kaob_parast():
    reg = KeyedLocks(weak=True)
    with reg.get("a") as hoitud:
        assert reg.get("a") is hoitud
        assert not reg.get("a").acquire(blocking=False)
    del hoitud
    gc.collect()
    assert len(reg._locks) == 0


def test_weak_lukk_valistab_teise_loime():
    reg = KeyedLocks(weak=True)
    sees, lase, tulemus = threading.Event(), threading.Event(), []

    def hoia():
        with reg.get("a"):
            sees.set()
            lase.wait(5)

    t = threading.Thread(target=hoia)
    t.start()
    assert sees.wait(5)
    tulemus.append(reg.get("a").acquire(blocking=False))
    lase.set()
    t.join(5)
    assert tulemus == [False]
