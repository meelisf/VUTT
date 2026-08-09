#!/usr/bin/env python3
"""Leiab OCR-i lagunemised (loobid) ja teeb klikitava HTML-raporti (#227).

EI muuda ühtegi faili — ainult loeb korpuse läbi ja kirjutab raporti.

Kasutus serveris (andmed elavad seal):
  cd ~/VUTT && .venv/bin/python3 scripts/find_ocr_loops.py
  cd ~/VUTT && .venv/bin/python3 scripts/find_ocr_loops.py --min-reps 20

Raport avaneb brauseris: iga rida on link lehele, mille saab ükshaaval üle
käia. Linnukesed püsivad `localStorage`-is, nii et poolelijäänud läbivaatust
saab hiljem jätkata.

NB: re-OCR ei ole siin üldiselt lahendus — sama viga kordub, sest materjal
(vilets käekiri, halb skann) on mudelile raskesti loetav. Raport on triaaži-
nimekiri käsitsi läbivaatuseks.

Andmejuur tuleb ``VUTT_DATA_DIR`` muutujast (Dockeris ``/data``).
"""
import argparse
import html
import json
import os
import sys
import types
from collections import defaultdict

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if "server" not in sys.modules:
    _server_pkg = types.ModuleType("server")
    _server_pkg.__path__ = [os.path.join(_PROJECT_ROOT, "server")]
    _server_pkg.__package__ = "server"
    sys.modules.setdefault("server", _server_pkg)
sys.path.insert(0, _PROJECT_ROOT)

from server.meili_doc import enumerate_page_images          # noqa: E402
from server.ocr_loop_audit import find_repeat_loop          # noqa: E402

DATA_ROOT = os.getenv("VUTT_DATA_DIR", os.path.join(_PROJECT_ROOT, "data"))
DEFAULT_BASE_URL = "https://vutt.utlib.ut.ee"

# Pikkuse-vihje: loopinud lehe mediaan on 1364 tokenit, puhta oma 281.
# Laeni jookseb ainult pool loopidest, seega see on KINDLUSE VIHJE, mitte kriteerium.
CAP_HINT_TOKENS = 1300


def scan(data_root, min_reps, max_period):
    """Käib korpuse läbi. Tagastab {work_key: (meta, [leiud])}."""
    works = {}
    for entry in sorted(os.listdir(data_root)):
        work_dir = os.path.join(data_root, entry)
        if not os.path.isdir(work_dir) or entry in (".git", "config"):
            continue
        meta_path = os.path.join(work_dir, "_metadata.json")
        if not os.path.exists(meta_path):
            continue
        try:
            with open(meta_path, encoding="utf-8") as fh:
                meta = json.load(fh)
        except Exception:
            continue
        work_id = meta.get("id")
        if not work_id:
            continue

        hits = []
        # Sama numeratsioon, mida kasutavad indekseerija ja bot-prerender —
        # nii ei saa raporti lingid lehenumbritest lahku minna.
        for page_index, img_name in enumerate(enumerate_page_images(work_dir)):
            txt_path = os.path.join(work_dir, os.path.splitext(img_name)[0] + ".txt")
            if not os.path.exists(txt_path):
                continue
            try:
                with open(txt_path, encoding="utf-8") as fh:
                    text = fh.read()
            except Exception:
                continue
            loop = find_repeat_loop(text, min_reps=min_reps, max_period=max_period)
            if loop:
                loop["page"] = page_index + 1
                hits.append(loop)

        if hits:
            works[entry] = ({
                "work_id": work_id,
                "title": meta.get("title") or entry,
                "year": meta.get("year") or "",
            }, hits)
    return works


