"""Pakkuja-marsruutimine: Gemini-töö ei puutu SFTP-d ja kirjutab .ocr atomaarselt."""
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture
def ops(tmp_path, monkeypatch):
    """reocr_ops ajutise BASE_DIR-iga; SFTP on lõks — selle kutsumine on VIGA."""
    import server.reocr_ops as reocr_ops
    (tmp_path / "w1").mkdir()
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(reocr_ops, "REOCR_BACKUPS_DIR", str(tmp_path / "backups"))
    # Varukoopiate sihtkoha register elab state/-is — isoleeri, muidu reostab tootmisolekut.
    monkeypatch.setattr(reocr_ops.reocr_state, "BACKUP_TARGETS_DIR",
                        str(tmp_path / "targets"))
    monkeypatch.setattr(reocr_ops, "_persist_active_jobs", lambda: None)
    monkeypatch.setattr(reocr_ops, "_append_to_log", lambda *a, **kw: None)

    # Lõks loeb kutsed ÜLES, mitte ainult ei viska: poll_reocr_job mähib SFTP-osa
    # laia `except Exception`-i sisse, seega viskamine üksi ei kukutaks testi.
    sftp_kutsed = []

    def sftp_lõks(*a, **kw):
        sftp_kutsed.append(a)
        raise AssertionError("Gemini-tee EI TOHI SFTP-d avada")

    monkeypatch.setattr(reocr_ops, "_sftp_open", sftp_lõks)
    monkeypatch.setattr(reocr_ops, "_test_sftp_kutsed", sftp_kutsed, raising=False)
    reocr_ops._reocr_jobs.clear()
    reocr_ops._reocr_batch_jobs.clear()
    yield reocr_ops
    # Registrid on mooduli-globaalid — koristame ka LÕPUS, et jäänuk ei rändaks
    # teistesse testifailidesse (poll-singletonid jooksevad kogu seansi).
    reocr_ops._reocr_jobs.clear()
    reocr_ops._reocr_batch_jobs.clear()
    reocr_ops._cancel_events.clear()
    reocr_ops._upload_threads.clear()


def _oota(tingimus, timeout=5.0):
    tähtaeg = time.time() + timeout
    while time.time() < tähtaeg:
        if tingimus():
            return True
        time.sleep(0.02)
    return False


def test_gemini_uksiktoo_kirjutab_ocr_ja_ei_ava_sftpd(ops, tmp_path, monkeypatch):
    import server.ocr_providers.gemini as gem
    monkeypatch.setattr(gem, "transcribe",
                        lambda *a, **kw: ("Mus. 1309\nAlexander I.", {"total_tokens": 5}))
    (tmp_path / "w1" / "pg1.jpg").write_bytes(b"\xff\xd8\xff")

    job_id = ops.start_reocr_job("wid", "w1", str(tmp_path / "w1" / "pg1.jpg"),
                                 page_filename="pg1.jpg", username="sa",
                                 material_type="hand", provider="gemini")

    assert _oota(lambda: ops._reocr_jobs[job_id]["status"] == "done")
    assert (tmp_path / "w1" / "pg1.ocr").read_text(encoding="utf-8") == (
        "Mus. 1309\nAlexander I.")
    assert ops._reocr_jobs[job_id]["produced_pages"] == ["pg1"]
    assert ops._reocr_jobs[job_id]["provider"] == "gemini"
    assert ops._test_sftp_kutsed == []


def test_gemini_kasutab_kasikirja_juhist_kaepideme_jargi(ops, tmp_path, monkeypatch):
    """material_type='hand' PEAB andma käsikirja juhise, mitte trükise oma."""
    import server.ocr_prompts as prompts
    import server.ocr_providers.gemini as gem
    nähtud = {}

    def salvestav_transcribe(img, instruction, **kw):
        nähtud["i"] = instruction
        return ("t", {})

    monkeypatch.setattr(gem, "transcribe", salvestav_transcribe)
    (tmp_path / "w1" / "pg1.jpg").write_bytes(b"\xff\xd8\xff")

    job_id = ops.start_reocr_job("wid", "w1", str(tmp_path / "w1" / "pg1.jpg"),
                                 page_filename="pg1.jpg", material_type="hand",
                                 provider="gemini")

    assert _oota(lambda: ops._reocr_jobs[job_id]["status"] in ("done", "error"))
    assert nähtud["i"] == prompts.GEMINI_HAND_INSTRUCTION


