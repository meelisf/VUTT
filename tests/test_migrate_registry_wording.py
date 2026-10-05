"""ADR 0059 täiendus: migratsioon — amet reegli kaudu, tõendita asutus ilma märketa."""
import importlib.util
import os

from server.prosopography import registries

_spec = importlib.util.spec_from_file_location(
    "migrate_registry_wording", os.path.join(os.path.dirname(__file__), "..", "scripts", "migrate_registry_wording.py"))
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)

INST = {"agc": {"labels": {"et": "Academia Gustavo-Carolina"}, "variants": ["AGC"]}}


def _fix(sections):
    return m.fix_institutions(sections, INST, registries._known_names, registries.registry_name)


def test_tooendita_asutus_saab_registri_nime_ilma_markuseta():
    person = {"education": [
        {"institution": "Academia Gustaviana", "institution_key": "agc", "type": "imm."},
        {"institution": "Academia Gustaviana", "institution_key": "agc", "evidence": [{"quote": "x"}]},
        {"institution": "AGC", "institution_key": "agc"},
        {"institution": "Gymn. Skara"},
    ]}
    sent, changes = m.plan(person, lambda d: d, _fix)
    assert sent["education"][0] == {"institution": "Academia Gustavo-Carolina", "institution_key": "agc", "type": "imm."}
    assert sent["education"][1:] == person["education"][1:]      # tõendiga, variant, sidumata: puutumata
    assert len(changes) == 1


def test_ainult_muutuvad_faktid():
    def normalize(data):
        return {s: [{**f, "label": "professor"} if f.get("label") == "Prof." else f for f in data[s]] for s in data}
    person = {"occupations": [{"label": "Prof."}, {"label": "pastor"}], "education": []}
    _, changes = m.plan(person, normalize, lambda d: d)
    assert changes == [("occupations", {"label": "Prof."}, {"label": "professor"})]
