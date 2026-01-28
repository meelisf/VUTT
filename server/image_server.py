"""
Piltide serveerimise server.
Optimeeritud jõudluseks (threading, cache) ja turvalisuseks (CORS).
Toetab NanoID püsiviiteid.
"""
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

# =========================================================
# KONFIGURATSIOON
# =========================================================
PORT = 8001
DIRECTORY = BASE_DIR
# =========================================================

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