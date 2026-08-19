"""Tööriistade tekstiväljund.

Leheküljeviite reegel: kuvatakse ALATI mõlemad numbrid. Kui trükitud number on
teadmata, seda EI PAKUTA — vaikne oletus oleks halvem kui puuduv väli.
"""
from .query import DocRow

ZOTERO_LINK = "zotero://select/library/items/{key}"

# Alla selle osakaalu on tuvastatud numeratsioon pigem erand kui reegel.
OSALISE_LAVI = 0.5


def _perenimi(nimi: str) -> str:
    return nimi.split()[-1] if nimi else ""


def format_citation(doc: DocRow) -> str:
    loojad = ", ".join(_perenimi(n) for n, _ in doc.creators) or "(autorita)"
    aasta = doc.year or "s.a."
    return f"{loojad} {aasta}, {doc.title}"


def format_page_ref(printed: str | None, pdf: int) -> str:
    if printed is None:
        return f"PDF {pdf} (trükitud lehekülg teadmata)"
    return f"lk {printed} (PDF {pdf})"


def format_list(docs: list) -> str:
    if not docs:
        return ("Kogu on tühi. Lisa Zoteros kirjeid kollektsiooni ja jooksuta "
                "`vutt-library index`.")
    read = [f"Kogus on {len(docs)} teost.", ""]
    for d in docs:
        markused = []
        if d.page_mapping_source in (None, "none"):
            markused.append("trükitud numeratsioon teadmata")
        elif (d.page_mapping_source == "detected"
              and d.page_mapping_confidence < OSALISE_LAVI):
            # Ilma selleta paistab 400-leheline köide, millest tuvastati viis
            # lehte, loendis normaalselt kaardistatuna.
            markused.append(
                "trükitud numeratsioon tuvastatud osaliselt "
                f"({round(d.page_mapping_confidence * 100)}% lehtedest) — "
                "ülejäänule kasuta page_ref='pdf'")
        if d.file_missing:
            markused.append("algfail puudub")
        saba = f"  [{'; '.join(markused)}]" if markused else ""
        read.append(f"- {d.doc_id}  {format_citation(d)}  ({d.page_count} lk){saba}")
    return "\n".join(read)


def format_hits(hits: list, parent_keys: dict) -> str:
    if not hits:
        return (
            'Ei leidnud ühtki vastet.\n\n'
            'NB: kogu tekst pärineb skaneeringute OCR-ist, mis on kohati '
            'lagunenud (nt „M atthias" asemel „Matthias"). Tühi tulemus EI '
            'tõesta, et teemat pole käsitletud — proovi teist sõnastust või '
            'relax_matching=true.'
        )
    read = [f"Leidsin {len(hits)} vastet.", ""]
    for h in hits:
        link = ZOTERO_LINK.format(key=parent_keys.get(h.doc_id, ""))
        read += [
            f"### {format_citation(h.doc)} — {format_page_ref(h.printed_page, h.pdf_page)}",
            f"doc_id: {h.doc_id}  |  {link}",
            "",
            h.excerpt,
            "",
        ]
    return "\n".join(read)


def format_pages(doc: DocRow, rows: list, truncated: bool, parent_key: str) -> str:
    if not rows:
        return "Selles vahemikus ei ole indekseeritud lehti."
    esimene, viimane = rows[0], rows[-1]
    pais = [
        format_citation(doc),
        ZOTERO_LINK.format(key=parent_key),
        f"Vahemik: {format_page_ref(esimene.printed_page, esimene.pdf_page)} – "
        f"{format_page_ref(viimane.printed_page, viimane.pdf_page)}",
    ]
    if doc.file_missing:
        pais.append("HOIATUS: algfaili ei leia enam kettalt; tekst tuleb indeksist.")
    if truncated:
        pais.append(
            f"KÄRBITUD: tagastati {len(rows)} lehekülge. Jätka alates "
            f"PDF {viimane.pdf_page + 1}.")
    osad = ["\n".join(pais), ""]
    for r in rows:
        osad += [f"--- {format_page_ref(r.printed_page, r.pdf_page)} ---", r.text, ""]
    return "\n".join(osad)
