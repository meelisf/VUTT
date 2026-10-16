"""#455: lehe kolmesuunalise liitmise reeglid (puhas funktsioon)."""
from server.page_merge import merge_page, merge_text, text_conflict_chunks


def _c(cid, text="t", replies=None):
    return {"id": cid, "text": text, "author": "u", "replies": replies or []}


def _leht(**kw):
    leht = {"text_content": "tekst", "status": "Toores", "page_tags": [],
            "comments": [], "text_annotations": []}
    leht.update(kw)
    return leht


def test_keegi_ei_muutnud():
    base = _leht()
    merged, konfliktid = merge_page(base, _leht(), _leht())
    assert konfliktid == [] and merged == base


def test_ainult_mina_muutsin_teksti():
    merged, konfliktid = merge_page(_leht(), _leht(text_content="uus"), _leht())
    assert konfliktid == [] and merged["text_content"] == "uus"


def test_tuupjuht_mina_tekst_nemad_vastus():
    """A muutis teksti, B vastas kommentaarile — liidetakse küsimata."""
    base = _leht(comments=[_c("c1")])
    mina = _leht(text_content="uus tekst", comments=[_c("c1")])
    nemad = _leht(comments=[_c("c1", replies=[{"id": "r1", "text": "vastus"}])])
    merged, konfliktid = merge_page(base, mina, nemad)
    assert konfliktid == []
    assert merged["text_content"] == "uus tekst"
    assert merged["comments"][0]["replies"] == [{"id": "r1", "text": "vastus"}]


def test_molemad_muutsid_sama_rida_on_konflikt():
    _m, konfliktid = merge_page(_leht(), _leht(text_content="A"), _leht(text_content="B"))
    assert konfliktid == ["text"]


def test_sama_muutus_molemal_ei_ole_konflikt():
    merged, konfliktid = merge_page(_leht(), _leht(status="Valmis"), _leht(status="Valmis"))
    assert konfliktid == [] and merged["status"] == "Valmis"


def test_annotatsiooni_kirje_ja_tekst_liidetakse_eraldi():
    """#612: mina muutsin kirjet, nemad teksti (ankur alles) → mõlemad jäävad."""
    ann = [{"id": 1, "comment": "m"}]
    base = _leht(text_content="<ann1>sõna</ann1>\nteine", text_annotations=ann)
    mina = _leht(text_content=base["text_content"], text_annotations=[{"id": 1, "comment": "muudetud"}])
    nemad = _leht(text_content="<ann1>sõna</ann1>\nTEINE", text_annotations=ann)
    merged, konfliktid = merge_page(base, mina, nemad)
    assert konfliktid == []
    assert merged["text_content"] == "<ann1>sõna</ann1>\nTEINE"
    assert merged["text_annotations"] == [{"id": 1, "comment": "muudetud"}]


def test_sama_annotatsiooni_kirje_muutsid_molemad():
    tekst = "<ann1>x</ann1>"
    base = _leht(text_content=tekst, text_annotations=[{"id": 1, "comment": "a"}])
    _m, konfliktid = merge_page(base, _leht(text_content=tekst, text_annotations=[{"id": 1, "comment": "b"}]),
                                _leht(text_content=tekst, text_annotations=[{"id": 1, "comment": "c"}]))
    assert konfliktid == ["annotations:1"]


def test_liitmine_ei_tohi_ankrut_orvuks_jatta():
    """Nemad kustutasid annotatsiooni (kirje + tägid), mina tõstsin sulgeva tägi
    teisele reale → liidetud tekstis oleks kirjeta </ann1> → kokkupõrge."""
    base = _leht(text_content="<ann1>a\nb</ann1>\nc\nd", text_annotations=[{"id": 1, "comment": "x"}])
    mina = _leht(text_content="<ann1>a\nb\nc</ann1>\nd", text_annotations=[{"id": 1, "comment": "x"}])
    nemad = _leht(text_content="a\nb\nc\nd", text_annotations=[])
    _m, konfliktid = merge_page(base, mina, nemad)
    assert konfliktid == ["text"]


def test_kettal_olnud_vana_orb_ei_tee_konflikti():
    """Orb, mis oli juba sisendis, ei ole liitmise süü."""
    base = _leht(text_content="<ann9>a</ann9>\nb\nc\nd")
    mina = _leht(text_content="<ann9>a</ann9>\nB\nc\nd")
    nemad = _leht(text_content="<ann9>a</ann9>\nb\nc\nD")
    merged, konfliktid = merge_page(base, mina, nemad)
    assert konfliktid == [] and merged["text_content"] == "<ann9>a</ann9>\nB\nc\nD"


def test_staatus_ja_margksonad_eraldi():
    base = _leht()
    mina = _leht(status="Töös")
    nemad = _leht(page_tags=[{"id": "Q1", "label": "x"}])
    merged, konfliktid = merge_page(base, mina, nemad)
    assert konfliktid == []
    assert merged["status"] == "Töös" and merged["page_tags"] == [{"id": "Q1", "label": "x"}]


def test_kommentaarid_lisatud_molemalt_poolt():
    base = _leht(comments=[_c("c1")])
    mina = _leht(comments=[_c("c1"), _c("m1")])
    nemad = _leht(comments=[_c("c1"), _c("n1")])
    merged, konfliktid = merge_page(base, mina, nemad)
    assert konfliktid == []
    assert [c["id"] for c in merged["comments"]] == ["c1", "n1", "m1"]


def test_sama_kommentaari_muutsid_molemad():
    base = _leht(comments=[_c("c1", "a")])
    _m, konfliktid = merge_page(base, _leht(comments=[_c("c1", "b")]), _leht(comments=[_c("c1", "c")]))
    assert konfliktid == ["comments:c1"]


