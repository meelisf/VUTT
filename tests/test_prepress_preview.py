"""Eelvaate renderdustsükkel: edenemine ja semafori ulatus."""
import pytest

from server.upload import prepress
from server.upload import state as upload_state


class FakeSource:
    """Renderdab „lehe" ilma pdftoppm/PIL-ita ja jälgib semafori seisu."""

    def __init__(self, count, on_render):
        self._count = count
        self._on_render = on_render

    def page_count(self):
        return self._count

    def render_preview(self, n, dst):
        self._on_render(n)
        with open(dst, "wb") as f:
            f.write(b"jpg")


@pytest.fixture
def upload(tmp_path, monkeypatch):
    uid = "u1"
    base = tmp_path / uid
    base.mkdir()
    plan = {}
    state = {}
    monkeypatch.setattr(upload_state, "upload_dir", lambda i: str(base))
    monkeypatch.setattr(prepress.upload_state, "upload_dir", lambda i: str(base))
    monkeypatch.setattr(
        prepress.upload_state, "mutate_prepress",
        lambda i, fn: fn(plan),
    )
    monkeypatch.setattr(
        prepress.upload_state, "set_upload_state",
        lambda i, **kw: state.update(kw),
    )
    # Renderdaja loeb state'i kahel pool: katkestuslipu kontroll iga lehe ees
    # ja `_reset_status_if_prepping` lõpus. Stub peab peegeldama sama dikte,
    # mida ülejäänud fixture kirjutab.
    monkeypatch.setattr(
        prepress.upload_state, "read_state",
        lambda i: {"status": state.get("status", "prepping"), "prepress": plan},
    )
    monkeypatch.setattr(prepress, "source_path", lambda i: str(base / "source.pdf"))
    return uid, plan, state


def _vaba() -> bool:
    """Kas RENDER_SEMAPHORE on HETKEL vaba? Ei jäta seda kinni hoidma."""
    if prepress.RENDER_SEMAPHORE.acquire(blocking=False):
        prepress.RENDER_SEMAPHORE.release()
        return True
    return False


def test_semafor_vabaneb_lehtede_vahel(upload, monkeypatch):
    """REGRESSIOON (#219): semafor võeti varem terve eelvaate-tsükli ümber.

    Kaitse eesmärk on üks rasteriseerimine korraga — renderduse AJAL kinni,
    lehtede VAHEL vaba, muidu seisab iga teine töö kogu partii taga.
    """
    uid, plan, _state = upload
    ajal = []
    vahel = []

    def on_render(n):
        ajal.append(_vaba())

    monkeypatch.setattr(
        prepress.page_source, "open_page_source",
        lambda path: FakeSource(3, on_render),
    )
    orig_mutate = prepress.upload_state.mutate_prepress
    monkeypatch.setattr(
        prepress.upload_state, "mutate_prepress",
        lambda i, fn: (vahel.append(_vaba()), orig_mutate(i, fn))[1],
    )

    prepress._render_previews(uid)

    assert ajal == [False, False, False], "renderduse ajal peab semafor kinni olema"
    assert all(vahel), "oleku uuendamise ajal ei tohi semafori hoida"
    assert plan["preview_status"] == "ready"
    assert _vaba(), "semafor peab pärast partiid vaba olema"


def test_edenemine_on_monotoonne(upload, monkeypatch):
    """`preview_done` peab kasvama lehthaaval — see toidab edenemisriba."""
    uid, plan, state = upload
    nahtud = []

    monkeypatch.setattr(
        prepress.page_source, "open_page_source",
        lambda path: FakeSource(4, lambda n: nahtud.append(plan.get("preview_done"))),
    )
    prepress._render_previews(uid)

    assert nahtud == [0, 1, 2, 3]
    assert plan["preview_done"] == 4
    assert state["status"] == "awaiting_split"


def test_lahteallika_puudumine_ei_jata_semafori_kinni(upload, monkeypatch):
    """Vearada peab semafori vabastama — muidu külmub kogu prepress."""
    uid, plan, _state = upload
    monkeypatch.setattr(prepress, "source_path", lambda i: None)

    prepress._render_previews(uid)

    assert plan["preview_status"] == "error"
    assert _vaba()
