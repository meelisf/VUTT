"""TS-register (src/markup/vuttTags.ts) == Pythoni register (ADR 0071).

TS-fail kannab registrit RANGE JSON-plokina markerite vahel, et seda saaks
siin lugeda ilma TS-i käivitamata.
"""
import json
import os
import re

from server.vutt_tags import VUTT_TAG_REGISTRY

TS = os.path.join(os.path.dirname(__file__), "..", "src", "markup", "vuttTags.ts")
CAMEL = {"page_mark": "pageMark", "marginalia_inline": "marginaliaInline",
         "strip_empty": "stripEmpty", "clean_markup": "cleanMarkup", "wrap_block": "wrapBlock"}


def _ts_registry():
    src = open(TS, encoding="utf-8").read()
    m = re.search(r"// REGISTRY-START\n(.*?)\n// REGISTRY-END", src, re.S)
    assert m, "REGISTRY-START/END markerid puuduvad"
    return json.loads(m.group(1))


def test_ts_ja_python_register_kattuvad():
    ts = _ts_registry()
    py = [{CAMEL.get(k, k): v for k, v in t.__dict__.items()} for t in VUTT_TAG_REGISTRY]
    assert ts == py
