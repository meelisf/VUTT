"""
Piltide serveerimise server.
Optimeeritud jõudluseks (threading, cache) ja turvalisuseks (CORS).
Toetab NanoID püsiviiteid ja thumbnail genereerimist.
"""
import glob
import email.utils
import http.server
import json
import os
import shutil
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


def _load_work_meta_for_path(work_dir: str):
    """Laeb metaandmed ainult teose põhikataloogist."""
    meta_path = os.path.join(work_dir, '_metadata.json')
    if os.path.islink(meta_path):
        return None
    try:
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
        if (not isinstance(meta, dict) or
                not isinstance(meta.get('id'), str) or not meta['id'] or
                not isinstance(meta.get('collections', []), list) or
                any(not isinstance(col, str) or not col for col in meta.get('collections', [])) or
                not isinstance(meta.get('shareable', False), bool)):
            return None
        return meta
    except Exception:
        return None


def _check_image_access(work_id: str, meta, query_string: str) -> bool:
    """Kontrollib kas pildipäring on lubatud.
    Avalikud teosed läbivad alati. Piiratud teoste puhul valideeritakse HMAC token."""
    if meta is None:
        return False
    if is_work_public(meta) or meta.get('shareable', False):
        return True
    parsed_qs = urllib.parse.parse_qs(query_string)
    exp = parsed_qs.get('exp', [''])[0]
    sig = parsed_qs.get('sig', [''])[0]
    return _validate_image_token(work_id, exp, sig)


def _is_safe_image_path(resolved_path: str, base_dir: str) -> bool:
    """Kontrollib kas tee viitab lubatud pildifailile base_dir sees.
    Kaitseb mitte-pildifailide lekkimise ja symlink-põhise path traversal eest.
    """
    try:
        real_path = os.path.realpath(resolved_path)
        real_base = os.path.realpath(base_dir)
        if os.path.commonpath((real_path, real_base)) != real_base or real_path == real_base:
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
# Dashboardi kaanepilt on OMA variant, mis LÕIGATAKSE kaardi kastile (mitte ei
# skaleerita proportsionaalselt nagu leheküljethumb). Kaart (`WorkCard`, `h-40` +
# `object-cover`) on LAI kast ~320×160 CSS px, seega 640×320 katab Retina.
#
# MIKS crop, mitte kõrguse järgi skaleerimine: `object-cover` sobitab pildi kasti
# SUUREMA teguri järgi. Portreelehelt (2311×3448) andis kõrguse-põhine 360 px vaid
# 241 px laiust → kaart venitas seda 1,3× (Retinal 2,6×) ja kaas oli udune, samal ajal
# kui topeltleht (6118×4428) sai 497 px ja näis terav. Crop annab täpselt need pikslid,
# mida brauser kuvab: portreel kaob udu, topeltlehel kaob raisatud üla-/alaserv.
#
# Eraldi nimeruum (_cover_) hoiab selle leheküljethumbidest lahus — vt
# get_or_create_thumbnail koristusloogika.
COVER_BOX = (640, 320)
COVER_QUALITY = 78
COVER_VERSION = 2  # Muutmisel uueneb failinimi → vanad coverid genereeritakse ümber.
                   # NB: uuenda ka src/services/workImageService.ts COVER_VERSION-it,
                   # muidu näeb olemasolev kasutaja brauseri cache'ist vana pilti.
OG_IMAGE_SIZE = (1200, 630)
OG_IMAGE_QUALITY = 88
OG_IMAGE_VERSION = 2  # Muutmisel uueneb failinimi ja jagamis-URL-i cache-võti.

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


