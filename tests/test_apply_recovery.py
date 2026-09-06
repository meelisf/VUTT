"""Rippuv `applying` taastatakse käivitusel (#256).

`start_apply` teeb CAS-i ja käivitab taustalõime. Konteineri restart tapab
lõime, `apply_and_transfer` except-haru ei jõua kunagi tööle — upload jääb
IGAVESEKS `applying` olekusse ja kasutaja näeb „OCR server töötleb…". Nii
juhtus tootmises 2026-08-24 deploy ajal; ainus väljapääs oli käsitsi
`state.json` parandamine.

Otsus sünnib LOKAALSEST state'ist, mitte kaugkataloogist: `page_map` ja
`applied_done` kirjutatakse iga avaldatud lehe kohta (ADR 0030). SSH käivitusel
on see, mis 2026-06-13 event-loopi kinni külmutas.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _plan(lehti=3, **prepress_extra):
    from server.upload import prepress_plan
    plan = prepress_plan.default_plan(lehti)
    plan.update(prepress_extra)
    return plan


def test_avaldamata_apply_laheb_awaiting_split_tagasi(make_upload, backend_env):
    """Ükski leht ei jõudnud välja → kasutaja saab „Rakenda" uuesti vajutada.

    Plaan ja eelvaade on state'is alles; see on täpselt see, mida tootmises
    käsitsi tehti.
    """
    from server.upload import state as upload_state, apply_recovery

    make_upload("upl1", status="applying", expected_pages=6)
    upload_state.set_upload_state("upl1", prepress=_plan(3))

    apply_recovery.taasta_rippuvad_applyd()

    s = upload_state.read_state("upl1")
    assert s["status"] == "awaiting_split"


def test_awaiting_split_taastab_expected_pages_lahtearvule(make_upload):
    """`try_begin_applying` kirjutas selle üle VÄLJUND-lehtede arvuga.

    `expected_pages` kannab ÜHTE tähendust staatuse kaupa: `awaiting_split` →
    lähte-lehtede arv. Kui taaste staatuse tagasi viib, aga arvu ei taasta,
    arvutaks järgmine apply väljundarvu VÄLJUNDARVUST — kahekordne teisendus,
    mida ükski veateade ei näita.
    """
    from server.upload import state as upload_state, apply_recovery

    make_upload("upl2", status="applying", expected_pages=6)   # 3 lähtelehte → 6 väljundit
    upload_state.set_upload_state("upl2", prepress=_plan(3))

    apply_recovery.taasta_rippuvad_applyd()

    assert upload_state.read_state("upl2")["expected_pages"] == 3


def test_pooleli_jaanud_partii_laheb_veaks(make_upload):
    """Osa lehti JÕUDIS välja → `error`, mitte vaikne edasiminek.

    Poolik partii ei tohi „valmis" paista: OCR-server näeks vähem lehti kui
    teoses on ja lehed nihkuksid. Kasutaja peab otsustama.
    """
    from server.upload import state as upload_state, apply_recovery

    make_upload("upl3", status="applying", expected_pages=6)
    upload_state.set_upload_state(
        "upl3", prepress=_plan(3, applied_done=2, page_map={"1": [1, 2], "2": [3, 4]}))

    apply_recovery.taasta_rippuvad_applyd()

    s = upload_state.read_state("upl3")
    assert s["status"] == "error"
    assert "4" in (s.get("error_message") or ""), (
        "teade peab ütlema, mitu lehte välja läks: {!r}".format(s.get("error_message")))


def test_teisi_staatusi_ei_puututa(make_upload):
    """Taaste tohib puutuda AINULT `applying`-ut.

    `processing` tähendab, et partii on kohal ja OCR-server töötab — teda
    lähtestades kaotaks kasutaja valmis töö.
    """
    from server.upload import state as upload_state, apply_recovery

    for uid, staatus in (("a", "processing"), ("b", "reviewing"), ("c", "awaiting_split")):
        make_upload(uid, status=staatus, expected_pages=6)
        upload_state.set_upload_state(uid, prepress=_plan(3))

    apply_recovery.taasta_rippuvad_applyd()

    for uid, staatus in (("a", "processing"), ("b", "reviewing"), ("c", "awaiting_split")):
        s = upload_state.read_state(uid)
        assert s["status"] == staatus
        assert s["expected_pages"] == 6, "puutumata upload'i expected_pages ei tohi muutuda"


def test_katkine_state_ei_tapa_taastet(make_upload, backend_env):
    """Üks vigane kirje ei tohi jätta ülejäänuid taastamata.

    Taaste jookseb daemon-lõimes: sinna lekkinud erand kaob logisse ja KÕIK
    hilisemad uploadid jäävad rippu, ilma et keegi seda märkaks.
    """
    from server.upload import state as upload_state, apply_recovery

    katkine = backend_env["uploads_dir"] / "katki"
    katkine.mkdir(parents=True, exist_ok=True)
    (katkine / "state.json").write_text("{ see ei ole json", encoding="utf-8")

    make_upload("upl4", status="applying", expected_pages=6)
    upload_state.set_upload_state("upl4", prepress=_plan(3))

    apply_recovery.taasta_rippuvad_applyd()

    assert upload_state.read_state("upl4")["status"] == "awaiting_split"
