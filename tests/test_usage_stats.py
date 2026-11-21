"""Kasutusstatistika (#855): hostiskripti parser + backendi koond ja endpoint."""
import importlib.util
import json
import os

import pytest

from server import usage_stats as us

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SPEC = importlib.util.spec_from_file_location("usage_stats_script", os.path.join(_ROOT, "scripts", "usage_stats.py"))
script = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(script)

BROWSER = "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0"


def rida(ip, path, *, method="GET", status=200, ua=BROWSER, ref="-", day="20/Nov/2026"):
    return f'{ip} - - [{day}:12:00:00 +0200] "{method} {path} HTTP/2.0" {status} 100 "{ref}" "{ua}"\n'


NAIDIS = [
    rida("193.40.5.150", "/", method="HEAD", ua="Zabbix 7.0.32"),
    rida("1.1.1.1", "/work/abc123/5", ref="https://www.google.com/search?q=x"),
    rida("1.1.1.1", "/meili/indexes/teosed/search", method="POST"),
    rida("1.1.1.1", "/api/files/get-work-metadata", method="POST"),
    rida("2.2.2.2", "/api/files/notifications"),
    rida("2.2.2.2", "/api/files/admin/registrations", method="POST"),
    rida("2.2.2.2", "/api/files/save", method="POST"),
    rida("2.2.2.2", "/api/files/save", method="POST", status=409),
    rida("2.2.2.2", "/persons/vutt%3APrnj8gw"),
    rida("3.3.3.3", "/work/abc123", ref="http://193.40.22.30/x"),
    rida("3.3.3.3", "/www", status=200),  # skänner SPA-fallbackiga: ei ole lehelaadimine
    rida("4.4.4.4", "/work/zzz999", ua="Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
    rida("5.5.5.5", "/robots.txt", ua="-"),
    rida("6.6.6.6", "/", ref="https://vutt.utlib.ut.ee/"),
    rida("1.1.1.1", "/", day="21/Nov/2026"),
    "prügi\n",
]


def test_paeva_kokkuvote():
    s = script.summarize(NAIDIS, {"2026-11-20"})["2026-11-20"]
    assert s["requests"] == 14
    assert s["monitoring"] == 1
    assert s["bot_requests"] == 2 and s["bot_ips"] == 2
    assert s["polling"] == 2
    # Külastaja = API/Meili kasutanud IP (küsitlus ei loe; 2.2.2.2 salvestas → loeb).
    assert s["visitors"] == 2
    assert s["logged_in"] == 1
    assert s["meili_queries"] == 1
    assert s["saves"] == 1  # 409 ei ole salvestus
    assert s["page_loads"] == 4  # /work ×2, /persons, /; mitte /www ega robot
    assert s["top_works"] == [["abc123", 2]]
    assert s["top_persons"] == [["vutt:Prnj8gw", 1]]
    assert dict(map(tuple, s["referrers"])) == {"google.com": 1, "(IP-aadress)": 1}
    assert dict(map(tuple, s["bots"])) == {"Googlebot": 1, "(tühi)": 1}


def test_kokkuvottes_ei_ole_ip_sid_ega_ua_sid():
    tekst = json.dumps(script.summarize(NAIDIS))
    for ip in ("1.1.1.1", "2.2.2.2", "193.40.5.150", "193.40.22.30"):
        assert ip not in tekst
    assert "Firefox" not in tekst and "Zabbix" not in tekst


def test_kordusjooks_asendab_paeva(tmp_path):
    out = str(tmp_path / "usage_stats.json")
    script.write(script.merge([], script.summarize(NAIDIS)), out)
    script.write(script.merge(script.load(out), script.summarize(NAIDIS[:2], {"2026-11-20"})), out)
    paevad = script.load(out)
    assert [d["date"] for d in paevad] == ["2026-11-20", "2026-11-21"]
    assert paevad[0]["requests"] == 2
    assert oct(os.stat(out).st_mode & 0o777) == "0o644"


def test_main_jatab_tanase_valja(tmp_path):
    from datetime import date
    tana = date.today().strftime("%d/%b/%Y")
    log = tmp_path / "access.log"
    log.write_text("".join(NAIDIS[:3]) + rida("1.1.1.1", "/", day=tana))
    out = tmp_path / "s.json"
    assert script.main(["--backfill", "--logs", str(log), "--out", str(out)]) == 0
    assert {d["date"] for d in script.load(str(out))} == {"2026-11-20"}


def test_skripti_ja_serveri_tee_on_sama():
    from server import config
    assert script.USAGE_STATS_FILE == config.USAGE_STATS_FILE


# --- Backend ---------------------------------------------------------------

def _paev(date, **kw):
    base = {"date": date, "requests": 10, "visitors": 3, "logged_in": 1, "bot_ips": 2,
            "page_loads": 4, "saves": 1, "top_works": [["abc123", 2]], "referrers": [["google.com", 1]]}
    base.update(kw)
    return base


def test_koond_summeerib_ja_unikaalsed_on_keskmine():
    days = [_paev("2026-11-18"), _paev("2026-11-19", visitors=7), _paev("2026-11-20", visitors=5)]
    agg = us.aggregate(days, 2)
    assert [d["date"] for d in agg["days"]] == ["2026-11-19", "2026-11-20"]
    assert agg["totals"]["requests"] == 20
    assert agg["daily"]["visitors"] == {"avg": 6.0, "max": 7}
    assert agg["tops"]["top_works"] == [["abc123", 4]]
    assert agg["first_date"] == "2026-11-18"


def test_koond_tuhjalt():
    agg = us.aggregate([], 30)
    assert agg["days"] == [] and agg["first_date"] is None and agg["totals"]["requests"] == 0


def test_pealkiri_ainult_loetavale_teosele(monkeypatch):
    from server import access_ops, work_sets_access
    monkeypatch.setattr(work_sets_access, "load_work_metadata_by_id", lambda wid: {"title": "Salajane"})
    monkeypatch.setattr(access_ops, "can_read_work", lambda meta, user: False)
    agg = us.with_labels(us.aggregate([_paev("2026-11-20")], 30), {"role": "admin"})
    assert agg["tops"]["top_works"] == [{"id": "abc123", "n": 2, "label": None}]
    monkeypatch.setattr(access_ops, "can_read_work", lambda meta, user: True)
    agg = us.with_labels(us.aggregate([_paev("2026-11-20")], 30), {"role": "admin"})
    assert agg["tops"]["top_works"][0]["label"] == "Salajane"


def test_endpoint_adminile(client, login, tmp_path, monkeypatch):
    f = tmp_path / "usage_stats.json"
    f.write_text(json.dumps({"version": 1, "days": [_paev("2026-11-20", top_works=[])]}))
    monkeypatch.setattr(us, "USAGE_STATS_FILE", str(f))
    assert client.get("/admin/usage-stats").status_code == 401
    r = client.get("/admin/usage-stats", headers={"Authorization": f"Bearer {login('editor', 'editorpass')}"})
    assert r.status_code in (401, 403)
    r = client.get("/admin/usage-stats?days=7", headers={"Authorization": f"Bearer {login('admin', 'adminpass')}"})
    assert r.status_code == 200
    data = r.json()
    assert data["days"][0]["visitors"] == 3
    assert data["tops"]["referrers"] == [{"id": "google.com", "n": 1, "label": None}]


def test_endpoint_ilma_failita(client, login, tmp_path, monkeypatch):
    monkeypatch.setattr(us, "USAGE_STATS_FILE", str(tmp_path / "puudub.json"))
    r = client.get("/admin/usage-stats", headers={"Authorization": f"Bearer {login('admin', 'adminpass')}"})
    assert r.status_code == 200 and r.json()["days"] == []