def generate_thumbnail(source_path, thumb_path, height=THUMB_HEIGHT, quality=THUMB_QUALITY):
    """Genereerib thumbnaili antud pildist.

    Skaleerib kõrguse järgi, et portree- ja topeltlehtedel oleks ühtlane
    vertikaalne resolutsioon. Topeltleht saab laiema thumbi (nt 800×560)
    selle asemel, et kokkusurutud kitsas riba (400×143).

    Args:
        source_path: Lähtefaili tee
        thumb_path: Sihtfaili tee (_thumb_XXXX.jpg)
        height: Thumbnaili kõrgus (laius arvutatakse proportsionaalselt)
        quality: JPEG kvaliteet

    NB: dashboardi kaas EI kasuta seda funktsiooni — vt generate_cover/COVER_BOX.

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
            thumb.save(thumb_path, 'JPEG', quality=quality, optimize=True)

            # Sea õigused loetavaks
            os.chmod(thumb_path, 0o644)

            print(f"[THUMB] Genereeritud: {thumb_path}")
            return True
    except Exception as e:
        print(f"[THUMB] Viga genereerimisel {source_path}: {e}")
        return False


def _generate_fitted_image(source_path, output_path, size, quality, log_tag):
    """Lõikab pildi täpselt etteantud kasti (nagu CSS ``object-cover``) ja salvestab.

    Kirjutus on atomaarne (tmp + ``os.replace``), sest pildiserver on mitmelõimeline —
    pooleliolevat faili ei tohi teisele päringule serveerida.
    """
    if not PILLOW_AVAILABLE:
        return False

    tmp_path = None
    try:
        with Image.open(source_path) as source:
            source = ImageOps.exif_transpose(source).convert('RGB')
            fitted = ImageOps.fit(
                source,
                size,
                method=Image.Resampling.LANCZOS,
                centering=(0.5, 0.5),
            )

        tmp_path = f"{output_path}.tmp.{os.getpid()}.{time.time_ns()}"
        fitted.save(tmp_path, 'JPEG', quality=quality, optimize=True)
        os.chmod(tmp_path, 0o644)
        os.replace(tmp_path, output_path)
        return True
    except Exception as e:
        print(f"[{log_tag}] Viga genereerimisel {source_path}: {e}")
        try:
            if tmp_path and os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
        return False


def generate_og_image(source_path, output_path):
    """Genereerib keele-neutraalse 1200×630 jagamispildi.

    Esileht täidab ala nagu dashboard'i CSS ``object-cover``. Teksti, gradienti
    ega märgendeid pilti ei lisata, sest sama URL-i jagatakse eri keeltes.
    """
    return _generate_fitted_image(source_path, output_path, OG_IMAGE_SIZE,
                                  OG_IMAGE_QUALITY, 'OG')


def generate_cover(source_path, cover_path):
    """Genereerib dashboardi kaanepildi — esileht lõigatuna kaardi kastile.

    EI kasuta ``generate_thumbnail``-i: see skaleerib kõrguse järgi, mis on õige
    leheküljegridile (ühtlane kõrgus), aga vale laiale kaardile — vt COVER_BOX.
    """
    return _generate_fitted_image(source_path, cover_path, COVER_BOX,
                                  COVER_QUALITY, 'THUMB')


def get_or_create_og_image(work_path):
    """Tagastab teose cache'itud jagamispildi, genereerides selle vajadusel."""
    first_image = get_first_image(work_path)
    if not first_image:
        return None

    image_base = os.path.splitext(os.path.basename(first_image))[0]
    thumbs_dir = os.path.join(work_path, '_thumbs')
    output_path = os.path.join(thumbs_dir, f'_og_v{OG_IMAGE_VERSION}_{image_base}.jpg')
    os.makedirs(thumbs_dir, exist_ok=True)

    for old_path in glob.glob(os.path.join(thumbs_dir, '_og_*.jpg')):
        if old_path != output_path:
            try:
                os.remove(old_path)
            except OSError:
                pass

    source_mtime = os.path.getmtime(first_image)
    stale = not os.path.exists(output_path) or os.path.getmtime(output_path) < source_mtime
    if stale and not generate_og_image(first_image, output_path):
        return None
    return output_path


