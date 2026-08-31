"""Üks tee: ka triviaalne plaan läheb VUTT-i materialiseerimise kaudu.

Varem hargnes apply `is_trivial_plan` järgi: triviaalne → originaal-PDF LOSSi,
kus `expand_pdf` rasteriseeris terve faili enne esimese JPG kirjutamist ja
blokeeris nii pisipildid kui OCR-i. Nüüd materialiseerib VUTT lehed alati ja
LOSS alustab OCR-i esimesest lehest. Vt ADR 0028.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


TRIVIAALNE = {
    "default_split_x": 0.5,
    "pages": [
        {"n": 1, "mode": "nosplit", "split_x": None, "excluded": False},
        {"n": 2, "mode": "nosplit", "split_x": None, "excluded": False},
    ],
}


def test_triviaalne_plaan_laheb_start_apply_kaudu(client, login, make_upload, monkeypatch):
    from server.upload import prepress_apply, state as upload_state

    make_upload("upl123", status="awaiting_split", expected_pages=2)
    upload_state.set_upload_state("upl123", prepress=TRIVIAALNE)

    kutsutud = []
    monkeypatch.setattr(prepress_apply, "start_apply",
                        lambda uid: kutsutud.append(uid) or True)

    token = login("admin", "adminpass")
    r = client.post("/admin/upload/upl123/prepress/apply",
                    headers={"Authorization": "Bearer {}".format(token)})

    assert r.status_code == 200
    assert kutsutud == ["upl123"], "triviaalne plaan EI TOHI enam PDF-teed minna"


def test_apply_konflikt_kui_too_juba_kaib(client, login, make_upload, monkeypatch):
    """CAS ütleb ei — vastus peab jääma 409-ks, mitte muutuma marsruutimisega."""
    from server.upload import prepress_apply, state as upload_state

    make_upload("upl124", status="awaiting_split", expected_pages=2)
    upload_state.set_upload_state("upl124", prepress=TRIVIAALNE)
    monkeypatch.setattr(prepress_apply, "start_apply", lambda uid: False)

    token = login("admin", "adminpass")
    r = client.post("/admin/upload/upl124/prepress/apply",
                    headers={"Authorization": "Bearer {}".format(token)})

    assert r.status_code == 409
