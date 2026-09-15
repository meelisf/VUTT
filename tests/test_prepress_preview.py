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
    # `_reset_status_if_prepping` kirjutab luku all OTSE (mitte set_upload_state
    # kaudu — pesastatud lukk annaks ummikseisu), seega stub peab katma ka selle.
    monkeypatch.setattr(
        prepress.upload_state, "write_state",
        lambda i, s: state.update(status=s.get("status")),
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


def test_reset_ei_kirjuta_apply_staatust_ule(tmp_path, monkeypatch):
    """Renderdaja lähtestus peab lugema staatuse LUKU ALT, mitte enne lukku.

    `_reset_status_if_prepping` luges staatuse väljaspool lukku ja kutsus siis
    `set_upload_state`, mis kirjutab tingimusteta. Kui apply CAS
    (`prepping → applying`) mahub lugemise ja kirjutuse vahele, kirjutab
    renderdaja `awaiting_split` `applying` peale — ja siis pääseb TEINE apply
    CAS-ist läbi, kuigi esimene lõim juba jookseb (topelt-SFTP sama kaugkausta
    peale).

    Võistlust modelleerib lukk, mille võtmine flipib staatuse: enne parandust
    oli lugemine lukust VÄLJASPOOL ja nägi seega vana väärtust, pärast
    parandust luku SEES ja näeb uut. Otse kettale kirjutamine ei modelleeriks
    midagi — päris konkurent (`try_begin_applying`) võtab sama luku.

    Sama klass nagu polli vananenud hetktõmmis (ADR 0028 I1), peegelpildis.
    """
    import threading

    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(tmp_path / "uploads"))
    (tmp_path / "uploads" / "u9").mkdir(parents=True)
    upload_state.write_state("u9", {"id": "u9", "status": "prepping",
                                    "meta": {"slug": "x"}})

    class ApplyVoidabLuku:
        """Apply CAS jõudis ette: staatus on muutunud selleks ajaks, kui me luku saame."""
        def __init__(self):
            self._lk = threading.Lock()

        def __enter__(self):
            self._lk.acquire()
            s = upload_state.read_state("u9")
            s["status"] = "applying"
            upload_state.write_state("u9", s)
            return self

        def __exit__(self, *a):
            self._lk.release()
            return False

    monkeypatch.setattr(upload_state, "get_upload_lock", lambda i: ApplyVoidabLuku())

    prepress._reset_status_if_prepping("u9")

    assert upload_state.read_state("u9")["status"] == "applying", (
        "renderdaja kirjutas apply staatuse üle — teine apply pääseks CAS-ist läbi"
    )


# --- Rippuva eelvaate taaste käivitusel ---------------------------------

def _tee_upload(tmp_path, uid, status, preview_status):
    (tmp_path / "uploads" / uid).mkdir(parents=True, exist_ok=True)
    upload_state.write_state(uid, {
        "id": uid, "status": status, "meta": {"slug": "x"},
        "prepress": {"preview_status": preview_status, "preview_done": 3,
                     "pages": [], "default_split_x": 0.5},
    })


def test_taaste_vabastab_rippuva_eelvaate(tmp_path, monkeypatch):
    """Konteineri restart tapab renderduslõime — `rendering` jääb igaveseks.

    Tagajärg on viisardis LÕPLIK umbtee: `start_preview` on idempotentne ja
    väljub kohe (`preview_status == "rendering"`), nii et eelvaadet ei saa
    uuesti käivitada; „Rakenda" on samal ajal `disabled={applying || rendering}`
    taga. Kasutaja näeb külmunud edenemisnumbrit, ilma vea ja väljapääsuta.

    `cancelled`, mitte `error`: kasutaja ei teinud midagi valesti ja renderdus
    JÄTKAB pooleli kohast (`if not os.path.isfile(dst)`), seega järgmine avamine
    lihtsalt lõpetab töö ära.
    """
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(tmp_path / "uploads"))
    _tee_upload(tmp_path, "u1", "prepping", "rendering")

    prepress.taasta_rippuvad_eelvaated()

    s = upload_state.read_state("u1")
    assert s["prepress"]["preview_status"] == "cancelled"
    assert s["status"] == "awaiting_split", "peab olema jälle jätkatav"


def test_taaste_ei_puutu_valmis_eelvaadet(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(tmp_path / "uploads"))
    _tee_upload(tmp_path, "u2", "awaiting_split", "ready")

    prepress.taasta_rippuvad_eelvaated()

    s = upload_state.read_state("u2")
    assert s["prepress"]["preview_status"] == "ready"
    assert s["status"] == "awaiting_split"


def test_taaste_ei_varasta_staatust_apply_kaest(tmp_path, monkeypatch):
    """`applying` kuulub apply-lõimele ja apply_recovery-le (ADR 0028 I1).

    Eelvaate lipu tohib vabastada, elutsükli-staatust MITTE — vastasel juhul
    pääseks teine apply CAS-ist läbi.
    """
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(tmp_path / "uploads"))
    _tee_upload(tmp_path, "u3", "applying", "rendering")

    prepress.taasta_rippuvad_eelvaated()

    s = upload_state.read_state("u3")
    assert s["prepress"]["preview_status"] == "cancelled"
    assert s["status"] == "applying", "apply staatust ei tohi puutuda"
