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


def make_pdf(path, pages, labels=None):
    """Minimaalne PDF ilma väliste sõltuvusteta.

    pages: list[str] — iga lehe tekst (reavahetus = uus rida lehel).
    labels: [(lehe_indeks, stiil, algus)] — stiil 'r' (rooma väike),
            'D' (araabia), 'A' (suur täht). Nt [(0,'r',None), (12,'D',1)].
    """
    objs, n = {}, len(pages)
    kids = " ".join(f"{4 + 2 * i} 0 R" for i in range(n))
    pl = ""
    if labels:
        nums = " ".join(
            f"{idx} << /S /{style}" + (f" /St {start}" if start else "") + " >>"
            for idx, style, start in labels
        )
        pl = f" /PageLabels << /Nums [ {nums} ] >>"
    objs[1] = f"<< /Type /Catalog /Pages 2 0 R{pl} >>"
    objs[2] = f"<< /Type /Pages /Kids [ {kids} ] /Count {n} >>"
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    for i, text in enumerate(pages):
        lines = "".join(
            f"BT /F1 12 Tf 50 {700 - 15 * j} Td ({_esc(ln)}) Tj ET\n"
            for j, ln in enumerate(text.split("\n"))
        )
        objs[4 + 2 * i] = (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {5 + 2 * i} 0 R >>"
        )
        objs[5 + 2 * i] = ("STREAM", lines)

    out, offsets = bytearray(b"%PDF-1.4\n"), {}
    for num in sorted(objs):
        offsets[num] = len(out)
        body = objs[num]
        if isinstance(body, tuple):
            data = body[1].encode("latin-1")
            out += f"{num} 0 obj\n<< /Length {len(data)} >>\nstream\n".encode()
            out += data + b"\nendstream\nendobj\n"
        else:
            out += f"{num} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xref = len(out)
    top = max(objs) + 1
    out += f"xref\n0 {top}\n0000000000 65535 f \n".encode()
    for num in range(1, top):
        out += (f"{offsets[num]:010d} 00000 n \n".encode() if num in offsets
                else b"0000000000 65535 f \n")
    out += f"trailer\n<< /Size {top} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    Path(path).write_bytes(bytes(out))
    return Path(path)


def _esc(s):
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
