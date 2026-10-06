"""Leinatrükiste `dedicator` → `gratulator`: ainult see roll, muud jäävad."""
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "migrate_dedicator_to_gratulator",
    Path(__file__).resolve().parent.parent / "scripts" / "migrate_dedicator_to_gratulator.py",
)
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)


def test_ainult_dedicator_muutub():
    creators = [
        {"name": "A", "role": "auctor"},
        {"name": "B", "role": "dedicator", "id": "vutt:P1"},
        {"name": "C", "role": "gratulator"},
    ]
    out, n = mig.retag(creators)
    assert n == 1
    assert [c["role"] for c in out] == ["auctor", "gratulator", "gratulator"]
    assert out[1]["id"] == "vutt:P1"
    assert creators[1]["role"] == "dedicator", "sisend ei tohi muutuda"


def test_kordus_on_no_op():
    out, _ = mig.retag([{"name": "B", "role": "dedicator"}])
    assert mig.retag(out)[1] == 0
