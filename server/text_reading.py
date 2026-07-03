"""Neutraalne teksti-lugemise moodul bot-prerenderi ja sitemapi jaoks.

Sõltub AINULT stdlibist + server.meili_doc puhtast osast (enumerate_page_images,
clean_text_for_search, _clean_search_text). metadata_handler impordib SIIT, MITTE
meilisearch_ops-ist (raske: ThreadPoolExecutor, git_ops).
"""
import os
import json

from .meili_doc import (
    enumerate_page_images,
    clean_text_for_search,   # re-export
    _clean_search_text,      # re-export
)

__all__ = [
    "read_work_page_texts",
    "work_latest_mtime",
    "clean_text_for_search",
    "_clean_search_text",
]


def read_work_page_texts(work_path):
    """Loeb teose lehtede toore teksti järjekorras.

    Tagastab [(page_num, raw_text)]. `.txt` on autoriteet, lehe `.json`
    `text_content` on fallback (sama reegel nagu indekseerijal).
    """
    pages = []
    for idx, img_name in enumerate(enumerate_page_images(work_path)):
        page_num = idx + 1
        base = os.path.splitext(img_name)[0]
        raw = ""
        txt_path = os.path.join(work_path, base + '.txt')
        if os.path.exists(txt_path):
            try:
                with open(txt_path, 'r', encoding='utf-8') as f:
                    raw = f.read()
            except Exception:
                pass
        if not raw:
            jp = os.path.join(work_path, base + '.json')
            if os.path.exists(jp):
                try:
                    with open(jp, 'r', encoding='utf-8') as jf:
                        d = json.load(jf)
                        raw = d.get('text_content', '') or ''
                except Exception:
                    pass
        pages.append((page_num, raw))
    return pages


def work_latest_mtime(work_path):
    """max mtime üle `_metadata.json` + lehtede `.txt`/`.json` failide.

    Kasutatakse NII sitemap `lastmod` KUI bot-HTML cache-võtme jaoks — nii et
    teksti- VÕI bibliograafiamuudatus värskendab mõlemat.
    """
    latest = 0.0
    meta = os.path.join(work_path, '_metadata.json')
    if os.path.exists(meta):
        try:
            latest = os.path.getmtime(meta)
        except OSError:
            pass
    try:
        for name in os.listdir(work_path):
            if name.startswith('_'):
                continue
            if name.endswith('.txt') or name.endswith('.json'):
                try:
                    latest = max(latest, os.path.getmtime(os.path.join(work_path, name)))
                except OSError:
                    pass
    except OSError:
        pass
    return latest
