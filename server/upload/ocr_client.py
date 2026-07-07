"""OCR-serveri SSH/SFTP kliendi helperid.

Moodul hoiab püsivaid SSH transporte upload_id kaupa ning sisaldab väikeseid
remote-failisüsteemi utiliite. Kõrgema taseme upload workflow jääb
server.upload_ops koordinaatorisse.
"""
import os
import shlex
import socket
import threading
from collections.abc import Callable
from typing import Any

from ..config import OCR_SERVER_HOST, OCR_SERVER_USER, OCR_SERVER_PATH, get_logger
from . import file_detection, state as upload_state

logger = get_logger(__name__)

# OCR-serveri SSH-connecti timeout (s). Hoiab event-loopi/threadi blokeerumast
# minuteid, kui OCR-server on kättesaamatu.
OCR_CONNECT_TIMEOUT = 10

# Püsivad SSH ühendused (üks per upload_id)
ssh_connections: dict = {}
ssh_lock = threading.Lock()


def load_ssh_key():
    """Laeb SSH privaatvõtme tavalistest asukohtadest (~/.ssh/)."""
    try:
        import paramiko
    except ImportError:
        raise RuntimeError("paramiko pole paigaldatud (pip install paramiko)")

    key_paths = [
        ("ed25519", os.path.expanduser("~/.ssh/id_ed25519")),
        ("ecdsa", os.path.expanduser("~/.ssh/id_ecdsa")),
        ("rsa", os.path.expanduser("~/.ssh/id_rsa")),
    ]
    for key_type, path in key_paths:
        if not os.path.exists(path):
            continue
        try:
            if key_type == "ed25519":
                return paramiko.Ed25519Key.from_private_key_file(path)
            if key_type == "ecdsa":
                return paramiko.ECDSAKey.from_private_key_file(path)
            return paramiko.RSAKey.from_private_key_file(path)
        except Exception as e:
            logger.warning(f"SSH võtme laadimine ebaõnnestus ({path}): {e}")

    raise FileNotFoundError("SSH privaatvõtit ei leitud (~/.ssh/id_ed25519 ega teised)")


def get_or_create_ssh(
    upload_id: str,
    *,
    host: str = OCR_SERVER_HOST,
    user: str = OCR_SERVER_USER,
    connect_timeout: int = OCR_CONNECT_TIMEOUT,
    load_key_func: Callable[[], Any] = load_ssh_key,
):
    """Tagastab püsiva paramiko.Transport objekti antud upload_id jaoks."""
    try:
        import paramiko
    except ImportError:
        raise RuntimeError("paramiko pole paigaldatud (pip install paramiko)")

    with ssh_lock:
        transport = ssh_connections.get(upload_id)
        if transport and transport.is_active():
            return transport

        # Sulge vana katkine ühendus
        if transport:
            try:
                transport.close()
            except Exception:
                pass

        logger.info(f"SSH: loob ühenduse {user}@{host} (upload {upload_id})")
        # Loo socket eraldi LÜHIKESE timeout'iga — paramiko.Transport((host, 22))
        # kasutaks OS-i vaikimisi TCP-connect timeouti (~130 s), mis surnud OCR-hosti
        # korral blokeeris kogu backendi.
        sock = socket.create_connection((host, 22), timeout=connect_timeout)
        transport = paramiko.Transport(sock)
        transport.set_keepalive(30)
        transport.connect()
        key = load_key_func()
        transport.auth_publickey(user, key)
        ssh_connections[upload_id] = transport
        return transport


def close_ssh(upload_id: str):
    """Suleb ja eemaldab SSH ühenduse."""
    with ssh_lock:
        transport = ssh_connections.pop(upload_id, None)
    if transport:
        try:
            transport.close()
        except Exception:
            pass


def ssh_rm_rf(upload_id: str, remote_path: str, *, get_ssh_func: Callable[[str], Any] = get_or_create_ssh):
    """Kustutab OCR serveris kausta rekursiivselt (`rm -rf`) SSH kanali kaudu."""
    transport = get_ssh_func(upload_id)
    chan = transport.open_session()
    try:
        chan.set_combine_stderr(True)
        chan.exec_command(f"rm -rf -- {shlex.quote(remote_path)}")
        status = chan.recv_exit_status()
        if status != 0:
            raise RuntimeError(f"rm -rf ebaõnnestus (exit={status}): {remote_path}")
    finally:
        chan.close()


def sftp_open(
    upload_id: str,
    *,
    get_ssh_func: Callable[[str], Any] = get_or_create_ssh,
    close_ssh_func: Callable[[str], None] = close_ssh,
):
    """Loob SFTP seansi püsivalt SSH transpordilt. Proovib korra uuesti."""
    try:
        import paramiko
    except ImportError:
        raise RuntimeError("paramiko pole paigaldatud (pip install paramiko)")

    for attempt in range(2):
        try:
            transport = get_ssh_func(upload_id)
            return paramiko.SFTPClient.from_transport(transport)
        except Exception:
            if attempt == 0:
                close_ssh_func(upload_id)  # Eemalda katkine ühendus, proovi uuesti
            else:
                raise


def ensure_remote_dirs(sftp, remote_dirs):
    """Loob OCR-serveri kaustad kui need puuduvad (idempotentne)."""
    for remote_dir in remote_dirs:
        try:
            sftp.stat(remote_dir)
        except FileNotFoundError:
            sftp.mkdir(remote_dir)