def test_gemini_viga_laheb_error_staatusesse(ops, tmp_path, monkeypatch):
    import server.ocr_providers.gemini as gem

    def kukub(*a, **kw):
        raise gem.GeminiError("HTTP 429: RESOURCE_EXHAUSTED")

    monkeypatch.setattr(gem, "transcribe", kukub)
    (tmp_path / "w1" / "pg1.jpg").write_bytes(b"\xff\xd8\xff")

    job_id = ops.start_reocr_job("wid", "w1", str(tmp_path / "w1" / "pg1.jpg"),
                                 page_filename="pg1.jpg", provider="gemini")

    assert _oota(lambda: ops._reocr_jobs[job_id]["status"] == "error")
    assert "RESOURCE_EXHAUSTED" in ops._reocr_jobs[job_id]["error"]
    assert not (tmp_path / "w1" / "pg1.ocr").exists()


def test_poll_ei_ava_sftpd_gemini_tool(ops, tmp_path, monkeypatch):
    """poll_reocr_job peab Gemini-tööl kohe tagastama, mitte kaugfaili küsima."""
    ops._reocr_jobs["j1"] = {"provider": "gemini", "status": "processing",
                             "text": None, "error": None, "slug": "w1"}
    tulemus = ops.poll_reocr_job("j1")          # _sftp_open on lõks
    assert tulemus["status"] == "processing"
    assert ops._test_sftp_kutsed == []


def test_batch_poll_ei_ava_sftpd_gemini_tool(ops):
    """_poll_batch_job on Gemini-tööl no-op: ei SFTP-d ega olekumuutust."""
    lehed = [{"page_filename": "pg1.jpg", "stem": "pg1",
              "status": "processing", "error": None}]
    ops._reocr_batch_jobs["b1"] = {"kind": "batch", "provider": "gemini",
                                   "status": "processing", "work_id": "wid",
                                   "slug": "w1", "pages": lehed, "started_at": 0}

    ops._poll_batch_job("b1")                   # ei tohi visata

    töö = ops._reocr_batch_jobs["b1"]
    assert töö["status"] == "processing"
    assert töö["pages"] == [{"page_filename": "pg1.jpg", "stem": "pg1",
                             "status": "processing", "error": None}]


def test_build_reocr_status_naitab_aktiivse_pakkuja(ops, tmp_path):
    ops._reocr_batch_jobs["b1"] = {
        "kind": "batch", "provider": "gemini", "status": "processing",
        "work_id": "wid", "slug": "w1", "started_at": 1,
        "pages": [{"page_filename": "pg1.jpg", "stem": "pg1",
                   "status": "processing", "error": None}],
    }
    seis = ops.build_reocr_status("wid", str(tmp_path / "w1"))
    assert seis["active_provider"] == "gemini"


