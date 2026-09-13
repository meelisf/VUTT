"""Tekstisisese annotatsiooni ankru ja kirje lepitamine (ADR 0041).

`<annN>` täg tekstis ja kirje lehe JSON-i `text_annotations`-is on ÜKS fakt
kahes failis. Iga tekstitee, mis redaktorist läbi ei käi (re-OCR, git-taaste),
võib need lahku viia. Need testid lukustavad mõlema suuna käitumise:

  - kirje ilma ankruta → lehe kommentaariks (inimese töö ei kao)
  - ankur ilma kirjeta → täg tekstist maha (kaotusvaba, kommentaari ei ole)
  - terve paar → PUUTUMATA, `changed=False` (ADR 0012 no-op)
"""
import pytest

from server.annotation_ops import reconcile_page_annotations


def _meta(annotations=None, comments=None):
    return {
        "text_annotations": list(annotations or []),
        "comments": list(comments or []),
        "status": "Töös",
    }


def _ann(ann_id, comment="kahtlane", author="Administraator"):
    return {
        "id": ann_id,
        "comment": comment,
        "author": author,
        "created_at": "2026-09-13T16:15:01.097Z",
    }


# ── terve paar ei muutu ────────────────────────────────────────────────────

def test_terve_paar_ei_muutu():
    text = "Soræ d. 9 Martij A.o <ann2>1662</ann2>"
    meta = _meta([_ann(2)])
    uus_text, uus_meta, changed = reconcile_page_annotations(text, meta)
    assert changed is False
    assert uus_text == text
    assert uus_meta["text_annotations"] == [_ann(2)]
    assert uus_meta["comments"] == []


def test_annotatsioonideta_leht_ei_muutu():
    text = "Sorana Academia, in qua vixi."
    meta = _meta()
    uus_text, uus_meta, changed = reconcile_page_annotations(text, meta)
    assert changed is False
    assert uus_text == text


def test_puuduv_text_annotations_vali_ei_ole_viga():
    """Vana leht ilma `text_annotations` võtmeta — ei tohi KeyError'it anda."""
    text = "Sorana Academia."
    uus_text, uus_meta, changed = reconcile_page_annotations(text, {"status": "Toores"})
    assert changed is False
    assert uus_text == text


# ── kirje ilma ankruta → kommentaar ───────────────────────────────────────

def test_orb_kirje_laheb_kommentaariks():
    """re-OCR kirjutas teksti üle, <ann1> kadus, kirje jäi õhku rippuma."""
    text = "Soræ d. 9 Martij A.o <ann2>1662</ann2>"
    meta = _meta([_ann(1, "kahtlane"), _ann(2, "kahtlane!")])

    uus_text, uus_meta, changed = reconcile_page_annotations(text, meta)

    assert changed is True
    assert uus_text == text, "teksti ei tohi puutuda — <ann2> on terve"
    assert [a["id"] for a in uus_meta["text_annotations"]] == [2]

    assert len(uus_meta["comments"]) == 1
    kommentaar = uus_meta["comments"][0]
    assert "kahtlane" in kommentaar["text"]
    assert kommentaar["author"] == "Administraator", "autor säilib"
    assert kommentaar["created_at"] == "2026-09-13T16:15:01.097Z", "aeg säilib"
    assert kommentaar["id"], "kommentaar vajab id-d (frontend kasutab võtmena)"


def test_orb_kirje_kommentaar_ytleb_pohjuse_valja():
    """Kommentaari tekst peab ütlema, et tegu on ankru kaotanud märkusega."""
    meta = _meta([_ann(1, "vale aastaarv")])
    _, uus_meta, _ = reconcile_page_annotations("Ilma täägita tekst", meta)
    tekst = uus_meta["comments"][0]["text"]
    assert "vale aastaarv" in tekst
    assert "tekstisisene" in tekst.lower()