def close_sftp_and_unlink(sftp, tmp_path: str):
    """Taustalõime finally-puhastus: sulge SFTP seanss ja kustuta ajutine fail."""
    if sftp:
        try:
            sftp.close()
        except Exception:
            pass
    file_detection.safe_unlink(tmp_path)


def prepare_image_upload(state: dict, *, ocr_server_path: str = OCR_SERVER_PATH) -> tuple:
    """Arvutab pildi-upload'i (alati 1 leht) remote teed.

    Tagastab: (pages, remote_dirs, remote_tmp, remote_dst, remote_img_name).
    """
    slug = state["meta"]["slug"]
    remote_staging_abs = f"{ocr_server_path}/{state['remote_staging_path']}"
    remote_work_abs = f"{ocr_server_path}/{state['remote_work_path']}"
    remote_img_name = f"{slug}_pg_001.jpg"
    remote_tmp = f"{remote_work_abs}/{remote_img_name}.tmp"
    remote_dst = f"{remote_work_abs}/{remote_img_name}"
    remote_dirs = (remote_staging_abs, remote_work_abs)
    return 1, remote_dirs, remote_tmp, remote_dst, remote_img_name


def prepare_pdf_upload(
    state: dict,
    tmp_path: str,
    *,
    ocr_server_path: str = OCR_SERVER_PATH,
    count_pdf_pages_func: Callable[[str], int] = file_detection.count_pdf_pages,
) -> tuple:
    """Arvutab PDF-upload'i remote teed (pärast pdfinfo lehekülgede loendust).

    Tagastab: (pages, remote_dirs, remote_tmp, remote_dst).
    """
    pages = count_pdf_pages_func(tmp_path)
    slug = state["meta"]["slug"]
    remote_staging_abs = f"{ocr_server_path}/{state['remote_staging_path']}"
    remote_tmp = f"{remote_staging_abs}/{slug}.pdf.tmp"
    remote_dst = f"{remote_staging_abs}/{slug}.pdf"
    remote_dirs = (remote_staging_abs,)
    return pages, remote_dirs, remote_tmp, remote_dst


def transfer_image(
    upload_id: str,
    tmp_path: str,
    file_type: str,
    remote_dirs,
    remote_tmp: str,
    remote_dst: str,
    remote_img_name: str,
    *,
    sftp_open_func: Callable[[str], Any] = sftp_open,
    validate_upload_image_func: Callable[[str], tuple[int, int]] = file_detection.validate_upload_image,
):
    """Taustalõime sihtfunktsioon: edastab üksiku pildi OCR-serverisse."""
    sftp = None
    try:
        sftp = sftp_open_func(upload_id)
        ensure_remote_dirs(sftp, remote_dirs)

        validate_upload_image_func(tmp_path)

        # Konverteeri JPEG-iks kui PNG või TIFF
        if file_type in ("png", "tiff"):
            from PIL import Image
            conv_path = tmp_path + ".conv.jpg"
            try:
                with Image.open(tmp_path) as img:
                    img.convert("RGB").save(conv_path, "JPEG", quality=95)
                sftp.put(conv_path, remote_tmp, callback=upload_state.sftp_progress_cb(upload_id))
            finally:
                file_detection.safe_unlink(conv_path)
        else:
            sftp.put(tmp_path, remote_tmp, callback=upload_state.sftp_progress_cb(upload_id))

        # Kustuta sihtfail kui see juba eksisteerib (uuesti üleslaadimine)
        try:
            sftp.stat(remote_dst)
            sftp.unlink(remote_dst)
        except FileNotFoundError:
            pass
        sftp.rename(remote_tmp, remote_dst)
        logger.info(f"Pilt edastatud OCR serverisse: {upload_id} ({remote_img_name})")

        upload_state.set_upload_state(upload_id, status="processing")

    except Exception as e:
        logger.error(f"SFTP pilt {upload_id}: {e}")
        upload_state.upload_progress[upload_id]["error"] = str(e)
        upload_state.set_upload_state(upload_id, status="error", error_message=str(e))
    finally:
        close_sftp_and_unlink(sftp, tmp_path)


def transfer_pdf(
    upload_id: str,
    tmp_path: str,
    remote_dirs,
    remote_tmp: str,
    remote_dst: str,
    pages: int,
    file_size: int,
    *,
    sftp_open_func: Callable[[str], Any] = sftp_open,
):
    """Taustalõime sihtfunktsioon: edastab PDF-i OCR-serverisse."""
    sftp = None
    try:
        sftp = sftp_open_func(upload_id)
        ensure_remote_dirs(sftp, remote_dirs)

        sftp.put(tmp_path, remote_tmp, callback=upload_state.sftp_progress_cb(upload_id))
        sftp.rename(remote_tmp, remote_dst)

        logger.info(f"SFTP upload valmis: {upload_id} ({pages} lk, {file_size} B)")

        upload_state.set_upload_state(upload_id, status="processing")

    except Exception as e:
        logger.error(f"SFTP transfer {upload_id}: {e}")
        upload_state.upload_progress[upload_id]["error"] = str(e)
        upload_state.set_upload_state(upload_id, status="error", error_message=str(e))
    finally:
        close_sftp_and_unlink(sftp, tmp_path)
