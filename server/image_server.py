import http.server
import socketserver
import os

# =========================================================
# KONFIGURATSIOON
# =========================================================
PORT = 8001
# VUTT_DATA_DIR env variable allows overriding the path for Docker/Production
DEFAULT_DIR = "/home/mf/Dokumendid/LLM/tartu-acad/data/04_sorditud_dokumendid/"
DIRECTORY = os.getenv("VUTT_DATA_DIR", DEFAULT_DIR)
# =========================================================

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        return super(CORSRequestHandler, self).end_headers()

    def translate_path(self, path):
        # Kindlustame, et serveerime failid õigest kaustast
        path = super().translate_path(path)
        rel_path = os.path.relpath(path, os.getcwd())
        return os.path.join(DIRECTORY, rel_path)

# Liigume õigesse kausta, et SimpleHTTPRequestHandler leiaks failid üles
# (alternatiiv translate_path muutmisele, töötab kindlamalt)
if os.path.exists(DIRECTORY):
    os.chdir(DIRECTORY)
    print(f"Juurkaust muudetud: {DIRECTORY}")
else:
    print(f"HOIATUS: Kausta {DIRECTORY} ei leitud!")

print(f"Pildiserver käivitub pordil {PORT}...")
# Luba aadressi taaskasutus (et ei peaks ootama kui restarti teed)
socketserver.TCPServer.allow_reuse_address = True

with socketserver.TCPServer(("", PORT), CORSRequestHandler) as httpd:
    print("Server töötab. Katkestamiseks vajuta Ctrl+C.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    httpd.server_close()