def get_or_create_thumbnail(work_path):
    """Tagastab teose dashboardi-kaanepildi tee, genereerides selle vajadusel.

    Kaas on OMA variant (`_cover_v{N}_NIMI.jpg`, COVER_BOX/COVER_QUALITY), mitte
    leheküljegridi thumb. Nimeruum on tahtlikult eraldi: varem kandis kaas sama nime
    kui esilehe grid-thumb (`_thumb_NIMI.jpg`) ja alumine koristus glob'is `_thumb_*.jpg`,
    mistõttu iga dashboardi vaatamine kustutas KÕIK selle teose leheküljethumbid ja
    Workspace pidi need Pillow'ga uuesti genereerima.

    Args:
        work_path: Teose kataloog

    Returns:
        Kaanepildi failitee või None kui genereerimine ebaõnnestus
    """
    # 1. Leia praegune esimene leht
    first_image = get_first_image(work_path)
    if not first_image:
        print(f"[THUMB] Kataloogis pole pilte: {work_path}")
        return None

    first_image_name = os.path.basename(first_image)
    cover_base = os.path.splitext(first_image_name)[0]
    expected_cover_name = f"_cover_v{COVER_VERSION}_{cover_base}.jpg"

    # Kaanepildid _thumbs/ alamkataloogis, koos lehe-thumbidega, aga eri prefiksiga
    thumbs_dir = os.path.join(work_path, '_thumbs')
    expected_cover_path = os.path.join(thumbs_dir, expected_cover_name)

    # 2. Kustuta AINULT vananenud kaanepildid (muutunud esileht või vana versioon).
    #    EI TOHI glob'ida `_thumb_*.jpg` — need on leheküljegridi omad.
    if os.path.exists(thumbs_dir):
        for cover in glob.glob(os.path.join(thumbs_dir, "_cover_*.jpg")):
            if cover != expected_cover_path:
                try:
                    os.remove(cover)
                    print(f"[THUMB] Kustutatud aegunud kaas: {cover}")
                except OSError as e:
                    print(f"[THUMB] Viga kustutamisel {cover}: {e}")

    # 3. Genereeri vajadusel
    if not os.path.exists(expected_cover_path):
        os.makedirs(thumbs_dir, exist_ok=True)
        if not generate_cover(first_image, expected_cover_path):
            return None

    return expected_cover_path


