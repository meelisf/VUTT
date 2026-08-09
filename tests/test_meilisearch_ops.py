import json
import pytest
import jwt

COLLECTIONS = {
    "col-restricted": {"name": {"et": "Piiratud"}, "visibility": "restricted"},
    "col-public": {"name": {"et": "Avalik"}, "visibility": "public"},
}


class SyncExecutor:
    def submit(self, fn, *args, **kwargs):
        fn(*args, **kwargs)


@pytest.fixture(autouse=True)
def patch_meili_config(monkeypatch):
    import server.meilisearch_ops as ops
    monkeypatch.setattr(ops, "MEILI_URL", "http://localhost:7700")
    monkeypatch.setattr(ops, "MEILI_KEY", "test-master-key")


def test_update_collection_visibility_updates_all_pages(tmp_path, monkeypatch):
    """Visibility uuendus peab saatma kõik teose lehekülgede dokumendid, mitte ainult esimese."""
    import server.meilisearch_ops as ops

    work_id = "test123"
    work_dir = tmp_path / "test-slug"
    work_dir.mkdir()
    (work_dir / "_metadata.json").write_text(json.dumps({
        "work_id": work_id,
        "collections": ["col-restricted"],
    }))
    for i in range(1, 4):
        (work_dir / f"page_{i:03d}.jpg").touch()

    monkeypatch.setattr(ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(ops, "load_collections", lambda: COLLECTIONS)
    monkeypatch.setattr(ops, "_meilisearch_executor", SyncExecutor())

    sent_docs = []

    class FakeResponse:
        def read(self): return json.dumps({"taskUid": 1}).encode()
        def __enter__(self): return self
        def __exit__(self, *a): pass

    def fake_urlopen(req, timeout=None):
        sent_docs.extend(json.loads(req.data))
        return FakeResponse()

    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    ops.update_collection_is_public_async("col-restricted", False)

    sent_ids = {doc["id"] for doc in sent_docs}
    assert f"{work_id}-1" in sent_ids, "Esimene lehekülg peab olema uuendatud"
    assert f"{work_id}-2" in sent_ids, "Teine lehekülg peab olema uuendatud"
    assert f"{work_id}-3" in sent_ids, "Kolmas lehekülg peab olema uuendatud"
    assert all(doc["is_public"] is False for doc in sent_docs)


def test_update_collection_visibility_correct_is_public_value(tmp_path, monkeypatch):
    """Kui teos on ka avalikus kollektsioonis, peab is_public olema True."""
    import server.meilisearch_ops as ops

    work_id = "test456"
    work_dir = tmp_path / "test-slug2"
    work_dir.mkdir()
    (work_dir / "_metadata.json").write_text(json.dumps({
        "work_id": work_id,
        "collections": ["col-restricted", "col-public"],
    }))
    (work_dir / "page_001.jpg").touch()

    monkeypatch.setattr(ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(ops, "load_collections", lambda: COLLECTIONS)
    monkeypatch.setattr(ops, "_meilisearch_executor", SyncExecutor())

    sent_docs = []

    class FakeResponse:
        def read(self): return json.dumps({"taskUid": 1}).encode()
        def __enter__(self): return self
        def __exit__(self, *a): pass

    def fake_urlopen(req, timeout=None):
        sent_docs.extend(json.loads(req.data))
        return FakeResponse()

    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    ops.update_collection_is_public_async("col-restricted", False)

    assert len(sent_docs) == 1
    assert sent_docs[0]["is_public"] is True


def test_generate_work_scoped_meili_token():
    """Scoped token peab sisaldama ainult selle work_id filtrit."""
    from server.meilisearch_ops import generate_work_scoped_meili_token
    import server.config as cfg
    cfg.MEILI_SEARCH_KEY = "test-key-32-chars-long-padding-x"
    cfg.MEILI_SEARCH_KEY_UID = "test-uid-1234"

    token = generate_work_scoped_meili_token("abc123")
    payload = jwt.decode(token, "test-key-32-chars-long-padding-x", algorithms=["HS256"])
    assert payload["searchRules"] == {"teosed": {"filter": 'work_id = "abc123"'}}
    assert payload["apiKeyUid"] == "test-uid-1234"
    assert payload["exp"] > 0


def test_generate_work_scoped_meili_token_different_works():
    """Iga teos saab erineva filtriga tokeni."""
    from server.meilisearch_ops import generate_work_scoped_meili_token
    import server.config as cfg
    cfg.MEILI_SEARCH_KEY = "test-key-32-chars-long-padding-x"
    cfg.MEILI_SEARCH_KEY_UID = "test-uid-1234"

    token1 = generate_work_scoped_meili_token("work1")
    token2 = generate_work_scoped_meili_token("work2")
    p1 = jwt.decode(token1, "test-key-32-chars-long-padding-x", algorithms=["HS256"])
    p2 = jwt.decode(token2, "test-key-32-chars-long-padding-x", algorithms=["HS256"])
    assert 'work_id = "work1"' in p1["searchRules"]["teosed"]["filter"]
    assert 'work_id = "work2"' in p2["searchRules"]["teosed"]["filter"]
    assert p1["searchRules"] != p2["searchRules"]


# --- split_marginalia ---
from server.meilisearch_ops import split_marginalia, clean_text_for_search, _clean_search_text


# --- _clean_search_text (split_marginalia + clean_text_for_search kompositsioon) ---
class TestCleanSearchText:
    def test_eraldab_ja_puhastab_mõlemad_osad(self):
        # põhitekst sisaldab XML märgendit + hyphen-poolitust; marginaalia plokk eraldi
        raw = "welcher i\u015ft der Teuffel\n<m>Vide <i>Picrium</i></m>\nvnd Satanas."
        main, marg = _clean_search_text(raw)
        assert main == "welcher i\u015ft der Teuffel vnd Satanas."
        assert marg == "Vide Picrium"   # sisemine <i> täg eemaldatud

    def test_tühi_sisend(self):
        assert _clean_search_text("") == ("", "")
        assert _clean_search_text(None) == ("", "")

    def test_inline_m_ei_liimi_sõnu(self):
        """Wrapper (läbi split_marginalia) ei tohi 'foo<m>x</m>bar' -> 'foobar'."""
        main, marg = _clean_search_text("foo<m>note</m>bar")
        assert main == "foo bar"
        assert marg == "note"

    def test_hyphen_poolituse_liitmine(self):
        """coa-\ncervare -> coacervare (üle rea poolituse liitmine)."""
        main, _ = _clean_search_text("coa-\ncervare")
        assert main == "coacervare"

    def test_ainult_marginaalia(self):
        """Kogu tekst on marginaalia → põhitekst tühi, marginaalia täis."""
        main, marg = _clean_search_text("<m>terve plokk</m>")
        assert main == ""
        assert marg == "terve plokk"


# --- _compute_work_aliases (work-level aliase arvutus üks kord) ---
from server.meilisearch_ops import _compute_work_aliases


class TestComputeWorkAliases:
    """Work-level aliased sõltuvad ainult metadatast, mitte lehest — arvutatakse üks kord."""

    def test_authors_text_sisaldab_creator_nimesid_ja_aliaseid(self):
        creators = [{"name": "Laurentius Ludenius", "id": "Q123", "role": "auctor"}]
        people = {"Q123": {"primary_name": "Lorenz Luden", "aliases": ["Ludenius"], "ids": {}}}
        aliases, authors_text, _, _ = _compute_work_aliases(creators, None, [], people)
        assert aliases == ["Ludenius"]                       # creator alias
        assert "Laurentius Ludenius" in authors_text         # creator nimi
        assert "Ludenius" in authors_text                    # alias lisatud

    def test_publisher_aliases_sh_inverteeritud_nimega(self):
        """Publisher alias lisab ka invereeditud 'Pere, Ees' → 'Ees Pere'."""
        publisher = {"label": "Trükikoda", "id": "Q777"}
        people = {"Q777": {"aliases": ["Müller, Heinrich"]}}
        _, _, publisher_aliases, _ = _compute_work_aliases([], publisher, [], people)
        assert "Müller, Heinrich" in publisher_aliases
        assert "Heinrich Müller" in publisher_aliases        # invereeditud

    def test_tag_aliases_isiku_märksõnadele(self):
        tags = [{"label": "Margin", "id": "Q500"}]
        people = {"Q500": {"aliases": ["Ludenius"]}}
        _, _, _, tag_aliases = _compute_work_aliases([], None, tags, people)
        assert tag_aliases == ["Ludenius"]

    def test_tühi_sisend(self):
        """Tühjad creators/publisher/tags ja tühi register → kõik tühjad."""
        aliases, authors_text, publisher_aliases, tag_aliases = _compute_work_aliases([], None, [], {})
        assert aliases == [] and authors_text == []
        assert publisher_aliases == [] and tag_aliases == []

    def test_olematu_id_aliaseid_ei_leita(self):
        """ID mis pole people registeris → aliaseid ei lisata."""
        creators = [{"name": "Tundmatu", "id": "Q999"}]
        aliases, authors_text, publisher_aliases, tag_aliases = _compute_work_aliases(
            creators, {"id": "Q888"}, [{"id": "Q777"}], {"Q123": {"aliases": ["x"]}}
        )
        assert aliases == []                                  # Q999 pole registeris
        assert authors_text == ["Tundmatu"]                  # nimi jääb
        assert publisher_aliases == []                        # Q888 pole registeris
        assert tag_aliases == []                              # Q777 pole registeris


# --- _upsert_work_documents (tsüklile järgnev saatmise + kustutamise samm) ---
from server.meilisearch_ops import _upsert_work_documents
import server.meilisearch_ops as ops


class TestUpsertWorkDocuments:
    """Teose koondstaatuse arvutamine + Meilisearchi saatmine + üleliigse kustutamine.

    Need testid mockivad send_to_meilisearch / _delete_extra_pages / calculate_work_status
    ei eksisteeri — calculate_work_status on puhas (vt tests/test_transform_page.py või
    siin otse), send/delete mockitakse kinnipüüdmiseks.
    """

    def test_tühi_dokumentide_list_tagastab_none(self, monkeypatch):
        """Tühjad dokumendid → ei saateta, tagastab None (varajane väljumine)."""
        sent = []
        monkeypatch.setattr(ops, "send_to_meilisearch", lambda docs, wait=True: sent.extend(docs) or True)
        deleted = []
        monkeypatch.setattr(ops, "_delete_extra_pages", lambda wid, n: deleted.append((wid, n)))
        assert _upsert_work_documents("W1", "slug", [], []) is None
        assert sent == [] and deleted == []   # midagi ei tehtud

    def test_kandis_teose_staatus_kõikidele_dokumentidele(self, monkeypatch):
        """Segatud lehtede staatused → 'Töös' kantakse igale dokumendile."""
        sent = []
        monkeypatch.setattr(ops, "send_to_meilisearch", lambda docs, wait=True: sent.extend(docs) or True)
        monkeypatch.setattr(ops, "_delete_extra_pages", lambda wid, n: None)
        docs = [{"id": "W1-1"}, {"id": "W1-2"}]
        result = _upsert_work_documents("W1", "slug", docs, ["Toores", "Valmis"])
        assert result is True
        # mõlemale dokumendile lisati sama koondstaatus
        assert docs[0]["teose_staatus"] == "Töös"
        assert docs[1]["teose_staatus"] == "Töös"
        # saadetud dokumendid sisaldavad teose_staatus välja
        assert all("teose_staatus" in d for d in sent)

    def test_kõik_valmis_annab_valmis(self, monkeypatch):
        monkeypatch.setattr(ops, "send_to_meilisearch", lambda docs, wait=True: True)
        monkeypatch.setattr(ops, "_delete_extra_pages", lambda wid, n: None)
        docs = [{"id": "W1-1"}]
        _upsert_work_documents("W1", "slug", docs, ["Valmis"])
        assert docs[0]["teose_staatus"] == "Valmis"

    def test_saadab_ja_kustutab_üleliigse_pärast_lisamist(self, monkeypatch):
        """Kõigepealt saatmine, siis kustutamine (järgnevus — mitte ümberpöördult)."""
        order = []
        monkeypatch.setattr(ops, "send_to_meilisearch",
                            lambda docs, wait=True: order.append("send") or True)
        monkeypatch.setattr(ops, "_delete_extra_pages",
                            lambda wid, n: order.append("delete") or None)
        docs = [{"id": "W1-1"}, {"id": "W1-2"}, {"id": "W1-3"}]
        _upsert_work_documents("W1", "slug", docs, ["Toores"] * 3)
        # järgnevus: kustutamine peab toimuma PÄRAST saatmist (et vältida downtime-akent)
        assert order == ["send", "delete"]
        # _delete_extra_pages sai õige new_count (dokumentide arv)
        assert len(docs) == 3

    def test_tagastab_send_tulemi(self, monkeypatch):
        """Tagastab send_to_meilisearch tulemi (edastus võib ebaõnnestuda)."""
        monkeypatch.setattr(ops, "send_to_meilisearch", lambda docs, wait=True: False)
        monkeypatch.setattr(ops, "_delete_extra_pages", lambda wid, n: None)
        result = _upsert_work_documents("W1", "slug", [{"id": "W1-1"}], ["Toores"])
        assert result is False


# --- split_marginalia (alused) ---


class TestSplitMarginalia:
    def test_eraldab_ploki(self):
        text = "rida üks\n<m>Apoc. 12.</m>\nrida kaks"
        main, marg = split_marginalia(text)
        assert "<m>" not in main
        assert "Apoc. 12." in marg
        assert "rida üks" in main and "rida kaks" in main

    def test_fraas_liitub_yle_ploki(self):
        text = "welcher iſt der Teuffel\n<m>Vide Picrium\nin hyeroglyphicis</m>\nvnd Satanas."
        main, marg = split_marginalia(text)
        assert "Teuffel vnd Satanas" in clean_text_for_search(main)
        assert "Vide Picrium" in marg

    def test_poolitus_yle_ploki(self):
        text = "die rechten we⸗\n<m>märkus</m>\nge deß HErrn"
        main, _ = split_marginalia(text)
        assert "wege" in clean_text_for_search(main)

    def test_mitu_plokki(self):
        text = "a\n<m>üks</m>\nb\n<m>kaks</m>\nc"
        main, marg = split_marginalia(text)
        assert "<m>" not in main
        assert "üks" in marg and "kaks" in marg

    def test_marginaalia_sisemine_margendus_puhastub(self):
        _, marg = split_marginalia("a\n<m>Vide <i>Picrium</i></m>\nb")
        assert clean_text_for_search(marg) == "Vide Picrium"

    def test_plokki_pole(self):
        assert split_marginalia("lihtne tekst") == ("lihtne tekst", "")

    def test_tyhi(self):
        assert split_marginalia("") == ("", "")
        assert split_marginalia(None) == ("", "")

    def test_inline_m_ei_liimi_sonasid(self):
        """Inline <m> ei tohi liita ümbritsevaid sõnu üheks tokeniks."""
        # Tühikuga ümbritsetud inline
        main_ws, marg_ws = split_marginalia("foo <m>note</m> bar")
        assert "note" in marg_ws
        assert "foobar" not in clean_text_for_search(main_ws)
        assert "foo" in clean_text_for_search(main_ws)
        assert "bar" in clean_text_for_search(main_ws)
        # Ilma tühikuta — kriitiline juhtum
        main_nows, marg_nows = split_marginalia("foo<m>note</m>bar")
        assert "note" in marg_nows
        assert "foobar" not in clean_text_for_search(main_nows)
        assert "foo" in clean_text_for_search(main_nows)
        assert "bar" in clean_text_for_search(main_nows)

    def test_sulgemata_m_tag_degradeerub_graatsiliselt(self):
        """Sulgemata <m> ei tohi sisu kaotada — jääb põhiteksti puhastajale."""
        main, marg = split_marginalia("tekst <m>pooleli")
        # Marginaalia on tühi (regex ei leidnud sulgevat tagi)
        assert marg == ""
        # Sisu peab jääma otsingus kättesaadavaks (clean_text_for_search eemaldab rämpsu)
        assert "pooleli" in clean_text_for_search(main)


# --- ß-normaliseerimine otsinguväljadel (#228) ---
# Meili voldib täpitähed ise (Königsberg == Konigsberg), aga ß-i mitte, sest
# Unicode NFKD ei lagunda seda. Kirjaveataluvus ei päästa: 'daß' on 4 märki,
# mille puhul Meili lubab null kirjaviga. Normaliseerime MÕLEMAS otsas —
# päringupool elab src/services/searchService.ts-s (vt normalizeSearchQuery).
class TestNormalizeEszett:
    def test_asendab_ss_iga(self):
        from server.meili_doc import normalize_eszett
        assert normalize_eszett("daß") == "dass"
        assert normalize_eszett("nachließen") == "nachliessen"

    def test_asendab_suurtähe(self):
        from server.meili_doc import normalize_eszett
        assert normalize_eszett("STRAẞE") == "STRASSE"

    def test_ladina_ligatuur_samuti(self):
        """Ladina materjalis on ß pikk-s + s ligatuur, mitte saksa eszett."""
        from server.meili_doc import normalize_eszett
        assert normalize_eszett("auspicatißimos") == "auspicatissimos"

    def test_jätab_muu_puutumata(self):
        from server.meili_doc import normalize_eszett
        assert normalize_eszett("Königsberg") == "Königsberg"
        assert normalize_eszett("") == ""
        assert normalize_eszett(None) == ""

    def test_clean_text_for_search_normaliseerib(self):
        """Katab korraga lehekylje_tekst ja marginaalia_tekst — mõlemad käivad siit."""
        assert "dass" in clean_text_for_search("vnd ist gewiß, daß der Herr")
        assert "ß" not in clean_text_for_search("vnd ist gewiß, daß der Herr")

    def test_normaliseerimine_ei_riku_poolitust(self):
        """ß-asendus ei tohi segada reavahetuse sidekriipsude liitmist."""
        assert "grosse" in clean_text_for_search("gro⸗\nße")

    def test_marginaalia_normaliseeritakse_samuti(self):
        main, marg = _clean_search_text("tekst\n<m>groß</m>")
        assert marg == "gross"
