"""Marginaalia märgenduse ainult-lugemiseks mõeldud audit.

Moodul ei paranda teksti. Seda kasutab ``scripts/audit_marginalia_markup.py``, et
enne andmemigratsiooni kaardistada pesastatud, tasakaalustamata, mitmerealised,
rea-kesksed ja teiste VUTT-tägidega ristuvad ``<m>`` paarid.
"""
from dataclasses import dataclass
import re


_M_TAG_RE = re.compile(r"<(/?)m>")
_VUTT_PAIR_TAG_RE = re.compile(r"<(/?)(m|i|b|cs|hi|ann\d*)>")


@dataclass(frozen=True)
class MarginaliaFinding:
    kind: str
    line: int
    excerpt: str


def _line_and_excerpt(text: str, pos: int) -> tuple[int, str]:
    line = text.count("\n", 0, pos) + 1
    start = text.rfind("\n", 0, pos) + 1
    end = text.find("\n", pos)
    if end == -1:
        end = len(text)
    excerpt = text[start:end].strip()
    if len(excerpt) > 180:
        excerpt = excerpt[:177] + "..."
    return line, excerpt


def _finding(text: str, pos: int, kind: str) -> MarginaliaFinding:
    line, excerpt = _line_and_excerpt(text, pos)
    return MarginaliaFinding(kind=kind, line=line, excerpt=excerpt)


def audit_marginalia(text: str) -> list[MarginaliaFinding]:
    """Tagastab kõik leitud marginaalia-struktuuri probleemid teksti muutmata."""
    findings: list[MarginaliaFinding] = []
    # (avava tägi algus, avava tägi lõpp)
    m_stack: list[tuple[int, int]] = []

    for match in _M_TAG_RE.finditer(text):
        is_close = bool(match.group(1))
        if not is_close:
            if m_stack:
                findings.append(_finding(text, match.start(), "nested"))
            m_stack.append((match.start(), match.end()))
            continue

        if not m_stack:
            findings.append(_finding(text, match.start(), "unbalanced"))
            continue

        open_start, open_end = m_stack.pop()
        if "\n" in text[open_end:match.start()]:
            findings.append(_finding(text, open_start, "multiline"))

        open_line_start = text.rfind("\n", 0, open_start) + 1
        close_line_end = text.find("\n", match.end())
        if close_line_end == -1:
            close_line_end = len(text)
        if (text[open_line_start:open_start].strip()
                or text[match.end():close_line_end].strip()):
            findings.append(_finding(text, open_start, "inline"))

    for open_start, _ in m_stack:
        findings.append(_finding(text, open_start, "unbalanced"))

    # Üldine stack tuvastab ristumise, nt <i><m>X</i></m> või
    # <m><i>X</m></i>. Raporteerime ainult ristumised, milles osaleb <m>.
    tag_stack: list[tuple[str, int]] = []
    for match in _VUTT_PAIR_TAG_RE.finditer(text):
        is_close = bool(match.group(1))
        name = match.group(2)
        if not is_close:
            tag_stack.append((name, match.start()))
            continue
        if tag_stack and tag_stack[-1][0] == name:
            tag_stack.pop()
            continue
        matching_idx = next(
            (i for i in range(len(tag_stack) - 1, -1, -1)
             if tag_stack[i][0] == name),
            -1,
        )
        if matching_idx == -1:
            continue
        crossed_names = [n for n, _ in tag_stack[matching_idx:]]
        if name == "m" or "m" in crossed_names:
            findings.append(_finding(text, match.start(), "crossing"))
        # Eemalda suletud element, kuid jäta temast üle ulatunud tägid stack'i,
        # et järgmised sulgemised annaksid võimalikult kasuliku diagnoosi.
        del tag_stack[matching_idx]

    return findings
