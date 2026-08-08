"""Re-OCR avaldab pildid OCR-serverisse aatomiliselt (#220).

OCR-serveri valvur korjab pildid rglob-iga ja filtreerib laiendi järgi;
stabiilsuskontroll (`wait_for_file_stable`) kutsutakse seal AINULT PDF-ide
peale. Poolik .jpg satuks seega OCR-i. Prepress lahendas selle
`.tmp`+rename-ga (ADR 0017); re-OCR kirjutas kaua otse sihtnimega.
"""
import pytest

from server.upload import ocr_client


class FakeSftp:
    """Salvestab put/rename järjekorra, et saaks kontrollida avaldamise mustrit."""

    def __init__(self):
        self.events = []      # ("put", tee) / ("rename", vana, uus)
        self.dirs = set()
        self.closed = False

    def put(self, local, remote, callback=None):
        self.events.append(("put", remote))

    def rename(self, src, dst):
        self.events.append(("rename", src, dst))

    def stat(self, path):
        if path not in self.dirs:
            raise FileNotFoundError(path)
        return object()

    def mkdir(self, path):
        self.dirs.add(path)

    def close(self):
        self.closed = True


# --- jagatud abiline ---

def test_publish_atomic_elab_ocr_client_is():
    """Üks teostus, mida mõlemad teed kutsuvad — mitte koopia kummalgi pool."""
    assert callable(ocr_client.publish_atomic)


def test_publish_atomic_laeb_tmp_nimega_ja_nimetab_ymber(tmp_path):
    local = tmp_path / "a.jpg"
    local.write_bytes(b"jpeg")
    sftp = FakeSftp()

    ocr_client.publish_atomic(sftp, str(local), "/remote/x_pg_001.jpg")

    assert sftp.events == [
        ("put", "/remote/x_pg_001.jpg.tmp"),
        ("rename", "/remote/x_pg_001.jpg.tmp", "/remote/x_pg_001.jpg"),
    ]


def test_prepress_kasutab_sama_teostust():
    """prepress_apply.publish_atomic peab olema SAMA objekt, mitte teine koopia."""
    from server.upload import prepress_apply

    assert prepress_apply.publish_atomic is ocr_client.publish_atomic


# --- re-OCR teed ---

def test_batch_reocr_avaldab_aatomiliselt(monkeypatch, tmp_path):
    """Partii-re-OCR: iga pilt .tmp-na üles, alles siis õigele nimele."""
    from server import reocr_ops

    sftp = FakeSftp()
    src = tmp_path / "001.jpg"
    src.write_bytes(b"jpeg")

    reocr_ops.publish_atomic(sftp, str(src), "/o/work/slug_pg_001.jpg")

    assert ("put", "/o/work/slug_pg_001.jpg.tmp") in sftp.events
    assert ("rename", "/o/work/slug_pg_001.jpg.tmp",
            "/o/work/slug_pg_001.jpg") in sftp.events
    # Otse sihtnimega ei tohi kirjutada — see on kogu mõte.
    assert ("put", "/o/work/slug_pg_001.jpg") not in sftp.events


def test_reocr_ops_ei_kasuta_enam_otse_put_i():
    """Valvur: reocr_ops ei tohi kutsuda otse sftp.put().

    Kontroll käib AST-i pealt, mitte tekstiotsinguga: docstring'id ja
    kommentaarid räägivad `sftp.put()`-ist kui probleemist, ja tekstiotsing
    langes nende peale valepositiiviga.

    Mõlemad üleslaadimisteed elavad taustalõimede sees, mida on kallis
    tervikuna käivitada — seepärast staatiline kontroll.
    """
    import ast
    import inspect

    from server import reocr_ops

    puu = ast.parse(inspect.getsource(reocr_ops))
    kutsed = [
        node for node in ast.walk(puu)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "put"
        and isinstance(node.func.value, ast.Name)
        and "sftp" in node.func.value.id.lower()
    ]
    assert not kutsed, (
        "reocr_ops kutsub otse sftp.put() ridadel {} — kasuta publish_atomic()".format(
            [n.lineno for n in kutsed]
        )
    )
