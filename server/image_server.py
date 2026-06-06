"""
Piltide serveerimise server.
Optimeeritud jõudluseks (threading, cache) ja turvalisuseks (CORS).
Toetab NanoID püsiviiteid ja thumbnail genereerimist.
"""
import glob
import http.server
import json
import os
import socketserver
import sys
import urllib.parse

# Lisame server/ kausta pathi
if __name__ == '__main__' and __package__ is None:
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = "server"

import hashlib
import hmac
import time

from .config import ALLOWED_ORIGINS, BASE_DIR, IMAGE_TOKEN_SECRET
from .utils import find_directory_by_id, build_work_id_cache
from .access_ops import is_work_public

_ALLOWED_IMAGE_EXTENSIONS = frozenset({'.jpg', '.jpeg', '.png'})


def _validate_image_token(work_id: str, exp: str, sig: str) -> bool:
    """Kontrollib pildipäringu HMAC-allkirja. Formaat: HMAC(secret, "image:{work_id}:{exp}")."""
    try:
        exp_int = int(exp)
        if exp_int < int(time.time()):
            return False
        secret = IMAGE_TOKEN_SECRET.encode()
        message = f"image:{work_id}:{exp}".encode()
        expected = hmac.new(secret, message, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, sig)
    except Exception:
        return False


