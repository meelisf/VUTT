"""Liikluse jälgimine ja häire superadminile (#786)."""
import asyncio
import json

import pytest

from server import traffic_monitor as tm


@pytest.fixture
def jalgija(tmp_path, monkeypatch):
    tm.reset()
    monkeypatch.setattr(tm, "TRAFFIC_ALERTS_FILE", str(tmp_path / "traffic_alerts.json"))
    saadetud = []
    def _notify(alert):
        saadetud.append(alert)
        return {"delivered": True, "failed_mail": []}
    monkeypatch.setattr(tm, "_notify", _notify)
    yield saadetud
    tm.reset()


def taida(algus, minuteid, per_min, *, errors=0, ip_count=1, slow=0):
    for m in range(algus, algus + minuteid):
        for i in range(per_min):
            tm.record(m, anon=True, ip=f"10.0.{i % ip_count}.1",
                      status=500 if i < errors else 200,
                      duration=5.0 if i < slow else 0.01)


M = 30_000_000  # suvaline minut


def test_kast_loendab_anonuumsed_ip_d_vead_ja_aeglased(jalgija):
    tm.record(M, anon=True, ip="1.1.1.1", status=200, duration=0.1)
    tm.record(M, anon=False, ip="1.1.1.1", status=502, duration=3.0)
    tm.record(M, anon=True, ip="2.2.2.2", status=200, duration=0.1)
    rida = tm.snapshot(M)[-1]
    assert (rida["total"], rida["anon"], rida["errors"], rida["slow"], rida["ips"]) == (3, 2, 1, 1, 2)


def test_tyhjad_minutid_on_graafikus_nullidega(jalgija):
    tm.record(M, anon=True, ip="1", status=200, duration=0)
    read = tm.snapshot(M + 3)
    assert [r["total"] for r in read] == [1, 0, 0, 0]


def test_vanad_kastid_koristatakse(jalgija):
    tm.record(M, anon=True, ip="1", status=200, duration=0)
    tm.record(M + tm.HISTORY_MINUTES, anon=True, ip="1", status=200, duration=0)
    assert M not in tm._buckets


def test_ip_hulk_on_piiratud(jalgija, monkeypatch):
    monkeypatch.setattr(tm, "MAX_IPS_PER_MINUTE", 3)
    for i in range(10):
        tm.record(M, anon=True, ip=str(i), status=200, duration=0)
    rida = tm.snapshot(M)[-1]
    assert (rida["total"], rida["ips"]) == (10, 3)


def test_kõrge_koormus_kogu_akna_jooksul_annab_hairet(jalgija, monkeypatch):
    monkeypatch.setattr(tm, "TRAFFIC_ALERT_RPS", 1)  # 60 päringut minutis
    taida(M, tm.TRAFFIC_ALERT_MINUTES, 60, ip_count=7)
    [alert] = tm.check_and_alert(now=(M + tm.TRAFFIC_ALERT_MINUTES) * 60 + 5)
    assert alert["kind"] == "load" and alert["max_ips_per_minute"] == 7
    assert jalgija == [alert]


def test_kaheksa_minutit_kymnest_piisab_seitse_ei_piisa(jalgija, monkeypatch):
    # Üks vaiksem minut ei tohi häiret nullida, lühike pursk ei ole häire.
    monkeypatch.setattr(tm, "TRAFFIC_ALERT_RPS", 1)
    nuud = M + tm.TRAFFIC_ALERT_MINUTES
    taida(M, tm.TRAFFIC_ALERT_MIN_MINUTES - 1, 600)
    assert tm.evaluate(nuud) == []
    taida(M + tm.TRAFFIC_ALERT_MIN_MINUTES - 1, 1, 60)
    assert [a["kind"] for a in tm.evaluate(nuud)] == ["load"]


def test_jooksev_minut_ei_lahe_arvesse(jalgija, monkeypatch):
    monkeypatch.setattr(tm, "TRAFFIC_ALERT_RPS", 1)
    nuud = M + tm.TRAFFIC_ALERT_MINUTES
    taida(M, tm.TRAFFIC_ALERT_MIN_MINUTES - 1, 60)
    taida(nuud, 1, 6000)  # pooleli minut
    assert tm.evaluate(nuud) == []


