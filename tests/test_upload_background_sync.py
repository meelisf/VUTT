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


# --- Stall-indikaator (nõuandev; ei muuda staatusemasinat) ---

def _now():
    from datetime import datetime
    return datetime.now().timestamp()


def test_is_stalled_kui_edenemist_pole_yle_lavi():
    now = _now()
    thr = upload_ops.UPLOAD_STALL_THRESHOLD
    # ready < expected JA viimane edenemine > lävi tagasi → stalled
    assert upload_ops._is_stalled(5, 300, now - thr - 1, now) is True


def test_is_stalled_false_kui_hiljuti_edenes():
    now = _now()
    # äsja tekkis uus valmis leht → pole stalled, kuigi pooleli
    assert upload_ops._is_stalled(5, 300, now - 10, now) is False


def test_is_stalled_false_kui_valmis():
    now = _now()
    # ready >= expected → valmis, mitte stalled (staatus läheb done-iks)
    assert upload_ops._is_stalled(300, 300, now - 99999, now) is False


def test_is_stalled_false_kui_expected_puudub_voi_baseline_puudub():
    now = _now()
    # ilma oodatava lehekülgede arvuta ei saa "pooleli" defineerida
    assert upload_ops._is_stalled(5, None, now - 99999, now) is False
    # baseline (last_progress_at) puudub → ei flag'i (nt vana state.json)
    assert upload_ops._is_stalled(5, 300, None, now) is False