def test_mina_kustutasin_muutmata_kommentaari():
    base = _leht(comments=[_c("c1"), _c("c2")])
    merged, konfliktid = merge_page(base, _leht(comments=[_c("c1")]), base)
    assert konfliktid == [] and [c["id"] for c in merged["comments"]] == ["c1"]


def test_mina_kustutasin_kommentaari_millele_vastati():
    base = _leht(comments=[_c("c1")])
    nemad = _leht(comments=[_c("c1", replies=[{"id": "r1", "text": "v"}])])
    _m, konfliktid = merge_page(base, _leht(comments=[]), nemad)
    assert konfliktid == ["comments:c1"]


def test_nemad_kustutasid_minu_muudetud_kommentaari():
    base = _leht(comments=[_c("c1", "a")])
    _m, konfliktid = merge_page(base, _leht(comments=[_c("c1", "b")]), _leht(comments=[]))
    assert konfliktid == ["comments:c1"]


def test_nemad_kustutasid_muutmata_kommentaari():
    base = _leht(comments=[_c("c1")])
    merged, konfliktid = merge_page(base, base, _leht(comments=[]))
    assert konfliktid == [] and merged["comments"] == []


def test_eszett_meili_kujul_ei_ole_konflikt_ja_ketta_kuju_sailib():
    """Meili annab ß → ss; puutumata kommentaar peab kettale jääma ß-iga."""
    base = _leht(comments=[_c("c1", "Strasse")])        # nagu Meilist laetud
    mina = _leht(text_content="uus", comments=[_c("c1", "Strasse")])
    nemad = _leht(comments=[_c("c1", "Straße")])         # kettal
    merged, konfliktid = merge_page(base, mina, nemad)
    assert konfliktid == []
    assert merged["comments"][0]["text"] == "Straße"


def test_votmejarjekord_ei_ole_muudatus():
    base = _leht(page_tags=[{"id": "Q1", "label": "x"}])
    nemad = _leht(page_tags=[{"label": "x", "id": "Q1"}])
    merged, konfliktid = merge_page(base, _leht(status="Töös", page_tags=[{"id": "Q1", "label": "x"}]), nemad)
    assert konfliktid == []


# --- #612: tekst ridade kaupa ---

def test_eri_read_liidetakse():
    base = _leht(text_content="üks\nkaks\nkolm\nneli\nviis\n")
    mina = _leht(text_content="ÜKS\nkaks\nkolm\nneli\nviis\n")
    nemad = _leht(text_content="üks\nkaks\nkolm\nneli\nVIIS\n")
    merged, konfliktid = merge_page(base, mina, nemad)
    assert konfliktid == []
    assert merged["text_content"] == "ÜKS\nkaks\nkolm\nneli\nVIIS\n"


def test_lisamine_ja_kustutamine_eri_kohas():
    merged, tükid = merge_text("a\nb\nc\nd\ne", "a\nuus\nb\nc\nd\ne", "a\nb\nc\ne")
    assert merged == "a\nuus\nb\nc\ne"


def test_naaberread_on_kokkuporge():
    """Nagu git: kokkupuutuvad muudatused põrkuvad (ohutu pool)."""
    merged, tükid = merge_text("a\nb\nc", "A\nb\nc", "a\nB\nc")
    assert merged is None
    assert [t["kind"] for t in tükid] == ["conflict", "ok"]
    assert tükid[0] == {"kind": "conflict", "base": "a\nb\n", "mine": "A\nb\n", "theirs": "a\nB\n"}


def test_sama_rea_konflikti_tukid_katavad_kogu_teksti():
    base = "üks\nkaks\nkolm\nneli\nviis"
    merged, tükid = merge_text(base, "üks\nkaks\nKOLM\nneli\nviis", "üks\nkaks\nkolm!\nneli\nviis")
    assert merged is None
    assert tükid == [
        {"kind": "ok", "text": "üks\nkaks\n"},
        {"kind": "conflict", "base": "kolm\n", "mine": "KOLM\n", "theirs": "kolm!\n"},
        {"kind": "ok", "text": "neli\nviis"},
    ]


def test_molemad_lisasid_samasse_kohta_erineva_rea():
    merged, tükid = merge_text("a\nb", "a\nx\nb", "a\ny\nb")
    assert merged is None
    assert [t for t in tükid if t["kind"] == "conflict"] == [
        {"kind": "conflict", "base": "", "mine": "x\n", "theirs": "y\n"}]


def test_sama_muudatus_molemal_pool():
    merged, _ = merge_text("a\nb\nc", "a\nB\nc", "a\nB\nc")
    assert merged == "a\nB\nc"


def test_mitu_muudatust_uhel_poolel_nihked_oiged():
    base = "\n".join(str(i) for i in range(10))
    mina = base.replace("1\n", "1\n1b\n").replace("5\n", "")
    nemad = base.replace("8\n", "8!\n")
    merged, _ = merge_text(base, mina, nemad)
    assert merged == "0\n1\n1b\n2\n3\n4\n6\n7\n8!\n9"


def test_tuhi_baas():
    merged, _ = merge_text("", "a", "")
    assert merged == "a"
    merged, tükid = merge_text("", "a", "b")
    assert merged is None


def test_konflikti_tukid_kui_tagide_kontroll_lukkas_tagasi():
    """Ridade liitmine õnnestus, aga merge_page lükkas tagasi → üks tükk kogu tekstiga."""
    assert text_conflict_chunks("a\nb", "A\nb", "a\nB\n") == [
        {"kind": "conflict", "base": "a\nb", "mine": "A\nb", "theirs": "a\nB\n"}]