def test_aeglustumine_on_eraldi_haire(jalgija):
    nuud = M + tm.TRAFFIC_ALERT_MINUTES
    taida(M, tm.TRAFFIC_ALERT_MINUTES, 10, slow=1)  # 10 %
    assert tm.evaluate(nuud) == []
    tm.reset()
    taida(M, tm.TRAFFIC_ALERT_MINUTES, 2, slow=1)  # 50 % aga 10 tk < 30
    assert tm.evaluate(nuud) == []
    tm.reset()
    taida(M, tm.TRAFFIC_ALERT_MINUTES, 10, slow=3)  # 30 %, 30 tk
    [alert] = tm.evaluate(nuud)
    assert alert["kind"] == "slow" and alert["slow"] == 30


def test_vigade_haire_nouab_nii_osakaalu_kui_miinimumi(jalgija):
    nuud = M + tm.TRAFFIC_ALERT_MINUTES
    taida(M, tm.TRAFFIC_ALERT_MINUTES, 10, errors=4)  # 40 % aga 40 tk < 50
    assert tm.evaluate(nuud) == []
    tm.reset()
    taida(M, tm.TRAFFIC_ALERT_MINUTES, 200, errors=6)  # 60 tk aga 3 %
    assert tm.evaluate(nuud) == []
    tm.reset()
    taida(M, tm.TRAFFIC_ALERT_MINUTES, 100, errors=6)  # 60 tk, 6 %
    [alert] = tm.evaluate(nuud)
    assert alert["kind"] == "errors" and alert["errors"] == 60


def test_sama_liik_vaikib_jahtumisaja_ja_restardi_ule(jalgija, monkeypatch):
    monkeypatch.setattr(tm, "TRAFFIC_ALERT_RPS", 1)
    taida(M, tm.TRAFFIC_ALERT_MINUTES + 1, 60)
    t = (M + tm.TRAFFIC_ALERT_MINUTES) * 60
    assert len(tm.check_and_alert(now=t)) == 1
    assert tm.check_and_alert(now=t + 60) == []
    # Restart: mälu tühi, aga viimane saatmisaeg on kettal.
    tm.reset()
    taida(M + 100, tm.TRAFFIC_ALERT_MINUTES, 60)
    t2 = (M + 100 + tm.TRAFFIC_ALERT_MINUTES) * 60
    assert t2 - t < tm.TRAFFIC_ALERT_COOLDOWN
    assert tm.check_and_alert(now=t2) == []
    assert len(jalgija) == 1


def test_kohale_joudmata_haire_ei_kaivita_ooteaega(jalgija, monkeypatch):
    monkeypatch.setattr(tm, "TRAFFIC_ALERT_RPS", 1)
    katsed = []
    tulemused = iter([False, True])

    def _notify(alert):
        katsed.append(alert)
        return {"delivered": next(tulemused), "failed_mail": []}
    monkeypatch.setattr(tm, "_notify", _notify)
    taida(M, tm.TRAFFIC_ALERT_MINUTES + 30, 60)
    t = (M + tm.TRAFFIC_ALERT_MINUTES) * 60
    assert len(tm.check_and_alert(now=t)) == 1
    # Kordus ei käi iga minut, vaid piiratud sagedusega.
    assert tm.check_and_alert(now=t + 60) == []
    assert len(tm.check_and_alert(now=t + tm.RETRY_SECONDS)) == 1
    assert len(katsed) == 2
    # Õnnestunud saatmine käivitab ooteaja.
    assert tm.check_and_alert(now=t + tm.RETRY_SECONDS + 60) == []
    assert tm.list_alerts()[0]["delivered"] is True
    assert tm.list_alerts()[1]["delivered"] is False


