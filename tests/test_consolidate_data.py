"""
Testid scripts/1-1_consolidate_data.py funktsioonide jaoks.

Eelkõige testib get_collection_hierarchy — mille viga põhjustas tühja
collections_hierarchy välja Meilisearchis (regressiooniviga: STATE_DIR vs CONFIG_DIR).
"""
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

# Laeb skripti moodulina (ei ole package, kasutame importlib)
_script_path = PROJECT_ROOT / "scripts" / "1-1_consolidate_data.py"


def _load_script(monkeypatch, data_root: str):
    """Laeb 1-1_consolidate_data.py etteantud VUTT_DATA_DIR-iga."""
    monkeypatch.setenv("VUTT_DATA_DIR", data_root)
    spec = importlib.util.spec_from_file_location("consolidate_data", _script_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# --- get_collection_hierarchy üksiktestid ---

class TestGetCollectionHierarchy:
    def _fn(self):
        spec = importlib.util.spec_from_file_location("consolidate_data", _script_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.get_collection_hierarchy

    def setup_method(self):
        self.fn = self._fn()

    def test_no_parent_returns_self(self):
        cols = {"matusetrykised": {"name": {"et": "Matuseid"}}}
        assert self.fn(cols, ["matusetrykised"]) == ["matusetrykised"]

    def test_no_parent_string_input(self):
        cols = {"matusetrykised": {"name": {"et": "Matuseid"}}}
        assert self.fn(cols, "matusetrykised") == ["matusetrykised"]

    def test_child_includes_parent(self):
        cols = {
            "parent": {"name": {"et": "Vanem"}},
            "child": {"name": {"et": "Laps"}, "parent": "parent"},
        }
        result = self.fn(cols, ["child"])
        assert "child" in result
        assert "parent" in result

    def test_grandchild_includes_full_chain(self):
        cols = {
            "root": {"name": {"et": "Juur"}},
            "mid": {"name": {"et": "Kesk"}, "parent": "root"},
            "leaf": {"name": {"et": "Leht"}, "parent": "mid"},
        }
        result = self.fn(cols, ["leaf"])
        assert result == ["leaf", "mid", "root"]

    def test_multiple_collections_merged(self):
        cols = {
            "a": {"name": {"et": "A"}},
            "b": {"name": {"et": "B"}, "parent": "a"},
            "c": {"name": {"et": "C"}},
        }
        result = self.fn(cols, ["b", "c"])
        assert set(result) == {"a", "b", "c"}

    def test_empty_collection_ids_returns_empty(self):
        cols = {"x": {"name": {"et": "X"}}}
        assert self.fn(cols, []) == []
        assert self.fn(cols, None) == []

    def test_empty_collections_returns_empty(self):
        assert self.fn({}, ["matusetrykised"]) == []

    def test_unknown_collection_id_returns_id_only(self):
        # Tundmatu ID ei tohiks crashida — tagastab selle ID kui cols pole tühi
        cols = {"other": {"name": {"et": "Muu"}}}
        result = self.fn(cols, ["unknown"])
        assert result == ["unknown"]

    def test_no_duplicates_in_result(self):
        cols = {
            "root": {"name": {"et": "Juur"}},
            "a": {"name": {"et": "A"}, "parent": "root"},
            "b": {"name": {"et": "B"}, "parent": "root"},
        }
        result = self.fn(cols, ["a", "b"])
        assert result.count("root") == 1


# --- Integratsioonitest: CONFIG_DIR peab tulema DATA_ROOT_DIR/config, mitte state/ ---

class TestConfigDirPath:
    """
    Regressioonitest: 1-1_consolidate_data.py peab lugema collections.json
    DATA_ROOT_DIR/config/-st, mitte DATA_ROOT_DIR/state/-st.

    Vana viga: STATE_DIR = DATA_ROOT_DIR/state → collections.json ei leitud Dockeris
    → load_collections() tagastas {} → collections_hierarchy = [] kõigil teostel
    → kollektsioonifiltrid ei töötanud.
    """

    def test_collections_file_uses_config_dir(self, monkeypatch, tmp_path):
        """COLLECTIONS_FILE peab viitama config/ kaustale, mitte state/ kaustale."""
        data_root = tmp_path / "data"
        config_dir = data_root / "config"
        state_dir = data_root / "state"
        config_dir.mkdir(parents=True)
        state_dir.mkdir(parents=True)

        collections_data = {
            "matusetrykised": {"name": {"et": "Matuseid"}}
        }
        # Pane collections.json ainult config/ alla (mitte state/ alla)
        (config_dir / "collections.json").write_text(
            json.dumps(collections_data), encoding="utf-8"
        )

        mod = _load_script(monkeypatch, str(data_root))

        # Kontrolli, et moodul otsib õigest kohast
        assert "config" in mod.COLLECTIONS_FILE
        assert "state" not in mod.COLLECTIONS_FILE

    def test_load_collections_reads_from_config_dir(self, monkeypatch, tmp_path):
        """load_collections() peab tagastama andmed, kui collections.json on config/ kaustas."""
        data_root = tmp_path / "data"
        config_dir = data_root / "config"
        config_dir.mkdir(parents=True)

        collections_data = {
            "matusetrykised": {"name": {"et": "Matuseid"}}
        }
        (config_dir / "collections.json").write_text(
            json.dumps(collections_data), encoding="utf-8"
        )

        mod = _load_script(monkeypatch, str(data_root))
        result = mod.load_collections()

        assert "matusetrykised" in result, (
            "load_collections() tagastas tühja dictionaryi — "
            "collections.json ei leitud. Kontrolli CONFIG_DIR teed skriptis."
        )

    def test_collections_hierarchy_not_empty_after_load(self, monkeypatch, tmp_path):
        """
        collections_hierarchy ei tohi olla [] kui teos kuulub kollektsiooni
        ja collections.json on config/ kaustas korrektne.

        Regressioonitest: vana STATE_DIR viga põhjustas tühja hierarhia.
        """
        data_root = tmp_path / "data"
        config_dir = data_root / "config"
        config_dir.mkdir(parents=True)

        collections_data = {
            "matusetrykised": {"name": {"et": "Matuseid"}}
        }
        (config_dir / "collections.json").write_text(
            json.dumps(collections_data), encoding="utf-8"
        )

        mod = _load_script(monkeypatch, str(data_root))
        collections = mod.load_collections()
        hierarchy = mod.get_collection_hierarchy(collections, ["matusetrykised"])

        assert hierarchy != [], (
            "collections_hierarchy on tühi! "
            "load_collections() ilmselt ei leidnud collections.json-i. "
            "Kontrolli CONFIG_DIR teed — peab olema DATA_ROOT_DIR/config, mitte DATA_ROOT_DIR/state."
        )
        assert "matusetrykised" in hierarchy


# --- get_labels_by_lang koos labels_store toega ---
# NB (issue #23): get_labels_by_lang, split_marginalia ja clean_text_for_search EI ole
# enam 1-1_consolidate_data.py-s defineeritud — kaardistusloogika koondati
# server/utils.py-sse ja server/meili_doc.py-sse, mida seed- ja live-tee mõlemad
# impordivad. Testid kontrollivad nüüd kanoonilist allikat.

class TestLabelsStore:
    """Kontrollib, et kanooniline get_labels_by_lang kasutab labels_store silte."""

    def test_get_labels_by_lang_uses_labels_store(self):
        from server.utils import get_labels_by_lang
        entity = {'id': 'Q999', 'label': 'Vana Silt', 'labels': {'et': 'Vana Silt'}}
        labels_store = {'Q999': {'et': 'Kanooniline Silt'}}
        result = get_labels_by_lang(entity, 'et', labels_store)
        assert result == ['Kanooniline Silt'], (
            f"labels_store-ist peaks tulema 'Kanooniline Silt', sain: {result}"
        )


# --- split_marginalia üksiktestid (kanooniline: server.meili_doc) ---

class TestSplitMarginalia:
    def _fns(self):
        from server.meili_doc import split_marginalia, clean_text_for_search
        return split_marginalia, clean_text_for_search

    def test_eraldab_ja_fraas_liitub(self):
        split_marginalia, clean = self._fns()
        text = "der Teuffel\n<m>Vide Picrium</m>\nvnd Satanas."
        main, marg = split_marginalia(text)
        assert "Teuffel vnd Satanas" in clean(main)
        assert "Vide Picrium" in marg

    def test_tyhi(self):
        split_marginalia, _ = self._fns()
        assert split_marginalia("") == ("", "")
