"""Prügikasti kirje liik tuleb kustutamise commiti sõnumist (#325).

Sõnumid on KIRJAS, mitte konstandist koostatud: konstandist koostatud test
kinnitaks ainult iseennast, ja just konstandi ümbernimetamine on see viga,
mille vastu siin kaitseme — git-ajalugu ei muutu tagantjärele.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import trash_reason


def test_poolituse_sonum_ajaloost():
    assert trash_reason.liigita(
        "Lõika leht 1 (1809-musta-hampa-petre-anni-elulugu): eemalda originaal [0nktwa]"
    ) == "split"


def test_kustutamise_sonumid_ajaloost():
    # Kaks kuju, mõlemad tootmise git-ajaloos olemas.
    assert trash_reason.liigita("Kustuta 1 lehte: 1779-diarium [0mqha5]") == "deleted"
    assert trash_reason.liigita("Kustuta leht: 1690-w1/pg1 [page_w1]") == "deleted"


def test_tundmatu_ja_puuduv_sonum():
    assert trash_reason.liigita("Muuda lehekülgede järjekorda: 1632-1 [meelis]") == "unknown"
    assert trash_reason.liigita(None) == "unknown"
    assert trash_reason.liigita("") == "unknown"


def test_ainult_kustutatud_on_taastatav():
    """Tundmatu EI ole taastatav — ettevaatlik suund: tundmatu päritoluga faili
    tagasitoomine võib teha duplikaadi, alles jätmine ei tee midagi."""
    assert trash_reason.on_taastatav("deleted") is True
    assert trash_reason.on_taastatav("split") is False
    assert trash_reason.on_taastatav("unknown") is False


def test_praegune_prefiks_kuulub_ajaloo_nimekirja():
    """Uus sõnastus tuleb LISADA ajaloo nimekirja, mitte asendada vana."""
    assert trash_reason.SPLIT_COMMIT_PREFIX in trash_reason.SPLIT_PREFIXES_AJALUGU
    assert trash_reason.DELETE_COMMIT_PREFIX in trash_reason.DELETE_PREFIXES_AJALUGU


def test_split_page_sonum_algab_ajaloolise_prefiksiga():
    """Kirjutaja ja liigitaja peavad kokku käima — dokumentatsioon ei jõusta midagi.

    Loeme lähtekoodist, sest sõnum sünnib f-stringis keset pikka funktsiooni ja
    tema väljakutsumine nõuaks tervet git-repot + Pillow'd.
    """
    juur = Path(__file__).resolve().parents[1]
    kood = (juur / "server" / "admin_page_ops.py").read_text(encoding="utf-8")

    assert 'SPLIT_COMMIT_PREFIX' in kood, (
        "split_page ei impordi prefiksit trash_reason-ist — sõnastus saab lahku triivida")
    assert 'DELETE_COMMIT_PREFIX' in kood, (
        "delete_pages ei impordi prefiksit trash_reason-ist")
    # Kõvakodeeritud vanu sõnumeid ei tohi järele jääda
    assert '"Lõika leht {' not in kood and "f\"Lõika leht" not in kood, (
        "leidus kõvakodeeritud „Lõika leht\" sõnum")
