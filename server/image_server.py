"""
Piltide serveerimise server.
Optimeeritud jõudluseks (threading, cache) ja turvalisuseks (CORS).
"""
import http.server
import os
import sys

# Lisame server/ kausta pathi, et saaks importida config moodulit,
# kui skripti käivitatakse otse (mitte moodulina)
if __name__ == '__main__' and __package__ is None:
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = "server"

from .config import ALLOWED_ORIGINS

# =========================================================
# KONFIGURATSIOON
# =========================================================
PORT = 8001
# VUTT_DATA_DIR env variable allows overriding the path for Docker/Production
DEFAULT_DIR = "/home/mf/Dokumendid/LLM/tartu-acad/data/04_sorditud_dokumendid/"
DIRECTORY = os.getenv("VUTT_DATA_DIR", DEFAULT_DIR)
# =========================================================

class ImageRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # CORS: Luba ainult kindlad domeenid
        origin = self.headers.get('Origin')
        if origin and origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Credentials', 'true')
        
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        
        # Cache: Luba brauseril pilte hoida 24h (86400 sek)
        # See vähendab oluliselt serveri koormust lehe sirvimisel
        self.send_header('Cache-Control', 'public, max-age=86400')
        
        return super().end_headers()

    def translate_path(self, path):
        # Kindlustame, et serveerime failid õigest kaustast
        path = super().translate_path(path)
        rel_path = os.path.relpath(path, os.getcwd())
        return os.path.join(DIRECTORY, rel_path)

# Liigume õigesse kausta, et SimpleHTTPRequestHandler leiaks failid üles
if os.path.exists(DIRECTORY):
    os.chdir(DIRECTORY)
    print(f"Pildiserver: Juurkaust muudetud -> {DIRECTORY}")
else:
    print(f"Pildiserver HOIATUS: Kausta {DIRECTORY} ei leitud!")

print(f"Pildiserver käivitub pordil {PORT} (Multi-threaded)...")

# Kasutame ThreadingHTTPServer, et teenindada mitut päringut korraga
# See on kriitiline, kui lehel on palju pilte
if __name__ == '__main__':
    with http.server.ThreadingHTTPServer(("", PORT), ImageRequestHandler) as httpd:
        print("Pildiserver töötab. Katkestamiseks vajuta Ctrl+C.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass