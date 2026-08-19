"""Sünteetilised fixture'id. EI TOHI kunagi puutuda omaniku päris Zoterot."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PREFIKS = "/api/users/0"


class FakeZoteroAPI:
    """Jäljendab Zotero Local API-t: pagineerimine, alamkollektsioonid, prügikast.

    collections:    [{"key": "K1", "data": {"name": "Kogu", "parentCollection": False}}]
    subcollections: {"K1": ["K2"]}
    items:          {"K1": [{"key": "I1", "data": {...}}]}
    """

    def __init__(self, collections=(), subcollections=None, items=None,
                 enabled=True):
        self.collections = list(collections)
        self.subcollections = subcollections or {}
        self.items = items or {}
        self.enabled = enabled
        self.server = None

    def __enter__(self):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                if not fake.enabled:
                    keha = b"Local API is not enabled"
                    self.send_response(200)
                    self.send_header("Content-Type", "text/plain")
                    self.send_header("Content-Length", str(len(keha)))
                    self.end_headers()
                    self.wfile.write(keha)
                    return
                url = urlparse(self.path)
                paring = parse_qs(url.query)
                tee = url.path[len(PREFIKS):] if url.path.startswith(PREFIKS) else url.path
                andmed = fake._route(tee)
                if andmed is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                algus = int(paring.get("start", ["0"])[0])
                limiit = int(paring.get("limit", ["50"])[0])
                tykk = andmed[algus:algus + limiit]
                keha = json.dumps(tykk).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Total-Results", str(len(andmed)))
                self.send_header("Content-Length", str(len(keha)))
                self.end_headers()
                self.wfile.write(keha)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        port = self.server.server_address[1]
        return f"http://127.0.0.1:{port}{PREFIKS}"

    def _route(self, tee):
        if tee == "/collections":
            return self.collections
        if tee.endswith("/collections") and tee.startswith("/collections/"):
            key = tee.split("/")[2]
            alamad = self.subcollections.get(key, [])
            return [c for c in self.collections if c["key"] in alamad]
        if tee.endswith("/items") and tee.startswith("/collections/"):
            return self.items.get(tee.split("/")[2], [])
        if tee == "/items/trash":
            return []
        return None

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()
        return False


def kollektsioon(key, nimi, parent=False):
    return {"key": key, "data": {"key": key, "name": nimi,
                                 "parentCollection": parent}}


def kirje(key, **data):
    data.setdefault("itemType", "book")
    return {"key": key, "data": {"key": key, **data}}


def manus(key, parent, *, link_mode="imported_file", filename=None, path=None,
          content_type="application/pdf", deleted=False):
    d = {"key": key, "itemType": "attachment", "parentItem": parent,
         "linkMode": link_mode, "contentType": content_type,
         "filename": filename, "path": path}
    if deleted:
        d["deleted"] = 1
    return {"key": key, "data": d}