def test_katkestamine_kirjutamise_ajal_ei_jata_vahepealset_seisu(ops, tmp_path, monkeypatch):
    """Leht on kas produced_pages-is või .ocr on puutumata. Kolmandat ei ole."""
    import server.ocr_providers.gemini as gem
    väljas = threading.Event()

    def aeglane(*a, **kw):
        väljas.set()
        time.sleep(0.3)
        return ("uus tekst", {})

    monkeypatch.setattr(gem, "transcribe", aeglane)
    (tmp_path / "w1" / "pg1.jpg").write_bytes(b"\xff\xd8\xff")
    (tmp_path / "w1" / "pg1.ocr").write_text("VANA TULEMUS", encoding="utf-8")

    job_id = ops.start_reocr_job("wid", "w1", str(tmp_path / "w1" / "pg1.jpg"),
                                 page_filename="pg1.jpg", provider="gemini")
    assert väljas.wait(2)
    ops._cancel_event(job_id).set()
    with ops._reocr_jobs_lock:
        ops._reocr_jobs[job_id]["status"] = "cancelling"

    assert _oota(lambda: not ops._upload_threads[job_id].is_alive())
    töö = ops._reocr_jobs[job_id]
    kirjas = "pg1" in töö.get("produced_pages", [])
    sisu = (tmp_path / "w1" / "pg1.ocr").read_text(encoding="utf-8")
    # Kas töö omab lehte (siis on uus sisu ja ADR 0018 koristus taastab varukoopia),
    # või ta ei puutunud seda üldse (siis on vana sisu alles).
    assert kirjas or sisu == "VANA TULEMUS"


def test_build_reocr_status_vana_kirje_on_loss(ops, tmp_path):
    """Enne pakkuja-dimensiooni salvestatud kirjel puudub `provider` — see on LOSS."""
    ops._reocr_batch_jobs["b0"] = {
        "kind": "batch", "status": "processing", "work_id": "wid", "slug": "w1",
        "started_at": 1,
        "pages": [{"page_filename": "pg1.jpg", "stem": "pg1",
                   "status": "processing", "error": None}],
    }
    seis = ops.build_reocr_status("wid", str(tmp_path / "w1"))
    assert seis["active_provider"] == "loss"


def test_katkestamine_semafori_ootel_ei_jaa_kinni(ops, tmp_path, monkeypatch):
    """Täis semafori taga ootav töö PEAB katkestuslipule reageerima.

    `Semaphore.acquire()` ilma timeout'ita ei ole katkestatav: 5. töö
    (MAX_INFLIGHT=4) ootaks vabanevat slotti, `_quiesce_upload` 30 s aeguks ja
    töö jääks `cancelling` olekusse ilma koristuseta (ADR 0018).
    """
    import server.ocr_providers.gemini as gem
    monkeypatch.setattr(ops, "_GEMINI_SEMAPHORE", threading.Semaphore(1))
    monkeypatch.setattr(ops, "_GEMINI_SLOT_POLL", 0.02)
    ops._GEMINI_SEMAPHORE.acquire()          # ainus slot hõivatud ega vabane
    (tmp_path / "w1" / "pg1.jpg").write_bytes(b"\xff\xd8\xff")

    def ei_tohi_kutsuda(*a, **kw):
        raise AssertionError("transcribe ei tohi katkestatud tööl käivituda")

    monkeypatch.setattr(gem, "transcribe", ei_tohi_kutsuda)

    katkesta = threading.Event()
    tulemus = {}

    def töö():
        tulemus["v"] = ops._gemini_transcribe_page(
            str(tmp_path / "w1" / "pg1.jpg"), "print", katkesta.is_set)

    t = threading.Thread(target=töö, daemon=True)
    t.start()
    time.sleep(0.1)
    assert t.is_alive(), "test on vigane: lõim ei jõudnud semaforile ootama"

    katkesta.set()
    t.join(2)
    assert not t.is_alive(), "katkestuslipp ei vabastanud semafori ootajat"
    assert tulemus["v"] is None