def render_html(works, base_url, min_reps, total_pages_scanned):
    e = html.escape
    total_hits = sum(len(h) for _, h in works.values())
    ordered = sorted(works.items(), key=lambda kv: -len(kv[1][1]))

    rows = []
    for _, (meta, hits) in ordered:
        rows.append(
            f'<section><h2>{e(str(meta["title"]))}'
            f'<span class="meta">{e(str(meta["year"]))} · {e(meta["work_id"])} · '
            f'{len(hits)} lehte</span></h2><table>'
        )
        for h in sorted(hits, key=lambda x: x["page"]):
            url = f'{base_url}/work/{meta["work_id"]}/{h["page"]}'
            cap = ' <span class="cap">laeni</span>' if h["tokens"] >= CAP_HINT_TOKENS else ""
            pattern = h["pattern"]
            if len(pattern) > 60:
                pattern = pattern[:60] + "…"
            rows.append(
                f'<tr data-key="{e(url)}">'
                f'<td class="c"><input type="checkbox"></td>'
                f'<td><a href="{e(url)}" target="_blank" rel="noopener">lk {h["page"]}</a></td>'
                f'<td class="n">{h["reps"]}×</td>'
                f'<td class="n">per {h["period"]}</td>'
                f'<td class="n">{h["tokens"]} tok{cap}</td>'
                f'<td class="n">{round(h["cover"] * 100)}%</td>'
                f'<td class="p">{e(pattern)}</td>'
                f'</tr>'
            )
        rows.append("</table></section>")

    return f"""<!doctype html>
<html lang="et"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OCR-i loobid — {total_hits} lehte</title>
<style>
 :root {{ color-scheme: light dark; }}
 body {{ font: 15px/1.5 system-ui, sans-serif; margin: 0 auto; padding: 1.5rem;
        max-width: 60rem; background: #fbfbfa; color: #1a1a1a; }}
 h1 {{ font-size: 1.4rem; margin: 0 0 .3rem; }}
 .lead {{ color: #666; margin: 0 0 1.5rem; }}
 .bar {{ position: sticky; top: 0; background: #fbfbfa; padding: .6rem 0;
        border-bottom: 1px solid #ddd; margin-bottom: 1rem; font-weight: 600; }}
 h2 {{ font-size: 1rem; margin: 1.6rem 0 .4rem; }}
 .meta {{ font-weight: 400; color: #777; margin-left: .6rem; font-size: .85rem; }}
 table {{ border-collapse: collapse; width: 100%; }}
 td {{ padding: .25rem .5rem; border-bottom: 1px solid #eee; vertical-align: top; }}
 .c {{ width: 1.6rem; }}
 .n {{ color: #555; font-variant-numeric: tabular-nums; white-space: nowrap;
       font-size: .85rem; }}
 .p {{ font-family: ui-monospace, monospace; font-size: .8rem; color: #444;
       word-break: break-all; }}
 .cap {{ background: #fde68a; padding: 0 .3rem; border-radius: 3px; font-size: .75rem; }}
 tr.done {{ opacity: .38; }}
 tr.done a {{ text-decoration: line-through; }}
 a {{ color: #1d4ed8; }}
 @media (prefers-color-scheme: dark) {{
   body {{ background: #16161a; color: #e8e8ea; }}
   .bar {{ background: #16161a; border-color: #333; }}
   td {{ border-color: #2a2a30; }}
   .lead, .meta, .n, .p {{ color: #9a9aa2; }}
   .cap {{ background: #78350f; color: #fde68a; }}
   a {{ color: #93b4ff; }}
 }}
</style></head><body>
<h1>OCR-i loobid</h1>
<p class="lead">{total_hits} lehte {len(works)} teoses · läbi vaadatud {total_pages_scanned} lehekülge ·
lävi: sama muster kordub järjest ≥{min_reps} korda.
„laeni" = leht on ≥{CAP_HINT_TOKENS} tokenit, mis viitab sellele, et mudel kordas kuni väljundilaeni.</p>
<div class="bar"><span id="progress"></span></div>
{"".join(rows)}
<script>
 const KEY = 'vutt_ocr_loops_done';
 const done = new Set(JSON.parse(localStorage.getItem(KEY) || '[]'));
 const rows = [...document.querySelectorAll('tr[data-key]')];
 const save = () => localStorage.setItem(KEY, JSON.stringify([...done]));
 const paint = () => {{
   document.getElementById('progress').textContent =
     `${{done.size}} / ${{rows.length}} üle vaadatud`;
 }};
 for (const tr of rows) {{
   const box = tr.querySelector('input');
   const k = tr.dataset.key;
   if (done.has(k)) {{ box.checked = true; tr.classList.add('done'); }}
   box.addEventListener('change', () => {{
     box.checked ? done.add(k) : done.delete(k);
     tr.classList.toggle('done', box.checked);
     save(); paint();
   }});
 }}
 paint();
</script>
</body></html>"""


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--min-reps", type=int, default=10,
                    help="mitu korda peab muster järjest korduma (vaikimisi 10)")
    ap.add_argument("--max-period", type=int, default=5,
                    help="pikim otsitav mustri periood tokenites (vaikimisi 5)")
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL)
    ap.add_argument("--out", default=os.path.join(_PROJECT_ROOT, "output", "ocr_loops.html"))
    args = ap.parse_args()

    print(f"Loen korpust: {DATA_ROOT}")
    works = scan(DATA_ROOT, args.min_reps, args.max_period)
    total_hits = sum(len(h) for _, h in works.values())

    scanned = 0
    for entry in os.listdir(DATA_ROOT):
        d = os.path.join(DATA_ROOT, entry)
        if os.path.isdir(d) and entry not in (".git", "config"):
            scanned += len(enumerate_page_images(d))

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(render_html(works, args.base_url.rstrip("/"), args.min_reps, scanned))

    print(f"\nLeitud {total_hits} lehte {len(works)} teoses (vaadatud {scanned} lehekülge).")
    for _, (meta, hits) in sorted(works.items(), key=lambda kv: -len(kv[1][1]))[:10]:
        print(f"  {len(hits):4} lk  {meta['work_id']}  {str(meta['title'])[:60]}")
    print(f"\nRaport: {args.out}")


if __name__ == "__main__":
    main()