def test_ebaonnestunud_kiri_proovitakse_uuesti_piiratud_arv_kordi(jalgija, monkeypatch):
    monkeypatch.setattr(tm, "TRAFFIC_ALERT_RPS", 1)
    monkeypatch.setattr(tm, "_notify", lambda a: {"delivered": True, "failed_mail": ["sa"]})
    kirjad = []
    monkeypatch.setattr(tm, "_send_mail", lambda u, s, b: (kirjad.append(u), False)[1])
    taida(M, tm.TRAFFIC_ALERT_MINUTES, 60)
    t = (M + tm.TRAFFIC_ALERT_MINUTES) * 60
    tm.check_and_alert(now=t)
    assert len(json.load(open(tm.TRAFFIC_ALERTS_FILE))["pending_mail"]) == 1
    for i in range(1, 6):
        tm.check_and_alert(now=t + i * tm.RETRY_SECONDS)
    assert len(kirjad) == tm.MAIL_MAX_RETRIES
    assert json.load(open(tm.TRAFFIC_ALERTS_FILE))["pending_mail"] == []


def test_korduskatse_onnestumine_eemaldab_ootelt(jalgija, monkeypatch):
    monkeypatch.setattr(tm, "TRAFFIC_ALERT_RPS", 1)
    monkeypatch.setattr(tm, "_notify", lambda a: {"delivered": True, "failed_mail": ["sa"]})
    monkeypatch.setattr(tm, "_send_mail", lambda u, s, b: True)
    taida(M, tm.TRAFFIC_ALERT_MINUTES, 60)
    t = (M + tm.TRAFFIC_ALERT_MINUTES) * 60
    tm.check_and_alert(now=t)
    tm.check_and_alert(now=t + 60)  # tähtaeg pole käes
    assert len(json.load(open(tm.TRAFFIC_ALERTS_FILE))["pending_mail"]) == 1
    tm.check_and_alert(now=t + tm.RETRY_SECONDS)
    assert json.load(open(tm.TRAFFIC_ALERTS_FILE))["pending_mail"] == []


def test_haire_jaab_ajalukku(jalgija, monkeypatch):
    monkeypatch.setattr(tm, "TRAFFIC_ALERT_RPS", 1)
    taida(M, tm.TRAFFIC_ALERT_MINUTES, 60)
    tm.check_and_alert(now=(M + tm.TRAFFIC_ALERT_MINUTES) * 60)
    [kirje] = tm.list_alerts()
    assert kirje["kind"] == "load" and kirje["at"]


def test_kirjutustorge_ei_saada_hairet(jalgija, monkeypatch):
    # Muidu läheks iga minut uus kiri, sest jahtumisaeg ei salvestu.
    monkeypatch.setattr(tm, "TRAFFIC_ALERT_RPS", 1)
    monkeypatch.setattr(tm, "atomic_write_json", lambda *a, **k: (_ for _ in ()).throw(OSError("täis")))
    taida(M, tm.TRAFFIC_ALERT_MINUTES, 60)
    assert tm.check_and_alert(now=(M + tm.TRAFFIC_ALERT_MINUTES) * 60) == []
    assert jalgija == []


def test_teavitus_laheb_ainult_superadminile(tmp_path, monkeypatch):
    import server.auth as auth
    import server.mailer as mailer
    import server.notifications_ops as nops
    monkeypatch.setattr(auth, "load_users", lambda: {
        "sa": {"role": "superadmin", "email": "sa@example.org"},
        "ad": {"role": "admin", "email": "ad@example.org"},
        "ed": {"role": "editor", "email": "ed@example.org"},
    })
    kirjad, teatised = [], []
    monkeypatch.setattr(mailer, "send_mail", lambda to, s, b: (kirjad.append(to), (True, None))[1])
    monkeypatch.setattr(nops, "create_notification", lambda user, *a, **k: teatised.append(user))
    tulemus = tm._notify({"kind": "load", "requests": 1, "rps": 1.0, "max_ips_per_minute": 1})
    assert kirjad == ["sa@example.org"] and teatised == ["sa"]
    assert tulemus == {"delivered": True, "failed_mail": []}


def test_teavituse_tulemus_kanaliti(monkeypatch):
    import server.auth as auth
    import server.mailer as mailer
    import server.notifications_ops as nops
    monkeypatch.setattr(auth, "load_users", lambda: {"sa": {"role": "superadmin", "email": "sa@x.org"}})
    monkeypatch.setattr(mailer, "send_mail", lambda to, s, b: (False, "relee maas"))
    monkeypatch.setattr(nops, "create_notification", lambda *a, **k: None)
    alert = {"kind": "slow", "requests": 100, "slow": 40, "share": 0.4}
    assert tm._notify(alert) == {"delivered": True, "failed_mail": ["sa"]}

    def katki(*a, **k):
        raise OSError("ketas")
    monkeypatch.setattr(nops, "create_notification", katki)
    assert tm._notify(alert) == {"delivered": False, "failed_mail": ["sa"]}


