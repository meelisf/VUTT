"""
Taustasünk: upload-OCR progress peab uuenema ka siis kui keegi pole Upload lehel.

Taust: poll_and_sync_thumbs (state.json sünk SFTP kaudu) käivitus AINULT kui
frontend päris /admin/upload/{id}/status, ja frontend pollis ainult avatud
uploadi. Öösel lehte lahti jättes (taustatab/uni) polling throttle'iti → state.json
jäi õhtusesse seisu → hommikul "pooleli" ka hard refreshi järel. Lahendus:
daemon-thread, mis pollib perioodiliselt kõiki aktiivseid uploade (nagu re-OCR).

Siin testime puhast valikuloogikat _uploads_needing_sync — millised staatused
vajavad taustasünki. poll_and_sync_thumbs short-circuitib ülejäänud niikuinii.
"""
from server import upload_ops


def test_uploads_needing_sync_valib_ainult_aktiivsed():
    states = [
        {"id": "a", "status": "processing"},        # OCR töötab → sünki
        {"id": "b", "status": "reviewing"},          # osa lehti valmis → sünki
        {"id": "c", "status": "done"},               # lõppseis → ei
        {"id": "d", "status": "uploading"},          # SFTP oma threadis → ei
        {"id": "e", "status": "pending"},            # pole alustanud → ei
        {"id": "f", "status": "error"},              # lõppseis → ei
        {"id": "g", "status": "imported"},           # lõppseis → ei
        {"id": "h", "status": "collecting_images"},  # kasutaja lisab veel → ei
    ]
    assert upload_ops._uploads_needing_sync(states) == ["a", "b"]


def test_uploads_needing_sync_tyhi_ja_puuduv_id():
    assert upload_ops._uploads_needing_sync([]) == []
    # ilma id-ta kirjet ei tagastata (ei saaks niikuinii pollida)
    assert upload_ops._uploads_needing_sync([{"status": "processing"}]) == []
