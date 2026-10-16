"""Kuivkäivitus (#630): kas lehe tähistuse samm muudab korpuse otsinguteksti?

Keegi ei ole veel märgendanud, seega PEAB tulemus olema 0 erinevat lehte. Iga
erinevus tähendab, et samm puudutab midagi muud (nt sõnasõnaline `<fw>` tekstis).
Ainult lugemine. Käivita serveris host-venviga:
    cd ~/VUTT && .venv/bin/python scripts/dryrun_page_marks_search.py
"""
import glob
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from server.config import BASE_DIR  # noqa: E402
from server.meili_doc import clean_text_for_search  # noqa: E402
from server.vutt_tags import PAGE_MARK_KINDS, remove_page_marks  # noqa: E402


def main():
    pages = erinev = tahisega = 0
    for path in glob.glob(os.path.join(BASE_DIR, "*", "*.txt")):
        if os.path.basename(os.path.dirname(path)).startswith((".", "_")):
            continue
        with open(path, encoding="utf-8") as f:
            text = f.read()
        pages += 1
        if any(f"<{k}>" in text for k in PAGE_MARK_KINDS):
            tahisega += 1
        if remove_page_marks(text) != text:
            erinev += 1
            print("ERINEB:", path)
    print(f"lehti {pages}, tähistusega {tahisega}, otsingutekst erineb {erinev}")
    # Kontroll, et uus funktsioon ei viska ühelgi lehel
    for path in glob.glob(os.path.join(BASE_DIR, "*", "*.txt"))[:2000]:
        with open(path, encoding="utf-8") as f:
            clean_text_for_search(f.read())
    sys.exit(1 if erinev else 0)


if __name__ == "__main__":
    main()
