"""Konservatiivne teisendus rea-põhisele marginaaliaformaadile (ADR 0009).

Teisendus parandab ainult tasakaalus ja omaette ridadel olevad ``<m>``
piirkonnad. Ebamäärased failid/piirkonnad jäetakse puutumata ning põhjus
raporteeritakse kutsujale. Nähtav tekst ja ridade arv ei tohi muutuda.
"""
from dataclasses import dataclass
from collections import Counter
import re
from typing import Optional, Tuple

from .marginalia_audit import audit_marginalia


_M_TAG_RE = re.compile(r"<(/?)m>")
_INLINE_TAG_RE = re.compile(r"<(/?)(i|b|cs|hi|fn|ann\d*)>")
_ALL_VUTT_TAG_RE = re.compile(r"</?[a-z]+\d*[^>]*>")


@dataclass(frozen=True)
class MarginaliaMigrationResult:
    text: str
    regions_changed: int
    skipped: Counter

    @property
    def changed(self) -> bool:
        return self.regions_changed > 0


def _visible_text(text: str) -> str:
    return _ALL_VUTT_TAG_RE.sub("", text)


def _outer_regions(text: str) -> tuple[list[tuple[int, int, int, int]], bool]:
    """Tagastab (open-start, open-end, close-start, close-end) välispiirkonnad."""
    stack: list[tuple[int, int]] = []
    regions: list[tuple[int, int, int, int]] = []
    unbalanced = False
    for match in _M_TAG_RE.finditer(text):
        if not match.group(1):
            stack.append((match.start(), match.end()))
            continue
        if not stack:
            unbalanced = True
            continue
        open_start, open_end = stack.pop()
        if not stack:
            regions.append((open_start, open_end, match.start(), match.end()))
    if stack:
        unbalanced = True
    return regions, unbalanced


def _canonical_region(content: str) -> Tuple[Optional[str], Optional[str]]:
    """Teeb ühe välise <m> piirkonna reapõhiseks või tagastab skip-põhjuse."""
    content = _M_TAG_RE.sub("", content)
    active: list[str] = []
    output: list[str] = []
    lines = content.split("\n")

    for line_no, line in enumerate(lines):
        inherited = list(active)
        for match in _INLINE_TAG_RE.finditer(line):
            name = match.group(2)
            if not match.group(1):
                active.append(name)
            else:
                if not active or active[-1] != name:
                    return None, "inline-crossing"
                active.pop()

        if line_no < len(lines) - 1 and any(
            name == "fn" or name.startswith("ann") for name in active
        ):
            # Annotatsiooni/joonealuse semantikat ei dubleeri automaatselt üle rea.
            return None, "structured-tag-spans-line"

        # Kui real pole peale inline-tägide nähtavat sisu, jäta alles ainult
        # nende vaheline whitespace. Nii ei tekita migratsioon uusi tühje
        # `<m><i></i></m>` plokke (strip_empty_tags teeks hiljem sama).
        plain = _INLINE_TAG_RE.sub("", line)
        if plain.strip() == "":
            output.append(plain)
            continue

        prefix = "".join(f"<{name}>" for name in inherited)
        suffix = "".join(f"</{name}>" for name in reversed(active))
        output.append(f"<m>{prefix}{line}{suffix}</m>")

    if active:
        return None, "inline-unbalanced"
    return "\n".join(output), None


def migrate_marginalia_per_line(text: str) -> MarginaliaMigrationResult:
    """Teisendab üheselt mõistetavad marginaaliad, jättes muu puutumata."""
    regions, unbalanced = _outer_regions(text)
    skipped: Counter = Counter()
    if unbalanced:
        skipped["unbalanced-file"] += 1
        return MarginaliaMigrationResult(text=text, regions_changed=0, skipped=skipped)

    replacements: list[tuple[int, int, str]] = []
    for open_start, open_end, close_start, close_end in regions:
        line_start = text.rfind("\n", 0, open_start) + 1
        line_end = text.find("\n", close_end)
        if line_end == -1:
            line_end = len(text)
        if text[line_start:open_start].strip() or text[close_end:line_end].strip():
            skipped["inline-region"] += 1
            continue

        replacement, reason = _canonical_region(text[open_end:close_start])
        if replacement is None:
            skipped[reason or "unknown"] += 1
            continue

        original = text[open_start:close_end]
        if replacement == original:
            continue
        # Iga eraldi teisendatud piirkond peab juba ise kanooniline olema.
        if audit_marginalia(replacement):
            skipped["post-audit"] += 1
            continue
        replacements.append((open_start, close_end, replacement))

    migrated = text
    for start, end, replacement in reversed(replacements):
        migrated = migrated[:start] + replacement + migrated[end:]

    # Kaitsepiirded: migratsioon ei tohi muuta nähtavat teksti ega ridade arvu.
    if _visible_text(migrated) != _visible_text(text):
        skipped["visible-text-changed"] += 1
        return MarginaliaMigrationResult(text=text, regions_changed=0, skipped=skipped)
    if migrated.count("\n") != text.count("\n"):
        skipped["line-count-changed"] += 1
        return MarginaliaMigrationResult(text=text, regions_changed=0, skipped=skipped)

    before = Counter(f.kind for f in audit_marginalia(text))
    after = Counter(f.kind for f in audit_marginalia(migrated))
    if any(after[kind] > before[kind] for kind in after):
        skipped["audit-regression"] += 1
        return MarginaliaMigrationResult(text=text, regions_changed=0, skipped=skipped)

    return MarginaliaMigrationResult(
        text=migrated,
        regions_changed=len(replacements),
        skipped=skipped,
    )
