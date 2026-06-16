"""
Marginaalia-tägide normaliseerimine: teeb `<m>` alati VÄLIMISEKS tägiks real,
mis on tervikuna marginaalia-plokk.

Taust (2026-06-13): transkriptsioon/OCR toodab ristuvaid täge nagu
`<i><m>Ratio 3.</i></m>` või `<m><i>fine.</m></i>`. Editori parser
(findMarginaliaBlocks) ja otsing (split_marginalia) eeldavad, et `<m>` on rea
piiril ja inline-tägidest VÄLJASPOOL — muidu plokk ei renderdu ega indekseeru
(~1500 rida 4171-st). Normaliseerimine taandab kõik kuju `<m>...inline...</m>`-le.

KASUTUS (kõik kohad, kus marginaalia-tekst kirjutatakse või indekseeritakse):
- server/main.py /save — normaliseeri enne .txt kirjutamist
- server/meilisearch_ops.py + scripts/1-1_consolidate_data.py split_marginalia
- import_as_work (OCR import)
- scripts/migrate_marginalia_normalize.py — olemasolevate failide ühekordne migratsioon

JAGATUD MOODUL — ühine loogika mõlemale indekseerimisteele (vt MEMORY: kaks teed).
See moodul EI tohi importida FastAPI-t ega gitpython-it (standalone-skriptid
impordivad seda fake-package mustriga).
"""
import re

# Inline-vormindustägid, mis VÕIVAD <m> ümber/ristuda. EI sisalda 'm' ennast,
# ega widget-tägi 'fn'/'pb' (need ei esine marginaalia-real samamoodi).
_INLINE = r'(?:i|b|cs|hi|ann\d*)'

# Rida, mis on TERVIKUNA marginaalia: valikuline ws + inline-avatägid + <m> +
# sisu (ilma <m>/</m>-ta) + </m> + inline-sulgtägid + valikuline ws.
_LINE_RE = re.compile(
    r'^(\s*)'                          # 1: juhtiv ws
    r'((?:<' + _INLINE + r'>)*)'       # 2: inline-avatägid ENNE <m>
    r'<m>'
    r'((?:(?!</?m>).)*)'               # 3: sisu (ei sisalda <m> ega </m>)
    r'</m>'
    r'((?:</' + _INLINE + r'>)*)'      # 4: inline-sulgtägid PÄRAST </m>
    r'(\s*)$'                          # 5: lõpu ws
)


def _normalize_line(line: str) -> str:
    m = _LINE_RE.match(line)
    if not m:
        return line
    ws1, lead_opens, middle, trail_closes, ws2 = m.groups()
    # <m> välimiseks: avatägid liiguvad <m> SISSE (algusesse), sulgtägid </m> SISSE (lõppu)
    return f'{ws1}<m>{lead_opens}{middle}{trail_closes}</m>{ws2}'


# Tühje paaris-tage koristatakse komplektist (m + inline). EI sisalda 'ann\d*'
# (ID viitab andmetele), 'fn' (joonealuse viide) ega 'pb' (self-closing).
_EMPTY_RE = re.compile(r'<(m|i|b|cs|hi)>(\s*)</\1>')


def strip_empty_tags(text: str) -> str:
    """Eemaldab tühjad/ainult-tühikuga paaris-tagid (`<m></m>`, `<i></i>` jms).

    Kopeerimised/kustutused jätavad `.txt`-i tühje tage, mis ei renderdu, aga
    risustavad faili ja segavad mudeli treenimist. See koristab need.

    Reeglid (ettearvatav, deterministlik):
    - Komplekt: `m, i, b, cs, hi`. Puutumata: `ann\\d*`, `fn`, `pb`.
    - **Säilitab sisu, eemaldab ainult tagid:** `<i> </i>` → ` ` (mitte ``), nii ei
      kao kunagi nähtavat märki põhitekstis.
    - **Pesastatud püsipunktini:** `<m><i></i></m>` → `<m></m>` → ``.
    - Idempotentne.
    """
    if not text or '<' not in text:
        return text
    prev = None
    cur = text
    # Püsipunkt: pesastatud tühjad (<m><i></i></m>) vajavad mitut käiku.
    while prev != cur:
        prev = cur
        cur = _EMPTY_RE.sub(lambda m: m.group(2), cur)
    return cur


def normalize_marginalia_tags(text: str) -> str:
    """Teeb `<m>` välimiseks tägiks igal real, mis on tervikuna marginaalia, ja
    koristab tühjad tagid (`strip_empty_tags`).

    Idempotentne. Puutumata jäävad: puhtad plokid, rea-kesksed inline-`<m>`,
    mitmerealised plokid (kus `<m>`/`</m>` on eri ridadel), tavaline tekst.
    Reavahetused ja taanded säilivad täpselt.
    """
    if not text:
        return text
    if '<m>' in text:
        # Rea-kaupa, et säilitada täpsed reavahetused (sh lõpu-reavahetus).
        parts = text.split('\n')
        text = '\n'.join(_normalize_line(p) for p in parts)
    # Tühjade tagide koristus jookseb ALATI (ka inline-tühjad failides ilma <m>-ta).
    return strip_empty_tags(text)
