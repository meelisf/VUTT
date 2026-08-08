"""DELETE /admin/reocr/{job_id} (#217)."""
import pytest

import server.routers.reocr as reocr_router


def _admin(login):
    return {"Authorization": "Bearer {}".format(login("admin", "adminpass"))}


def test_katkestamine_annab_200(client, login, monkeypatch):
    monkeypatch.setattr(
        reocr_router, "cancel_reocr_job",
        lambda jid: {"status": "cancelled", "remote_cleanup": "ok",
                     "deleted_ocr": 2, "restored_ocr": 1},
    )
    r = client.delete("/admin/reocr/abc123", headers=_admin(login))
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"
    assert r.json()["deleted_ocr"] == 2


def test_valmis_too_annab_409(client, login, monkeypatch):
    def _raise(jid):
        raise ValueError("Töö ei ole katkestatav")

    monkeypatch.setattr(reocr_router, "cancel_reocr_job", _raise)
    assert client.delete("/admin/reocr/abc123", headers=_admin(login)).status_code == 409


def test_tundmatu_too_annab_404(client, login, monkeypatch):
    def _raise(jid):
        raise KeyError(jid)

    monkeypatch.setattr(reocr_router, "cancel_reocr_job", _raise)
    assert client.delete("/admin/reocr/abc123", headers=_admin(login)).status_code == 404


def test_kirjutaja_ei_peatunud_annab_503(client, login, monkeypatch):
    def _raise(jid):
        raise RuntimeError("Üleslaadimislõim ei peatunud")

    monkeypatch.setattr(reocr_router, "cancel_reocr_job", _raise)
    assert client.delete("/admin/reocr/abc123", headers=_admin(login)).status_code == 503


def test_korduv_katkestamine_annab_404(client, login, monkeypatch):
    """Töö on aktiivregistrist kadunud — katkestamine EI OLE idempotentne."""
    kutsutud = []

    def _once(jid):
        if kutsutud:
            raise KeyError(jid)
        kutsutud.append(jid)
        return {"status": "cancelled", "remote_cleanup": "ok",
                "deleted_ocr": 0, "restored_ocr": 0}

    monkeypatch.setattr(reocr_router, "cancel_reocr_job", _once)
    headers = _admin(login)
    assert client.delete("/admin/reocr/abc123", headers=headers).status_code == 200
    assert client.delete("/admin/reocr/abc123", headers=headers).status_code == 404


def test_editor_ei_paase_ligi(client, login, monkeypatch):
    monkeypatch.setattr(reocr_router, "cancel_reocr_job",
                        lambda jid: pytest.fail("editor ei tohi siia jõuda"))
    token = login("editor", "editorpass")
    r = client.delete("/admin/reocr/abc123",
                      headers={"Authorization": "Bearer {}".format(token)})
    assert r.status_code in (401, 403)


def test_tee_on_admin_all():
    """nginx proksib /api/files/ kaudu KÕIK backend-teed avalikult."""
    teed = [r.path for r in reocr_router.router.routes if "reocr" in r.path.lower()]
    assert teed, "reocr-teid ei leitud"
    assert all(p.startswith("/admin/") for p in teed), teed