def test_gemini_batch_vigane_leht_on_edenemine(ops, tmp_path, monkeypatch):
    """ADR 0025: ebaõnnestunud leht on LAHENDATUD, mitte ootel.

    Leht 1 kukub, leht 2 õnnestub. Vea kirjapanek PEAB uuendama
    `last_progress_at`-i — muidu loeb seisaku-tuvastus vigase lehe „ei edene"
    ja lööb valehäire. Kontroll toimub ENNE lehe 2 lõppu, muidu maskeeriks
    õnnestunud lehe ajatempel puuduva vea-ajatempli.
    """
    import server.ocr_providers.gemini as gem
    (tmp_path / "w1" / "pg1.jpg").write_bytes(b"\xff\xd8\xffA")
    (tmp_path / "w1" / "pg2.jpg").write_bytes(b"\xff\xd8\xffB")

    luba_kukkuda = threading.Event()
    teine_alustas = threading.Event()
    lase_teine_lopetada = threading.Event()

    def transcribe(image_bytes, instruction, **kw):
        if image_bytes.endswith(b"A"):
            assert luba_kukkuda.wait(5)
            raise gem.GeminiError("HTTP 500: INTERNAL")
        teine_alustas.set()
        assert lase_teine_lopetada.wait(5)
        return ("teise lehe tekst", {})

    monkeypatch.setattr(gem, "transcribe", transcribe)

    job_id = ops.start_reocr_batch("wid", "w1", str(tmp_path / "w1"),
                                   [("pg1.jpg", 1), ("pg2.jpg", 2)],
                                   material_type="print", username="sa",
                                   provider="gemini")
    algne_progress = ops._reocr_batch_jobs[job_id]["last_progress_at"]
    luba_kukkuda.set()

    assert teine_alustas.wait(5)
    töö = ops._reocr_batch_jobs[job_id]
    lehed = {e["page_filename"]: e for e in töö["pages"]}
    assert lehed["pg1.jpg"]["status"] == "error"
    assert "INTERNAL" in lehed["pg1.jpg"]["error"]
    assert töö["last_progress_at"] > algne_progress, (
        "vigane leht ei uuendanud last_progress_at-i")

    lase_teine_lopetada.set()
    assert _oota(lambda: ops._reocr_batch_jobs[job_id]["status"] == "done")

    töö = ops._reocr_batch_jobs[job_id]
    lehed = {e["page_filename"]: e for e in töö["pages"]}
    assert lehed["pg1.jpg"]["status"] == "error"
    assert lehed["pg2.jpg"]["status"] == "ready"
    assert töö["produced_pages"] == ["pg2"]
    assert (tmp_path / "w1" / "pg2.ocr").read_text(encoding="utf-8") == "teise lehe tekst"
    assert not (tmp_path / "w1" / "pg1.ocr").exists()
    assert ops._test_sftp_kutsed == []


def test_commit_kirjutus_ja_omand_on_UHE_luku_all(ops, tmp_path, monkeypatch):
    """`_gemini_commit_page` kriitiline sektsioon peab katkestamise VÄLJA lukustama.

    `_write_ocr_file` varundab olemasoleva .ocr enne ülekirjutamist, seega
    „kirjuta, siis vajadusel kustuta" EI OLE tagasipööramine. Kui kirjutus ja
    omandi registreerimine käiksid eri lukuvõttudega, saaks katkestamine maanduda
    nende vahele: fail on üle kirjutatud, aga `produced_pages` on tühi → ADR 0018
    koristus ei kustuta midagi ega taasta varukoopiat.

    Test hoiab lõime KINNI kirjutuse SEES ja nõuab, et `_try_begin_cancel` ei
    jõuaks enne läbi, kui kirjutus + omand on mõlemad tehtud.
    """
    import server.ocr_providers.gemini as gem
    monkeypatch.setattr(gem, "transcribe", lambda *a, **kw: ("UUS TEKST", {}))
    (tmp_path / "w1" / "pg1.jpg").write_bytes(b"\xff\xd8\xff")
    (tmp_path / "w1" / "pg1.ocr").write_text("VANA TULEMUS", encoding="utf-8")

    kirjutamises = threading.Event()
    lase_edasi = threading.Event()
    paris_write = ops._write_ocr_file

    def aeglane_write(slug, page_filename, text, job_id):
        kirjutamises.set()
        assert lase_edasi.wait(5)
        return paris_write(slug, page_filename, text, job_id)

    monkeypatch.setattr(ops, "_write_ocr_file", aeglane_write)

    job_id = ops.start_reocr_job("wid", "w1", str(tmp_path / "w1" / "pg1.jpg"),
                                 page_filename="pg1.jpg", provider="gemini")
    assert kirjutamises.wait(5)

    katkestus = {}

    def katkesta():
        katkestus["registry"] = ops._try_begin_cancel(job_id)

    t = threading.Thread(target=katkesta, daemon=True)
    t.start()
    t.join(0.3)
    assert t.is_alive(), (
        "_try_begin_cancel jõudis läbi keset .ocr kirjutust — "
        "kirjutus ja omand ei ole sama luku all")

    lase_edasi.set()
    t.join(5)
    assert not t.is_alive()

    assert _oota(lambda: not ops._upload_threads[job_id].is_alive())
    töö = ops._reocr_jobs[job_id]
    # Kirjutus ja omand on kooskõlas: fail on uus JA töö tunnistab lehe omaks.
    assert töö.get("produced_pages") == ["pg1"]
    assert (tmp_path / "w1" / "pg1.ocr").read_text(encoding="utf-8") == "UUS TEKST"


