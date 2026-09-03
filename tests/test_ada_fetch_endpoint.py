"""ada-fetch endpoint: rollikontroll, 409 korduse peale, ada-plokk create'ist.

monkeypatch sihib `upload_router.ada_fetch`-i, mitte `server.ada.fetch`-i — router
impordib mooduli endale ja mooduli atribuudi asendamine mõjub mõlemale.
"""
import pytest

from server.routers import upload as upload_router


def _peis(login, kasutaja="admin", parool="adminpass"):
    return {"Authorization": "Bearer {}".format(login(kasutaja, parool))}


def _loo(client, login, **lisa):
    keha = {"title": "Kirjad", "year": "1812", "slug": "kirjad"}
    keha.update(lisa)
    r = client.post("/admin/upload/create", json=keha, headers=_peis(login))
    assert r.status_code == 200, r.text
    return r.json()["upload"]


ADA_PLOKK = {"handle": "10062/7822", "item_uuid": "u",
             "sources": [{"name": "a.pdf", "bitstream_uuid": "b1", "size_bytes": 10}]}


def test_fetch_nouab_admini(client, login):
    r = client.post("/admin/upload/xyz/ada-fetch",
                    headers=_peis(login, "editor", "editorpass"))
    assert r.status_code in (401, 403)


def test_create_salvestab_ada_ploki(client, login):
    assert _loo(client, login, ada=ADA_PLOKK)["ada"]["handle"] == "10062/7822"


def test_fetch_kordus_annab_409(client, login, monkeypatch):
    uid = _loo(client, login, ada=ADA_PLOKK)["id"]

    monkeypatch.setattr(upload_router.ada_fetch, "alusta_fetchi", lambda u: True)
    assert client.post("/admin/upload/{}/ada-fetch".format(uid),
                       headers=_peis(login)).status_code == 200

    monkeypatch.setattr(upload_router.ada_fetch, "alusta_fetchi", lambda u: False)
    assert client.post("/admin/upload/{}/ada-fetch".format(uid),
                       headers=_peis(login)).status_code == 409


def test_ilma_ada_plokita_upload_ei_saa_fetchida(client, login):
    uid = _loo(client, login, title="Tavaline", slug="tavaline")["id"]
    r = client.post("/admin/upload/{}/ada-fetch".format(uid), headers=_peis(login))
    assert r.status_code == 400


def test_poll_ei_puuduta_sftp_d_ada_fetchingu_ajal(client, login, monkeypatch):
    """OCR-serveris ei ole veel midagi — SFTP kutse oleks viga, mitte ootamine.

    `poll_and_sync_thumbs` seob `sftp_open_func`-i default'i defineerimishetkel
    ja `upload_ops.py` annab igale kutsele `sftp_open_func=_sftp_open` EXPLICIITSELT —
    seega tuleb patchida `server.upload_ops._sftp_open`, mitte `thumbs.sftp_open`
    (viimase patch on vacuous, ei mõjuta reaalset kutset).
    """
    from server import upload_ops
    uid = _loo(client, login, ada=ADA_PLOKK)["id"]
    from server.upload import state as upload_state
    upload_state.set_upload_state(uid, status="ada_fetching")
    monkeypatch.setattr(upload_ops, "_sftp_open",
                        lambda *a, **k: pytest.fail("SFTP-d ei tohi avada"))
    r = client.get("/admin/upload/{}/status".format(uid), headers=_peis(login))
    assert r.status_code == 200
    assert r.json()["status"] == "ada_fetching"