def invalidate_cover(work_path, image_filename):
    """Kustuta selle lehepildi pealt tehtud kaanepilt, kui see on olemas.

    Kutsu KÕIGIS kohtades, kus lehepilti asendatakse või teisendatakse. Enne #178-t
    kandis kaas sama nime kui esilehe grid-thumb, seega thumbi kustutamine invalideeris
    kaane isetegevuslikult; nüüd on nimeruumid lahus ja seda tuleb teha selgesõnaliselt.
    """
    base = os.path.splitext(os.path.basename(image_filename))[0]
    thumbs_dir = os.path.join(work_path, '_thumbs')
    for cover in glob.glob(os.path.join(thumbs_dir, f"_cover_*_{base}.jpg")):
        try:
            os.remove(cover)
            print(f"[THUMB] Kaas invalideeritud: {cover}")
        except OSError as e:
            print(f"[THUMB] Viga kaane kustutamisel {cover}: {e}")


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
    def send_error(self, code, message=None, explain=None):
        self._cache_policy = 'no-store'
        return super().send_error(code, message, explain)

    def end_headers(self):
        # CORS
        origin = self.headers.get('Origin')
        if origin and origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Credentials', 'true')

        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        self.send_header('Cache-Control', getattr(self, '_cache_policy', 'no-store'))
        return super().end_headers()

    def do_GET(self):
        self._handle_image_request(head_only=False)

    def do_HEAD(self):
        self._handle_image_request(head_only=True)

    def _handle_image_request(self, head_only):
        """Kõik pilditeed läbivad sama teose, õiguste ja faili kontrolli."""
        self._cache_policy = 'no-store'
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        parts = [p for p in path.split('/') if p]
        if (not path.startswith('/') or not parts or
                parts[0].startswith(('.', '_')) or
                parts[0] in ('config', 'state') or
                any(p in ('.', '..') or '\\' in p or '\x00' in p for p in parts) or
                len(parts) > 3):
            self.send_error(403, "Keelatud")
            return

        work_dir = find_directory_by_id(parts[0])
        if not work_dir:
            self.send_error(404, "Teost ei leitud")
            return
        # ID-cache või slug ei tohi osutada andmejuurest välja ega alamkausta.
        work_name = os.path.basename(os.path.normpath(work_dir))
        if (work_name.startswith(('.', '_')) or work_name in ('config', 'state') or
                os.path.islink(work_dir) or
                os.path.dirname(os.path.realpath(work_dir)) != os.path.realpath(DIRECTORY)):
            self.send_error(403, "Keelatud")
            return
        meta = _load_work_meta_for_path(work_dir)
        if not meta or not _check_image_access(meta['id'], meta, parsed.query):
            self.send_error(403, "Keelatud")
            return
        self._cache_policy = ('public, max-age=0, must-revalidate'
                              if is_work_public(meta) else 'no-store')

        image_path = None
        if len(parts) == 2 and parts[1] in ('_thumb', '_og'):
            first_image = get_first_image(work_dir)
            thumbs_dir = os.path.join(work_dir, '_thumbs')
            if not first_image:
                self.send_error(404, "Pilti ei leitud")
                return
            if (not _is_safe_image_path(first_image, work_dir) or
                    not _is_safe_image_path(os.path.join(thumbs_dir, 'check.jpg'), work_dir)):
                self.send_error(403, "Keelatud")
                return
            image_path = (get_or_create_thumbnail(work_dir) if parts[1] == '_thumb'
                          else get_or_create_og_image(work_dir))
        elif (len(parts) == 3 and parts[1] == '_thumbs' and
              parts[2].startswith('_thumb_') and
              not parts[2][len('_thumb_'):].startswith(('.', '_')) and
              os.path.splitext(parts[2])[1].lower() in _ALLOWED_IMAGE_EXTENSIONS):
            source = os.path.join(work_dir, parts[2][len('_thumb_'):])
            output = os.path.join(work_dir, '_thumbs', parts[2])
            if (not _is_safe_image_path(source, work_dir) or
                    not _is_safe_image_path(output, work_dir)):
                self.send_error(403, "Keelatud")
                return
            image_path = get_or_create_page_thumbnail(work_dir, parts[2])
        elif len(parts) == 2 and not parts[1].startswith(('_', '.')):
            image_path = os.path.join(work_dir, parts[1])
        else:
            self.send_error(403, "Keelatud")
            return
        if not image_path:
            self.send_error(404, "Pilti ei leitud")
            return
        self._send_image_file(image_path, work_dir, head_only)

    def _send_image_file(self, image_path, work_dir, head_only):
        if not _is_safe_image_path(image_path, work_dir):
            self.send_error(403, "Keelatud")
            return
        try:
            with open(image_path, 'rb') as image_file:
                stat = os.fstat(image_file.fileno())
                modified_since = self.headers.get('If-Modified-Since')
                if modified_since and not self.headers.get('If-None-Match'):
                    try:
                        modified_at = email.utils.parsedate_to_datetime(modified_since)
                        if (modified_at.tzinfo is not None and
                                int(stat.st_mtime) <= int(modified_at.timestamp())):
                            self.send_response(304)
                            self.send_header('Last-Modified', self.date_time_string(stat.st_mtime))
                            self.end_headers()
                            return
                    except (ValueError, TypeError, OverflowError):
                        pass
                self.send_response(200)
                content_type = ('image/jpeg' if os.path.basename(os.path.dirname(image_path)) == '_thumbs'
                                else self.guess_type(image_path))
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(stat.st_size))
                self.send_header('Last-Modified', self.date_time_string(stat.st_mtime))
                self.end_headers()
                if not head_only:
                    shutil.copyfileobj(image_file, self.wfile)
        except FileNotFoundError:
            self.send_error(404, "Pilti ei leitud")
        except OSError as e:
            print(f"[IMAGE] Viga serveerimisel {image_path}: {e}")
            self.send_error(500, "Pilti ei õnnestunud lugeda")

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