def test_gemini_batch_ei_finaliseeru_kui_katkestus_jouab_vahele(ops, tmp_path, monkeypatch):
    """I3: kui `cancelling` jõuab sisse commiti JA lõpuploki lukustuse vahele,
    ei tohi lõuguplokk tööd `done`-ks viia ega `_drop_backups`-i kutsuda — muidu
    kustutaks järgnev `cancel_reocr_job` uued .ocr-id JA leiaks varukoopiate
    kausta juba kustutatuna (0 taastatud, tulemus jäädavalt kadunud)."""
    import server.ocr_providers.gemini as gem
    (tmp_path / "w1" / "pg1.jpg").write_bytes(b"\xff\xd8\xff")

    lase_transkribeerida = threading.Event()

    def transcribe(image_bytes, instruction, **kw):
        assert lase_transkribeerida.wait(5)
        return ("UUS TEKST", {})

    monkeypatch.setattr(gem, "transcribe", transcribe)

    drop_kutsed = []
    monkeypatch.setattr(ops, "_drop_backups", lambda job_id: drop_kutsed.append(job_id))

    def persist_simuleerib_katkestust():
        # `_persist_active_jobs()` kutse asub REAALSES koodis luku VÄLJAS —
        # siin simuleerime, et katkestaja jõuab täpselt sellel hetkel lukku
        # ja seab staatuse `cancelling`-uks, enne kui lõpuplokk selle lukustab.
        töö = ops._reocr_batch_jobs.get(job_id.get("v"))
        if töö:
            töö["status"] = "cancelling"

    monkeypatch.setattr(ops, "_persist_active_jobs", persist_simuleerib_katkestust)

    job_id = {}
    job_id["v"] = ops.start_reocr_batch("wid", "w1", str(tmp_path / "w1"),
                                        [("pg1.jpg", 1)], provider="gemini")
    lase_transkribeerida.set()

    assert _oota(lambda: not ops._upload_threads[job_id["v"]].is_alive())

    töö = ops._reocr_batch_jobs[job_id["v"]]
    assert töö["status"] == "cancelling", (
        "lõpuplokk viis töö done-ks, kuigi vahepeal saabus cancelling")
    assert drop_kutsed == [], "_drop_backups kutsuti, kuigi töö ei olnud enam processing"


def test_restart_margib_gemini_batchi_lehed_veaks(ops):
    """Restart lõpetab Gemini-töö — ka LEHE-kirjed, mitte ainult töö staatuse.

    `build_reocr_status` per-lehe silmus EI ole `is_active` taga: `processing`-usse
    jäänud leht näitaks Manage'is „OCR töötab" kuni 24 h TTL-ini, ilma aktiivse
    tööta ja ilma katkestamisnuputa, samal ajal kui töö-tasandi viga jääks
    nähtamatuks.
    """
    töö = {"kind": "batch", "provider": "gemini", "status": "processing",
           "work_id": "wid", "slug": "w1", "started_at": 1,
           "pages": [{"page_filename": "pg1.jpg", "status": "ready", "error": None},
                     {"page_filename": "pg2.jpg", "status": "processing", "error": None},
                     {"page_filename": "pg3.jpg", "status": "uploading", "error": None}]}

    assert ops._revive_dead_uploads({"b1": töö}) == 1

    assert töö["status"] == "error"
    assert töö["finished_at"]                       # TTL vajab lõpuaega
    seisud = [e["status"] for e in töö["pages"]]
    assert seisud == ["ready", "error", "error"]    # valmis leht jääb puutumata
    assert all(e["error"] == ops._RESTART_ERROR
               for e in töö["pages"] if e["status"] == "error")


