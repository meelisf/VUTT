"""OCR-juhised Gemini-teele.

TRÜKISE juhis on KOOPIA LOSSi failist `~/Dokumendid/LLM/qwen3.5/scripts/prompt.py`
(`INSTRUCTION`). Kopeeritud 2026-09-01, lähtefaili mtime 2026-08-18 15:06:06 +0300.
See on trükisel PARITEEDINÕUE: sama teost transkribeeritakse mõlema pakkujaga ja
tulemused peavad olema samas märgenduses. LOSSi juhise muutmisel tuleb see üle vaadata.

KÄSIKIRJA juhis on lähtekohana sama faili `KURRENT_INSTRUCTION`, aga TOHIB LOSS-ist
lahkneda ja seda arendatakse edasi siin. Põhjus on mudeliklass: `KURRENT_INSTRUCTION`
on fine-tuunitud mudeli TREENINGVORM (mudel tahab täpselt seda stringi), Gemini on
üldmudel, kellele juhis on ainus info. Käsikirja juhise triiv on ootuspärane, mitte viga.

Automaatset valvurit LOSSi vastu ei ole — LOSS ei ole VUTT-i jaoks runtime'is loetav.
"""
import re

GEMINI_PRINT_INSTRUCTION = """You are an expert OCR assistant for historical documents. Transcribe the page using VUTT XML markup.

Instructions:
1. Transcribe the entire page from the provided image.
2. Preserve original line breaks and hyphenation:
   - Antiqua hyphenation: - (regular hyphen), e.g. coa-cervare
   - Fraktur/Gothic hyphenation: ⸗ (double hyphen), e.g. Ge⸗witter
3. Do not translate; keep the original language (Latin, Greek, German, Estonian, etc.).
4. Ligatures:
   - æ, Æ, œ, Œ – transcribe exactly as they are
   - st, ff, fi, fl and other typographic ligatures – write out as separate letters
5. Umlauts and diacritics:
   - ö, ä, ü, õ – always use modern form
   - uͤ, oͤ, aͤ (letter + superscript e) – transcribe as ü, ö, ä
   - å, Å (Swedish) – keep as is
   - ũ, ñ, õ – keep as is (tilde preserved)
6. Special characters:
   - ſ (long s) – transcribe as ſ
   - ß (double s) – transcribe as ß
7. Abbreviations:
   - que abbreviation (ꝗ etc.) – write as q;
   - -us abbreviation (ꝰ) – may be expanded
8. Formatting (VUTT XML tags):
   - Italic text: <i>text</i>
   - Bold text: <b>text</b>
   - Code-switching (Fraktur word in Antiqua text or vice versa): <cs>text</cs>
9. Page breaks: if the image contains a double-page spread, mark the page break with <pb/>.
10. Marginal notes: place each marginal note inline at the position in the text where it appears,
   using <m>text</m> tags. Each line of a multi-line marginal note is a separate <m> tag.
   If there are no marginal notes, omit entirely.
   Example:
     main text line 1
     <m>Chrysost.</m>
     <m>tom: 3. in</m>
     <m>Evang: Io-</m>
     main text line 2
11. Footnote number references in running text: <fn>1</fn>
12. Musical notation: if the page contains printed music (staves, notes), do not attempt
   to transcribe it – place a single <noodid> marker at that position and continue with
   the surrounding text.
13. Signature marks (quire numbers): place at the very end, e.g. A 3

Blank pages: if the page has no text on it at all (blank leaf, blank verso, endpaper),
return exactly this single line and nothing else:
[tühi lehekülg]
Do not describe the page, do not invent text, do not repeat text from other pages.
A page that carries only a page number, a signature mark, a stamp or an ink stain is
NOT blank – transcribe it normally.

Sparse pages: pages are not always full of text. A page may carry only a page number,
a heading, a colophon, a few closing lines, or a single word. Transcribe exactly what
is on the page and then stop. Never pad a sparse page with invented text, and never
continue with text from another page in order to fill it.

Return only the exact transcription as plain text with VUTT XML markup."""

GEMINI_HAND_INSTRUCTION = """You are an expert transcriber of historical handwritten documents. Transcribe the handwritten text on this page.

Instructions:
1. Transcribe all handwritten text exactly as written, preserving original spelling and line breaks.
2. Language may be German, Swedish, Latin, or other historical languages — do not translate.
3. Hyphenation at line breaks: use ¬ (the character used in the manuscript) if a word continues on the next line, e.g. Pfar¬\nrer
4. Special characters:
   - ſ (long s) – transcribe as ſ
   - ß (double s) – transcribe as ß
   - ä, ö, ü, å – transcribe as written
5. Preserve original capitalization and punctuation.
6. If the page contains two columns or two halves, transcribe left side first, then right side.
7. Do not add any XML tags, markdown, or formatting — plain text only.

Blank pages: if the page has no writing on it at all (blank leaf, blank verso, endpaper),
return exactly this single line and nothing else:
[tühi lehekülg]
Do not describe the page, do not invent text, do not repeat text from other pages.
A page that carries only a page number, an archival stamp or an ink stain is NOT blank –
transcribe what is there.

Sparse pages: pages are not always full of writing. A page may carry only a page number,
a heading, a date, a signature, or a few closing lines. Transcribe exactly what is on the
page and then stop. Never pad a sparse page with invented text, and never continue with
text from another page in order to fill it.

Return only the transcription."""

_INSTRUCTIONS = {
    "print": GEMINI_PRINT_INSTRUCTION,
    "hand": GEMINI_HAND_INSTRUCTION,
}


def instruction_for(material_type: str) -> str:
    """Juhis materjalitüübi järgi. Tundmatu tüüp on VIGA, mitte vaikne vaikeväärtus."""
    try:
        return _INSTRUCTIONS[material_type]
    except KeyError:
        raise ValueError("Tundmatu materjalitüüp: {!r}".format(material_type))


_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)
_FENCE_OPEN_RE = re.compile(r"^```[a-zA-Z]*\n?")
_FENCE_CLOSE_RE = re.compile(r"\n?```$")


def strip_model_output(text: str) -> str:
    """Eemaldab mudeli süsteemiartefaktid: <think>-plokid ja markdown-koodipiirded.

    Sisemist reastruktuuri EI puudutata — sedelkataloogi kirje read on sisu.
    `[tühi lehekülg]` on kokkulepitud märgend ja jääb alles (LOSS käitub samamoodi).
    """
    text = _THINK_RE.sub("", text)
    text = _FENCE_OPEN_RE.sub("", text.strip())
    text = _FENCE_CLOSE_RE.sub("", text)
    return text.strip()