def test_vahevara_moodab_staatuse_ja_anonuumsuse(jalgija):
    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 503, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def noop(_):
        pass

    mw = tm.TrafficMiddleware(app)
    scope = {"type": "http", "path": "/x", "headers": [(b"x-real-ip", b"9.9.9.9")]}
    asyncio.run(mw(scope, None, noop))
    asyncio.run(mw({**scope, "path": "/health"}, None, noop))
    rida = tm.snapshot()[-1]
    assert (rida["total"], rida["anon"], rida["errors"], rida["ips"]) == (1, 1, 1, 1)


def test_vahevara_loeb_erindi_500ks_ja_viskab_edasi(jalgija):
    async def app(scope, receive, send):
        raise RuntimeError("katki")

    mw = tm.TrafficMiddleware(app)
    with pytest.raises(RuntimeError):
        asyncio.run(mw({"type": "http", "path": "/x", "headers": []}, None, None))
    rida = tm.snapshot()[-1]
    assert (rida["total"], rida["errors"]) == (1, 1)


def _ok_app():
    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})
    return app


async def _noop(_):
    pass


def test_suvaline_bearer_on_anonuumne(jalgija):
    # Päise olemasolu ei tõenda sisselogimist: robot saab saata `Bearer x`.
    mw = tm.TrafficMiddleware(_ok_app())
    asyncio.run(mw({"type": "http", "path": "/x",
                    "headers": [(b"authorization", b"Bearer voltsitud")]}, None, _noop))
    assert tm.snapshot()[-1]["anon"] == 1


def test_kehtiv_sessioon_ei_ole_anonuumne_ega_pikenda_sessiooni(jalgija, login, backend_env):
    from server import auth
    token = login("contrib", "contribpass")
    tm.reset()  # sisselogimispäring ise läks samuti vahevarast läbi
    sessioon = auth.sessions[auth.token_key(token)]
    # Värske ajaga kehtiv, aga mõõtmine ei tohi last_seen'i nihutada.
    from datetime import datetime
    sessioon["last_seen"] = datetime.now().isoformat()
    enne = sessioon["last_seen"]
    mw = tm.TrafficMiddleware(_ok_app())
    asyncio.run(mw({"type": "http", "path": "/x",
                    "headers": [(b"authorization", f"Bearer {token}".encode())]}, None, _noop))
    assert tm.snapshot()[-1]["anon"] == 0
    assert sessioon["last_seen"] == enne


def test_aegunud_sessioon_on_anonuumne(jalgija, login, backend_env):
    from server import auth
    token = login("contrib", "contribpass")
    tm.reset()
    auth.sessions[auth.token_key(token)]["last_seen"] = "2020-01-01T00:00:00"
    mw = tm.TrafficMiddleware(_ok_app())
    asyncio.run(mw({"type": "http", "path": "/x",
                    "headers": [(b"authorization", f"Bearer {token}".encode())]}, None, _noop))
    assert tm.snapshot()[-1]["anon"] == 1
    # Ainult lugev: aegunud kirjet mõõtmine ei eemalda.
    assert auth.token_key(token) in auth.sessions


def test_endpoint_on_ainult_superadminile(client, login):
    for user, pw in (("admin", "adminpass"), ("editor", "editorpass")):
        r = client.get("/admin/traffic", headers={"Authorization": f"Bearer {login(user, pw)}"})
        assert r.status_code in (401, 403)
    assert client.get("/admin/traffic").status_code == 401


def test_superadmin_saab_graafiku_ja_ajaloo(client, login, jalgija):
    tm.record(int(__import__("time").time() // 60), anon=True, ip="1", status=200, duration=0)
    r = client.get("/admin/traffic", headers={"Authorization": f"Bearer {login('superadmin', 'superpass')}"})
    assert r.status_code == 200
    data = r.json()
    assert data["minutes"] and data["alerts"] == []
    assert data["thresholds"]["rps"] == tm.TRAFFIC_ALERT_RPS