def test_loss_toid_ei_laeta_kui_upload_on_valjas(ops, monkeypatch):
    """UPLOAD_ENABLED=False + Gemini sees: LOSSi töid EI TOHI mällu laadida.

    Nende ainus edasine tee on SFTP — `_finish_interrupted_cancellations` avaks
    ühenduse sünkroonselt lifespan'is (#181) ja poll-singletonid koputaksid
    kaugserverile iga 10 s, konfiguratsioonis, kus upload on teadlikult väljas.
    """
    monkeypatch.setattr(ops, "UPLOAD_ENABLED", False)
    monkeypatch.setattr(ops, "gemini_enabled", lambda: True)
    monkeypatch.setattr(ops.reocr_state, "load_active_jobs", lambda: {
        "g1": {"provider": "gemini", "status": "processing", "slug": "w1"},
        "l1": {"provider": "loss", "status": "processing", "slug": "w1",
               "remote_work": "AUTO-OCR/print/l1/w1"},
        "vana": {"status": "processing", "slug": "w1",      # pre-migratsiooni kirje
                 "remote_work": "AUTO-OCR/print/vana/w1"},
        "gb1": {"kind": "batch", "provider": "gemini", "status": "processing",
                "slug": "w1", "work_id": "wid", "pages": []},
        "lb1": {"kind": "batch", "provider": "loss", "status": "processing",
                "slug": "w1", "work_id": "wid", "pages": [],
                "remote_work": "AUTO-OCR/print/lb1/w1"},
    })

    assert ops.start_reocr_background() is None      # reaper-lõime ei käivitata

    assert set(ops._reocr_jobs) == {"g1"}
    assert set(ops._reocr_batch_jobs) == {"gb1"}
    assert ops._test_sftp_kutsed == []


def test_gemini_batch_kirjutusviga_ei_tapa_toolõime(ops, tmp_path, monkeypatch):
    """`.ocr` kirjutuse OSError PEAB andma lehele `error`, mitte tapma lõime.

    Surnud lõime korral jääks batch `processing`-usse kuni 12 h absoluutlaeni.
    """
    import server.ocr_providers.gemini as gem
    (tmp_path / "w1" / "pg1.jpg").write_bytes(b"\xff\xd8\xffA")
    (tmp_path / "w1" / "pg2.jpg").write_bytes(b"\xff\xd8\xffB")
    monkeypatch.setattr(gem, "transcribe", lambda *a, **kw: ("tekst", {}))

    paris_write = ops._write_ocr_file

    def kukkuv_write(slug, page_filename, text, job_id):
        if page_filename == "pg1.jpg":
            raise OSError("No space left on device")
        return paris_write(slug, page_filename, text, job_id)

    monkeypatch.setattr(ops, "_write_ocr_file", kukkuv_write)

    job_id = ops.start_reocr_batch("wid", "w1", str(tmp_path / "w1"),
                                   [("pg1.jpg", 1), ("pg2.jpg", 2)],
                                   provider="gemini")

    assert _oota(lambda: ops._reocr_batch_jobs[job_id]["status"] == "done")
    lehed = {e["page_filename"]: e for e in ops._reocr_batch_jobs[job_id]["pages"]}
    assert lehed["pg1.jpg"]["status"] == "error"
    assert "No space left" in lehed["pg1.jpg"]["error"]
    assert lehed["pg2.jpg"]["status"] == "ready"      # järgmine leht jätkub
    assert ops._reocr_batch_jobs[job_id]["produced_pages"] == ["pg2"]