def test_orb_kirje_lisatakse_olemasolevate_kommentaaride_lõppu():
    olemas = {"id": "1", "text": "vana", "author": "X", "created_at": "2026-01-01T00:00:00Z"}
    meta = _meta([_ann(1)], [olemas])
    _, uus_meta, _ = reconcile_page_annotations("tekst", meta)
    assert len(uus_meta["comments"]) == 2
    assert uus_meta["comments"][0] == olemas


def test_mitu_orbu_kirjet_saavad_eri_id():
    meta = _meta([_ann(1, "esimene"), _ann(2, "teine")])
    _, uus_meta, _ = reconcile_page_annotations("tekst ilma täägita", meta)
    assert uus_meta["text_annotations"] == []
    idd = [c["id"] for c in uus_meta["comments"]]
    assert len(set(idd)) == 2, "sama id kaks kommentaari → React-võti kordub"


def test_tyhja_kommentaariga_orb_kirje_kustub_jäljetult():
    """Ilma sisuta märkust ei ole mõtet kommentaariks teha."""
    meta = _meta([_ann(1, "")])
    _, uus_meta, changed = reconcile_page_annotations("tekst", meta)
    assert changed is True
    assert uus_meta["text_annotations"] == []
    assert uus_meta["comments"] == []


# ── ankur ilma kirjeta → täg maha ─────────────────────────────────────────

def test_orb_ankur_eemaldatakse_tekstist():
    text = "Ein Brief von <ann3>Kuusalu</ann3> an den Helfer."
    meta = _meta()
    uus_text, uus_meta, changed = reconcile_page_annotations(text, meta)
    assert changed is True
    assert uus_text == "Ein Brief von Kuusalu an den Helfer.", "sisu jääb, täg kaob"
    assert uus_meta["text_annotations"] == []


def test_orb_ankur_ei_puuduta_tervet_ankrut():
    text = "<ann1>Kuusalu</ann1> ja <ann5>Robo</ann5>"
    meta = _meta([_ann(1, "koht")])
    uus_text, _, changed = reconcile_page_annotations(text, meta)
    assert changed is True
    assert uus_text == "<ann1>Kuusalu</ann1> ja Robo"


def test_kahekohaline_ankru_id_ei_aja_segi_ykskohalisega():
    """`<ann1>` regex ei tohi tabada `<ann14>`-t — see oli k9omnw juhtum."""
    text = "<ann1>a</ann1> <ann14>b</ann14>"
    meta = _meta([_ann(14, "neljateistkümnes")])
    uus_text, _, _ = reconcile_page_annotations(text, meta)
    assert uus_text == "a <ann14>b</ann14>"


def test_molemad_suunad_korraga():
    text = "<ann1>siin</ann1> ja <ann9>seal</ann9>"
    meta = _meta([_ann(1, "hea"), _ann(4, "orb")])
    uus_text, uus_meta, changed = reconcile_page_annotations(text, meta)
    assert changed is True
    assert uus_text == "<ann1>siin</ann1> ja seal"
    assert [a["id"] for a in uus_meta["text_annotations"]] == [1]
    assert len(uus_meta["comments"]) == 1


# ── sisendit ei mutateerita ───────────────────────────────────────────────

def test_sisendi_meta_jääb_puutumata():
    """Kutsuja võib algset metat veel vajada (nt logimiseks) — ära mutateeri."""
    meta = _meta([_ann(1)])
    algne = [dict(a) for a in meta["text_annotations"]]
    reconcile_page_annotations("tekst", meta)
    assert meta["text_annotations"] == algne
    assert meta["comments"] == []


@pytest.mark.parametrize("vigane", [None, "string", 42, [{"no_id": 1}]])
def test_vigane_annotatsioonide_vali_ei_kukuta(vigane):
    """Kettal võib olla mida iganes — reconcile ei tohi olla kukkumiskoht."""
    meta = {"text_annotations": vigane, "comments": []}
    uus_text, _, _ = reconcile_page_annotations("tekst <ann2>x</ann2>", meta)
    assert isinstance(uus_text, str)


# ══════════════════════════════════════════════════════════════════════════
# GIT-TAASTE: tekst ühest commitist, kirjed teisest
# ══════════════════════════════════════════════════════════════════════════

