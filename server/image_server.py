"""
Piltide serveerimise server.
Optimeeritud jõudluseks (threading, cache) ja turvalisuseks (CORS).
Toetab NanoID püsiviiteid ja thumbnail genereerimist.
"""
import glob
import http.server
import os
import socketserver
import sys
import urllib.parse

# Lisame server/ kausta pathi
if __name__ == '__main__' and __package__ is None:
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = "server"

from .config import ALLOWED_ORIGINS, BASE_DIR
from .utils import find_directory_by_id, build_work_id_cache

# Pillow thumbnail genereerimiseks
try:
    from PIL import Image
    PILLOW_AVAILABLE = True
except ImportError:
    PILLOW_AVAILABLE = False
    print("Hoiatus: Pillow pole installitud. Thumbnail genereerimine ei tööta.")
    print("Installi: pip install Pillow")

# Thumbnaili seaded
THUMB_WIDTH = 400  # Laius pikslites
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
    """
    pattern = os.path.join(work_path, "*.jpg")
    all_images = glob.glob(pattern)

    # Filtreeri välja _ algusega failid (thumbnailid, metadata jne)
    images = [f for f in all_images if not os.path.basename(f).startswith('_')]

    if not images:
        return None

    # Sorteeri failinime järgi
    images.sort(key=lambda x: os.path.basename(x).lower())
    return images[0]


def generate_thumbnail(source_path, thumb_path, width=THUMB_WIDTH):
    """Genereerib thumbnaili antud pildist.

    Args:
        source_path: Lähtefaili tee
        thumb_path: Sihtfaili tee (_thumb_XXXX.jpg)
        width: Thumbnaili laius (kõrgus arvutatakse proportsionaalselt)

    Returns:
        True kui õnnestus, False kui mitte
    """
    if not PILLOW_AVAILABLE:
        print(f"[THUMB] Pillow pole saadaval, ei saa genereerida: {thumb_path}")
        return False

    try:
        with Image.open(source_path) as img:
            # Arvuta proportsioon
            ratio = width / img.width
            height = int(img.height * ratio)

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
    """Tagastab thumbnaili tee, genereerides selle vajadusel.

    Valideerib, et olemasolev thumbnail vastab praegusele esimesele lehele.
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

    first_image_name = os.path.basename(first_image)  # nt "0001.jpg"
    expected_thumb_name = f"_thumb_{first_image_name}"
    expected_thumb_path = os.path.join(work_path, expected_thumb_name)

    # 2. Leia olemasolevad thumbnailid
    existing_thumbs = glob.glob(os.path.join(work_path, "_thumb_*.jpg"))

    # 3. Kustuta vale lähtefailiga thumbnailid
    for thumb in existing_thumbs:
        if thumb != expected_thumb_path:
            try:
                os.remove(thumb)
                print(f"[THUMB] Kustutatud aegunud: {thumb}")
            except OSError as e:
                print(f"[THUMB] Viga kustutamisel {thumb}: {e}")

    # 4. Genereeri vajadusel
    if not os.path.exists(expected_thumb_path):
        success = generate_thumbnail(first_image, expected_thumb_path)
        if not success:
            # Fallback: tagasta originaalpilt
            return first_image

    return expected_thumb_path


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

        # Kontrolli, kas see on thumbnail päring: /{work_id}/_thumb
        if len(parts) == 2 and parts[1] == '_thumb':
            work_id = parts[0]
            self.serve_thumbnail(work_id)
            return

        # Muu puhul kasuta vaikimisi käitumist
        return super().do_GET()

    def serve_thumbnail(self, work_id):
        """Serveerib teose thumbnaili, genereerides selle vajadusel."""
        # Leia teose kataloog
        work_path = find_directory_by_id(work_id)
        if not work_path:
            self.send_error(404, f"Teost ei leitud: {work_id}")
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
            # Kui leidsime kausta, liidame ülejäänud failinime
            return os.path.join(found_dir, *remaining_path)
        
        # Fallback: Kui ei leidnud ID järgi, äkki on otse kaustanimi?
        # See on vajalik SimpleHTTPRequestHandleri vaikimisi käitumise säilitamiseks
        # (juhul kui find_directory_by_id mingil põhjusel ei leia)
        return os.path.join(DIRECTORY, *parts)

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