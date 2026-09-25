"""#455: lehe kolmesuunalise liitmise reeglid (puhas funktsioon)."""
from server.page_merge import merge_page


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


def test_molemad_muutsid_teksti_on_konflikt():
    _m, konfliktid = merge_page(_leht(), _leht(text_content="A"), _leht(text_content="B"))
    assert konfliktid == ["text"]


def test_sama_muutus_molemal_ei_ole_konflikt():
    merged, konfliktid = merge_page(_leht(), _leht(status="Valmis"), _leht(status="Valmis"))
    assert konfliktid == [] and merged["status"] == "Valmis"


def test_tekst_ja_tekstiannotatsioonid_on_uks_uksus():
    """Mina muutsin kirjet, nemad teksti → ankrud võivad lahku minna → konflikt."""
    ann = [{"id": 1, "comment": "m"}]
    base = _leht(text_annotations=ann)
    mina = _leht(text_annotations=[{"id": 1, "comment": "muudetud"}])
    nemad = _leht(text_content="teine tekst", text_annotations=ann)
    _m, konfliktid = merge_page(base, mina, nemad)
    assert konfliktid == ["text"]


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
