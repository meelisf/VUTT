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


# Tühi vastus kordub seansis kümneid kordi — iga rida maksab mudeli konteksti.
# Seepärast: staatiline õpetus elab tööriista kirjelduses (saadetakse korra),
# siin on ainult mõõdetud fakt. Kui ka fakti pole, on vastus üherealine.
POHJUSE_SILT = {
    "fraktur": "Fraktur-OCR: pikk s loetakse f-iks.",
    "ss": "Kogus esineb ß ja ss kõrvuti.",
    "lyhend": "Prefiksotsing algab tüvest — käänatud vorm jääb mööda.",
}


def format_empty(diags: list, *, relax: bool = False, doc_id=None) -> str:
    if not diags:
        return "Vastet ei ole."
    sonad = ", ".join(f"„{d.token}”" for d in diags)
    if all(not d.in_corpus and not d.soovitus for d in diags):
        return f"Vastet ei ole: kogus ei esine ühtki neist — {sonad}."

    ulatus = f"doc_id={doc_id}" if doc_id else "kogu kirjandus"
    reegel = "vähemalt üks sõna" if relax else "kõik sõnad samal leheküljel"
    read = [f"Vastet ei ole ({ulatus}; {reegel})."]
    for d in diags:
        arvud = (f"siin {d.in_doc}, kogus {d.in_corpus}" if d.in_doc is not None
                 else f"kogus {d.in_corpus}")
        rida = f"· {d.token} — {arvud}"
        if d.soovitus:
            # Lühendatud tüvi ei ole sõna, vaid prefiks — näita seda nii, nagu
            # mudel selle päringusse paneks (tokenizer viskab tärni ära).
            taht = "*" if d.soovitus_pohjus == "lyhend" else ""
            kus = "siin" if d.in_doc is not None else "kogus"
            rida += f" → „{d.soovitus}{taht}” {kus} {d.soovitus_vasteid}"
        read.append(rida)

    # Järjekord = kasulikkus. Kaks rida on lagi: kolmas kordaks juba öeldut.
    saba = [POHJUSE_SILT[p] for p in ("fraktur", "ss", "lyhend")
            if any(d.soovitus_pohjus == p for d in diags)][:1]
    if not relax and any((d.in_doc if d.in_doc is not None else d.in_corpus)
                         for d in diags):
        saba.append("Proovi relax_matching=true või vähem sõnu.")
    if doc_id and any(not d.in_doc and d.in_corpus for d in diags):
        saba.append("Mujal kogus on vasteid — jäta doc_id ära.")
    return "\n".join(read + saba[:2])


def format_hits(hits: list, parent_keys: dict) -> str:
    if not hits:
        return "Vastet ei ole."
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
