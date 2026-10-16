"""#619 koristuse valvurid: sisendi kuju, lukud, koodide tühistus."""
import os

import pytest


@pytest.mark.parametrize("bad", ["../x", "123/../../etc", "1?x=1", ""])
def test_gnd_vigane_id_ei_jou_url_i(bad, monkeypatch):
    from server.prosopography import enrichment
    monkeypatch.setattr(enrichment.urllib.request, "urlopen",
                        lambda *a, **k: pytest.fail("päring tehti vigase ID-ga"))
    assert enrichment._fetch_lobid_raw(bad) is None
    assert enrichment._fetch_gnd_dnb(bad) is None


@pytest.mark.parametrize("work_id", ["../w1", "w1/../x", "a" * 65, "", ".*"])
def test_prugikasti_teose_id_kuju(work_id):
    from server.trash_ops import restore_deleted_work, restore_deleted_page
    assert restore_deleted_work(work_id)["error"] == "Vigane teose ID"
    assert restore_deleted_page(work_id, "slug", "p1.jpg")["error"] == "Vigane teose ID"


@pytest.mark.parametrize("filename", ["../p1.jpg", "_metadata.json", ".hidden.jpg", "a\\b.jpg"])
def test_prugikasti_lehe_nimi(filename):
    from server.trash_ops import restore_deleted_page
    assert restore_deleted_page("w1", "slug", filename)["error"] == "Vigane failinimi"


def test_registreerimine_loeb_ja_kirjutab_luku_all(monkeypatch):
    from server import registration
    held = []
    monkeypatch.setattr(registration, "load_pending_registrations", lambda: {"registrations": []})
    monkeypatch.setattr(registration, "load_users", lambda: {})
    monkeypatch.setattr(registration, "suggest_username_for_email", lambda e: "x")
    monkeypatch.setattr(registration, "save_pending_registrations",
                        lambda d: held.append(registration.registrations_lock._is_owned()))
    reg, err = registration.add_registration("N", "n@x.ee", "", "", gdpr_consent=True)
    assert err is None and held == [True]


def test_kasutaja_kustutus_tuhistab_mcp_koodid(tmp_path, monkeypatch):
    from server import work_part_proposals as wpp
    from server.prosopography import enrichment_proposals as ep
    from server import auth
    monkeypatch.setattr(wpp, "DB_PATH", str(tmp_path / "wpp.sqlite3"))
    monkeypatch.setattr(ep, "DB_PATH", str(tmp_path / "ep.sqlite3"))
    d = tmp_path / "slug-w1"; d.mkdir()
    wpp.issue_handoff("w1", str(d), "kadunud")
    wpp.issue_handoff("w1", str(d), "teine")
    ep.issue_handoff(None, "kadunud", "s", "")
    auth._revoke_agent_handoffs("kadunud")
    with wpp._db() as db:
        assert [r[0] for r in db.execute("SELECT username FROM handoff")] == ["teine"]
    with ep._db() as db:
        assert db.execute("SELECT COUNT(*) FROM handoff").fetchone()[0] == 0


def test_tuhistus_ei_loo_andmebaasi(tmp_path, monkeypatch):
    from server import work_part_proposals as wpp
    monkeypatch.setattr(wpp, "DB_PATH", str(tmp_path / "puudub.sqlite3"))
    assert wpp.revoke_handoffs("x") == 0
    assert not os.path.exists(wpp.DB_PATH)