def _load_work_meta_for_path(resolved_path: str):
    """Laeb _metadata.json lahendatud pilditee vanemkataloogist."""
    work_dir = os.path.dirname(resolved_path)
    meta_path = os.path.join(work_dir, '_metadata.json')
    if not os.path.exists(meta_path):
        return None
    try:
        with open(meta_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _check_image_access(work_id: str, meta, query_string: str) -> bool:
    """Kontrollib kas pildipäring on lubatud.
    Avalikud teosed läbivad alati. Piiratud teoste puhul valideeritakse HMAC token."""
    if meta is None or is_work_public(meta) or meta.get('shareable', False):
        return True
    token_work_id = work_id
    parsed_qs = urllib.parse.parse_qs(query_string)
    exp = parsed_qs.get('exp', [''])[0]
    sig = parsed_qs.get('sig', [''])[0]
    return _validate_image_token(token_work_id, exp, sig)


def _is_safe_image_path(resolved_path: str, base_dir: str) -> bool:
    """Kontrollib kas tee viitab lubatud pildifailile base_dir sees.
    Kaitseb mitte-pildifailide lekkimise ja symlink-põhise path traversal eest.
    """
    try:
        real_path = os.path.realpath(resolved_path)
        real_base = os.path.realpath(base_dir)
        if not real_path.startswith(real_base + os.sep):
            return False
        _, ext = os.path.splitext(real_path)
        return ext.lower() in _ALLOWED_IMAGE_EXTENSIONS
    except Exception:
        return False

# Pillow thumbnail genereerimiseks
try:
    from PIL import Image, ImageOps
    PILLOW_AVAILABLE = True
except ImportError:
    PILLOW_AVAILABLE = False
    print("Hoiatus: Pillow pole installitud. Thumbnail genereerimine ei tööta.")
    print("Installi: pip install Pillow")

# Thumbnaili seaded
THUMB_HEIGHT = 560  # Kõrgus pikslites (portree- ja topeltlehtedel ühtlane kõrgus)
THUMB_QUALITY = 85  # JPEG kvaliteet (0-100)

# =========================================================
# KONFIGURATSIOON
# =========================================================
PORT = 8001
DIRECTORY = BASE_DIR
# =========================================================


def get_first_image(work_path):
    """Leiab esimese pildi teose kataloogist (sorteeritud tähestikuliselt).

    Ignoreerib _thumb_*.jpg ja muud _ algusega faile.
    Toetab JPG ja PNG formaate.
    """
    all_images = []
    for ext in ("*.jpg", "*.png"):
        all_images.extend(glob.glob(os.path.join(work_path, ext)))

    # Filtreeri välja _ algusega failid (thumbnailid, metadata jne)
    images = [f for f in all_images if not os.path.basename(f).startswith('_')]

    if not images:
        return None

    # Sorteeri sequence välja järgi (kui olemas), muidu failinime järgi
    def sort_key(img_path):
        json_path = os.path.splitext(img_path)[0] + '.json'
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                seq = json.load(f).get('sequence')
            if seq is not None:
                return (0, int(seq), os.path.basename(img_path).lower())
        except Exception:
            pass
        return (1, 0, os.path.basename(img_path).lower())

    images.sort(key=sort_key)
    return images[0]


def generate_thumbnail(source_path, thumb_path, height=THUMB_HEIGHT):
    """Genereerib thumbnaili antud pildist.

    Skaleerib kõrguse järgi, et portree- ja topeltlehtedel oleks ühtlane
    vertikaalne resolutsioon. Topeltleht saab laiema thumbi (nt 800×560)
    selle asemel, et kokkusurutud kitsas riba (400×143).

    Args:
        source_path: Lähtefaili tee
        thumb_path: Sihtfaili tee (_thumb_XXXX.jpg)
        height: Thumbnaili kõrgus (laius arvutatakse proportsionaalselt)

    Returns:
        True kui õnnestus, False kui mitte
    """
    if not PILLOW_AVAILABLE:
        print(f"[THUMB] Pillow pole saadaval, ei saa genereerida: {thumb_path}")
        return False

    try:
        with Image.open(source_path) as img:
            # Rakenda EXIF orientatsioon enne skaleerimist (muidu thumb tuleb pööratud)
            img = ImageOps.exif_transpose(img)

            # Skaleerib kõrguse järgi — laius proportsionaalne
            ratio = height / img.height
            width = int(img.width * ratio)

            # Resize kasutades LANCZOS (parim kvaliteet)
            thumb = img.resize((width, height), Image.Resampling.LANCZOS)

            # Konverteeri RGB-ks (JPEG ei toeta alpha kanalit)
            if thumb.mode in ('RGBA', 'P'):
                thumb = thumb.convert('RGB')

            # Salvesta JPEG formaadis
            thumb.save(thumb_path, 'JPEG', quality=THUMB_QUALITY, optimize=True)

            # Sea õigused loetavaks
            os.chmod(thumb_path, 0o644)

            print(f"[THUMB] Genereeritud: {thumb_path}")
            return True
    except Exception as e:
        print(f"[THUMB] Viga genereerimisel {source_path}: {e}")
        return False


def get_or_create_thumbnail(work_path):
    """Tagastab teose esilehe thumbnaili tee, genereerides selle vajadusel.

    Thumbnailid salvestatakse _thumbs/ alamkataloogi (_thumb_NIMI.jpg).
    Kui esimene leht on muutunud, kustutab vana ja genereerib uue.

    Args:
        work_path: Teose kataloog

    Returns:
        Thumbnaili failitee või None kui genereerimine ebaõnnestus
    """
    # 1. Leia praegune esimene leht
    first_image = get_first_image(work_path)
    if not first_image:
        print(f"[THUMB] Kataloogis pole pilte: {work_path}")
        return None

    first_image_name = os.path.basename(first_image)
    thumb_base = os.path.splitext(first_image_name)[0]
    expected_thumb_name = f"_thumb_{thumb_base}.jpg"

    # Thumbnailid _thumbs/ alamkataloogis
    thumbs_dir = os.path.join(work_path, '_thumbs')
    expected_thumb_path = os.path.join(thumbs_dir, expected_thumb_name)

    # 2. Kustuta aegunud thumbnailid _thumbs/ kataloogist
    if os.path.exists(thumbs_dir):
        existing_thumbs = glob.glob(os.path.join(thumbs_dir, "_thumb_*.jpg"))
        for thumb in existing_thumbs:
            if thumb != expected_thumb_path:
                try:
                    os.remove(thumb)
                    print(f"[THUMB] Kustutatud aegunud: {thumb}")
                except OSError as e:
                    print(f"[THUMB] Viga kustutamisel {thumb}: {e}")

    # 3. Genereeri vajadusel
    if not os.path.exists(expected_thumb_path):
        os.makedirs(thumbs_dir, exist_ok=True)
        success = generate_thumbnail(first_image, expected_thumb_path)
        if not success:
            return None

    return expected_thumb_path


def get_or_create_page_thumbnail(work_path, thumb_filename):
    """Tagastab ühe lehekülje thumbnaili tee, genereerides selle vajadusel.

    Args:
        work_path: Teose kataloog
        thumb_filename: Thumbnaili failinimi (nt "_thumb_slug_pg_001.jpg")

    Returns:
        Thumbnaili failitee või None kui lähtefail puudub
    """
    thumbs_dir = os.path.join(work_path, '_thumbs')
    thumb_path = os.path.join(thumbs_dir, thumb_filename)

    if not os.path.exists(thumb_path):
        # Leia lähtefail: eemalda "_thumb_" prefiks
        source_filename = thumb_filename[len('_thumb_'):]
        source_path = os.path.join(work_path, source_filename)

        if not os.path.exists(source_path):
            return None

        os.makedirs(thumbs_dir, exist_ok=True)
        success = generate_thumbnail(source_path, thumb_path)
        if not success:
            return None

    return thumb_path


class ImageRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # CORS
        origin = self.headers.get('Origin')
        if origin and origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Credentials', 'true')

        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        # Cache 24h
        self.send_header('Cache-Control', 'public, max-age=86400')
        return super().end_headers()

    def do_GET(self):
        """Käsitleb GET päringuid, sh thumbnail päringuid."""
        # Parsi URL
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        parts = [p for p in path.split('/') if p]

        # Teose esilehe thumbnail: /{work_id}/_thumb
        if len(parts) == 2 and parts[1] == '_thumb':
            work_id = parts[0]
            self.serve_thumbnail(work_id)
            return

        # Lehekülje thumbnail: /{work_id}/_thumbs/_thumb_*.jpg
        if len(parts) == 3 and parts[1] == '_thumbs' and parts[2].startswith('_thumb_'):
            work_id = parts[0]
            thumb_filename = parts[2]
            self.serve_page_thumbnail(work_id, thumb_filename)
            return

        # Muu puhul: luba ainult pildifailid BASE_DIR sees
        resolved = self.translate_path(self.path)
        if not _is_safe_image_path(resolved, DIRECTORY):
            self.send_error(403, "Keelatud")
            return
        meta = _load_work_meta_for_path(resolved)
        work_id = (meta or {}).get('id', '')
        parsed = urllib.parse.urlparse(self.path)
        if not _check_image_access(work_id, meta, parsed.query):
            self.send_error(403, "Keelatud")
            return
        return super().do_GET()

    def serve_thumbnail(self, work_id):
        """Serveerib teose thumbnaili, genereerides selle vajadusel."""
        work_path = find_directory_by_id(work_id)
        if not work_path:
            self.send_error(404, f"Teost ei leitud: {work_id}")
            return

        meta_path = os.path.join(work_path, '_metadata.json')
        meta = None
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
        except Exception:
            pass
        parsed = urllib.parse.urlparse(self.path)
        if not _check_image_access(work_id, meta, parsed.query):
            self.send_error(403, "Keelatud")
            return

        # Saa või genereeri thumbnail
        thumb_path = get_or_create_thumbnail(work_path)
        if not thumb_path or not os.path.exists(thumb_path):
            self.send_error(404, "Thumbnaili ei õnnestunud luua")
            return

        # Serveeri fail
        try:
            with open(thumb_path, 'rb') as f:
                content = f.read()

            self.send_response(200)
            self.send_header('Content-Type', 'image/jpeg')
            self.send_header('Content-Length', len(content))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            print(f"[THUMB] Viga serveerimisel {thumb_path}: {e}")
            self.send_error(500, f"Viga faili lugemisel: {e}")

    def serve_page_thumbnail(self, work_id, thumb_filename):
        """Serveerib ühe lehekülje thumbnaili, genereerides selle vajadusel."""
        work_path = find_directory_by_id(work_id)
        if not work_path:
            self.send_error(404, f"Teost ei leitud: {work_id}")
            return

        meta_path = os.path.join(work_path, '_metadata.json')
        meta = None
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
        except Exception:
            pass
        parsed = urllib.parse.urlparse(self.path)
        if not _check_image_access(work_id, meta, parsed.query):
            self.send_error(403, "Keelatud")
            return

        thumb_path = get_or_create_page_thumbnail(work_path, thumb_filename)
        if not thumb_path or not os.path.exists(thumb_path):
            self.send_error(404, f"Lehekülge ei leitud: {thumb_filename}")
            return

        try:
            with open(thumb_path, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'image/jpeg')
            self.send_header('Content-Length', len(content))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            print(f"[THUMB] Viga serveerimisel {thumb_path}: {e}")
            self.send_error(500, f"Viga faili lugemisel: {e}")

    def translate_path(self, path):
        """
        Teisendab URL-i failisüsteemi teeks.
        Toetab NanoID lahendamist: /occgcn/pilt.jpg -> /1632-1/pilt.jpg
        """
        # Eemalda query string
        path = path.split('?', 1)[0]
        path = path.split('#', 1)[0]
        
        # Dekodeeri URL
        path = urllib.parse.unquote(path)
        
        # Normaliseeri path (eemalda algusest /)
        path = os.path.normpath(path)
        parts = path.split(os.sep)
        
        # Eemalda tühjad osad (nt alguses olev / tekitab tühja stringi)
        parts = [p for p in parts if p]
        
        if not parts:
            return os.path.join(DIRECTORY)

        # Esimene osa on potentsiaalne ID (work_id või slug)
        work_id_or_slug = parts[0]
        remaining_path = parts[1:] if len(parts) > 1 else []
        
        # Proovi leida kausta
        # 1. Kasuta utility funktsiooni (toetab cache'i ja nanoid-d)
        found_dir = find_directory_by_id(work_id_or_slug)
        
        if found_dir:
            return os.path.join(found_dir, *remaining_path)

        return DIRECTORY

class SafeThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """ThreadingHTTPServer parema exception handlinguga."""
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        """Logib vea ilma serverit crashimata."""
        import traceback
        print(f"[ERROR] Viga päringu töötlemisel kliendilt {client_address}:")
        traceback.print_exc()


print(f"Pildiserver käivitub pordil {PORT} (Multi-threaded)...")
print(f"Juurkaust: {DIRECTORY}")

# Ehita cache stardil (kriitiline NanoID toe jaoks)
try:
    build_work_id_cache()
except Exception as e:
    print(f"Viga cache ehitamisel: {e}")

if __name__ == '__main__':
    server = SafeThreadingHTTPServer(("", PORT), ImageRequestHandler)
    print("Pildiserver töötab.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nPildiserver peatatud.")
    server.server_close()