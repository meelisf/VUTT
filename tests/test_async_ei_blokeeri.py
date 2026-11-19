"""ADR 0002 valvur: teadaolevalt blokeerivaid abifunktsioone ei kutsuta otse `async def` sees.

Nimekiri on konkreetne, mitte üldine: need funktsioonid skannivad cache-missil
kogu andmekausta või hoiavad lukku, mille all käib ketta-/võrgu-I/O (N19-02).
`await run_in_threadpool(f, ...)` annab funktsiooni argumendina, mitte kutsena,
seega valvur seda ei märka.
"""
import ast
import pathlib

BLOKEERIVAD = {
    "find_directory_by_id", "_load_work_metadata", "get_cached_suggestions",
    "_resolve_work_set_ids", "search_visible_work_ids",
    "get_cached_collections", "get_cached_archives",
}

SERVER = pathlib.Path(__file__).resolve().parents[1] / "server"


def test_async_def_ei_kutsu_blokeerivat_abifunktsiooni():
    leiud = []
    for path in SERVER.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for fn in ast.walk(tree):
            if not isinstance(fn, ast.AsyncFunctionDef):
                continue
            for node in ast.walk(fn):
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                        and node.func.id in BLOKEERIVAD:
                    leiud.append(f"{path.relative_to(SERVER.parent)}:{node.lineno} {fn.name} → {node.func.id}")
    assert not leiud, "Blokeeriv kutse async def sees (kasuta run_in_threadpool):\n" + "\n".join(leiud)
