"""Jätkatav (tükeldatud) üleslaadimine (#235, ADR 0047).

Üks faili kohta ühe HTTP-päringuna tähendas, et katkemine aeglasel liinil
(28 min / 85 MB pealt, 2026-08-15) viis kogu edenemise. Nüüd saadab klient
faili tükkidena ja server kirjutab need `uploads/{id}/source.part`-i.

Kolm reeglit:

1. **Tõde on ketas.** Vastu võetud baitide arv = `source.part` suurus, mitte
   olekufaili number. Kadunud vastuse järel küsib klient serverilt
   (`get_partial`) ja jätkab sealt.
2. **Nihe peab võrduma kettal olevaga.** Muidu `ChunkConflict` koos tegeliku
   seisuga — tükki ei kirjutata kunagi topelt ega auguga.
3. **Uut upload'i staatust ei ole.** Poolik fail elab `pending` all eraldi
   väljal `partial_upload`; `ALL_STATUSES` (#314) ja frontendi klassifikatsioon
   ei muutu. Viimane tükk annab faili samale teele, mis enne (`store_pdf` /
   üksikpilt), ja see seab staatuse edasi.
"""
import os
from datetime import datetime

from . import state as upload_state

# Kogusuuruse lagi = nginx-i `client_max_body_size` ühe-päringu-teel. Tükkidena
# nginx seda enam ei jõusta, seega peab server.
UPLOAD_MAX_BYTES = 600 * 1024 * 1024
# Ühe tüki lagi serveri poolel. Klient saadab väiksemaid (`CHUNK_SIZE` TS-is).
CHUNK_MAX_BYTES = 16 * 1024 * 1024

PART_NAME = "source.part"


class ChunkConflict(Exception):
    """Tükki ei saa sellele kohale kirjutada. `received` = serveri tegelik seis."""

    def __init__(self, reason: str, received: int, message: str):
        super().__init__(message)
        self.reason = reason  # "offset" | "mismatch" | "status"
        self.received = received


def part_path(upload_id: str) -> str:
    return os.path.join(upload_state.upload_dir(upload_id), PART_NAME)


def _kettal(upload_id: str) -> int:
    try:
        return os.path.getsize(part_path(upload_id))
    except OSError:
        return 0


def get_partial(upload_id: str) -> dict:
    """Jätkamispunkt: kui palju serveril on ja millisest failist."""
    s = upload_state.read_state(upload_id)
    if s is None:
        raise KeyError(upload_id)
    p = s.get("partial_upload") or {}
    return {
        "received": _kettal(upload_id) if p else 0,
        "total": p.get("total"),
        "fingerprint": p.get("fingerprint"),
        "name": p.get("name"),
        "status": s.get("status"),
    }


def _finalize(upload_id: str, path: str) -> int:
    """Valmis fail samale teele, mis ühe-päringu-üleslaadimisel (tüübituvastus
    magic byte'idest, PDF → `store_pdf`, pilt → üheleheline kaust)."""
    from ..upload_ops import save_and_transfer_to_ocr
    return save_and_transfer_to_ocr(upload_id, path)


def append_chunk(upload_id: str, *, offset: int, total: int, fingerprint: str,
                 name: str, data: bytes) -> dict:
    """Kirjutab ühe tüki. Viimase tüki järel annab faili edasi (`_finalize`).

    Blokeeriv I/O — kutsuda threadpoolist (ADR 0002).
    """
    if not (0 < total <= UPLOAD_MAX_BYTES):
        raise ValueError("Fail on liiga suur (üle {} MB)".format(UPLOAD_MAX_BYTES // (1024 * 1024)))
    if len(data) > CHUNK_MAX_BYTES or offset < 0 or offset + len(data) > total:
        raise ValueError("Vigane tükk")
    if not fingerprint or len(fingerprint) > 128:
        raise ValueError("Vigane faili sõrmejälg")

    lock = upload_state.get_upload_lock(upload_id)
    with lock:
        s = upload_state.read_state(upload_id)
        if s is None:
            raise KeyError(upload_id)
        if s.get("status") != "pending":
            raise ChunkConflict("status", _kettal(upload_id),
                                "Fail on selle upload'i jaoks juba vastu võetud")
        partial = s.get("partial_upload")
        tee = part_path(upload_id)
        if partial and partial.get("finalizing"):
            # Viimane tükk on käes ja fail liigub salvestusteele. Nihkega 0
            # päring (nt teine vahekaart) tühjendaks muidu loetava faili.
            raise ChunkConflict("status", _kettal(upload_id),
                                "Fail on vastu võetud, töötlemine käib")

        if offset == 0:
            # Uus fail (või teadlik otsast alustamine): vana poolik kaob.
            partial = {"total": total, "fingerprint": fingerprint, "name": name[:255],
                       "started_at": datetime.now().isoformat()}
            with open(tee, "wb"):
                pass
        else:
            olemas = _kettal(upload_id)
            if not partial or partial.get("fingerprint") != fingerprint \
                    or partial.get("total") != total:
                raise ChunkConflict("mismatch", olemas,
                                    "Pooleliolev üleslaadimine on teisest failist")
            if offset != olemas:
                raise ChunkConflict("offset", olemas,
                                    "Nihe ei vasta serveri seisule")

        with open(tee, "ab") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        received = offset + len(data)
        partial = {**partial, "received": received, "updated_at": datetime.now().isoformat()}
        if received == total:
            partial["finalizing"] = True
        s["partial_upload"] = partial
        upload_state.write_state(upload_id, s)

    if received < total:
        return {"received": received, "total": total, "complete": False}

    # Viimane tükk: fail edasi LUKU VÄLJAS — salvestustee võtab sama luku ise.
    try:
        pages = _finalize(upload_id, tee)
    finally:
        _unusta_poolik(upload_id)
    return {"received": received, "total": total, "complete": True, "expected_pages": pages}


def _unusta_poolik(upload_id: str) -> None:
    """Eemaldab `partial_upload` kirje ja järelejäänud `.part`-faili."""
    with upload_state.get_upload_lock(upload_id):
        s = upload_state.read_state(upload_id)
        if s is not None and "partial_upload" in s:
            del s["partial_upload"]
            upload_state.write_state(upload_id, s)
    try:
        os.unlink(part_path(upload_id))
    except FileNotFoundError:
        pass


def as_conflict_body(e: ChunkConflict) -> dict:
    return {"detail": str(e), "reason": e.reason, "received": e.received}