import json as _json

from server.annotation_ops import apply_restored_annotations


def test_taaste_votab_kirjed_sama_commiti_jsonist():
    """Taastatud tekstiga peavad kaasa tulema selle commiti kirjed."""
    page_json = {"status": "Töös", "comments": [],
                 "text_annotations": [_ann(9, "praegune")]}
    restored_json = _json.dumps({"text_annotations": [_ann(3, "tollane")]})

    text, uus, changed = apply_restored_annotations(
        "Brief von <ann3>Kuusalu</ann3>", restored_json, page_json
    )

    assert changed is True
    assert [a["id"] for a in uus["text_annotations"]] == [3]
    assert uus["text_annotations"][0]["comment"] == "tollane"


def test_taaste_leiab_kirjed_ka_meta_content_wrapperi_seest():
    """Vana lehe JSON kannab kirjeid `meta_content` all.

    Ilma wrapperi-tundmiseta luges taaste `text_annotations` puuduvaks ja
    PÜHKIS kirjed ära, jättes tekstis ankrud orvuks — siit tuli tootmises
    23 kirjeta ankrut 8 lehel (mõõdetud 2026-09-13).
    """
    page_json = {"meta_content": {"status": "Töös", "comments": [],
                                  "text_annotations": []}}
    restored_json = _json.dumps(
        {"meta_content": {"text_annotations": [_ann(3, "Kuusalu")]}}
    )

    text, uus, changed = apply_restored_annotations(
        "Brief von <ann3>Kuusalu</ann3>", restored_json, page_json
    )

    assert changed is True
    assert "meta_content" in uus, "wrapper peab säilima"
    assert [a["id"] for a in uus["meta_content"]["text_annotations"]] == [3]
    assert text == "Brief von <ann3>Kuusalu</ann3>", "ankrut ei tohi maha võtta"


def test_taaste_ilma_commiti_jsonita_hoiab_praeguseid_kirjeid():
    """JSON-i tollal ei olnud → praegused kirjed jäävad, lepitus korrastab."""
    page_json = {"comments": [], "text_annotations": [_ann(3, "alles")]}

    text, uus, changed = apply_restored_annotations(
        "Brief von <ann3>Kuusalu</ann3>", None, page_json
    )

    assert changed is False
    assert [a["id"] for a in uus["text_annotations"]] == [3]


def test_taaste_ankruta_tekstile_teeb_kirjest_kommentaari():
    """Vana tekst ilma ankruteta: kirjed ei kao, vaid muutuvad kommentaariks."""
    page_json = {"comments": [], "text_annotations": [_ann(1, "kahtlane")]}

    text, uus, changed = apply_restored_annotations(
        "Tekst ilma ühegi ankruta", None, page_json
    )

    assert changed is True
    assert uus["text_annotations"] == []
    assert "kahtlane" in uus["comments"][0]["text"]


def test_taaste_katkine_commiti_json_ei_puhi_kirjeid():
    """Loetamatu ajalooline JSON ei tohi tähendada kirjete kadu."""
    page_json = {"comments": [], "text_annotations": [_ann(3, "alles")]}

    text, uus, changed = apply_restored_annotations(
        "<ann3>x</ann3>", "{katki", page_json
    )

    assert [a["id"] for a in uus["text_annotations"]] == [3]


def test_taaste_lepitab_ka_taastatud_kirjete_vastu():
    """Taastatud kirjed ja taastatud tekst võivad ka omavahel lahkneda."""
    page_json = {"comments": [], "text_annotations": []}
    restored_json = _json.dumps({"text_annotations": [_ann(1, "puudub tekstis")]})

    text, uus, changed = apply_restored_annotations(
        "Tekst <ann5>ankruga</ann5> ilma kirjeta", restored_json, page_json
    )

    assert changed is True
    assert uus["text_annotations"] == []
    assert "puudub tekstis" in uus["comments"][0]["text"]
    assert text == "Tekst ankruga ilma kirjeta"
