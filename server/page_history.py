"""Lehe ühine ajalugu: `.txt` + `.json` ühes loendis (#375 punkt 1).

Toimetajakiht — tekst-annotatsioonid, lehe märkmed, märksõnad, staatus —
elab lehe JSON-is. Vaade küsis varem ainult `.txt` ajalugu, seega commit, mis
muutis ainult seda kihti, jäi nimekirjast välja ja tema seisu ei saanud
taastamiseks valida.

Git loetakse TEKSTIVÄLJUNDINA eraldi protsessidega, mitte GitPythoni laisa
Commit-objekti kaudu: jagatud `Repo` peal andis see samaaegsel päringul võõra
commiti andmed (#337).
"""
import json
import subprocess
from datetime import datetime
from typing import Optional

from .annotation_ops import split_page_json

# Väljad, mille muutus ei ole kasutajale sisuline muudatus (salvestuse kõrvalmõju
# või serveri kirjutatud identiteet).
TEHNILISED_VALJAD = {"updated_at", "created_at", "work_id", "page_number", "sequence",
                     "source", "id", "slug", "image_url", "original_path", "text_content"}
TUNTUD_VALJAD = {"text_annotations", "comments", "page_tags", "status"}

MAX_TEKST = 300

_FIELD_SEP = "\x1f"


def _loe(raw: Optional[str]) -> dict:
    """Lehe JSON → toimetajakihi meta. Puuduv või loetamatu = tühi."""
    if raw is None:
        return {}
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(data, dict):
        return {}
    meta, _ = split_page_json(data)
    return meta if isinstance(meta, dict) else {}


def _lyhenda(tekst) -> str:
    tekst = "" if tekst is None else str(tekst)
    return tekst if len(tekst) <= MAX_TEKST else tekst[:MAX_TEKST] + "…"


def _kirjed(meta: dict, vali: str) -> dict:
    """`id`-ga kirjed sõnastikuna. Ilma `id`-ta kirjet ei saa versioonide vahel siduda."""
    raw = meta.get(vali)
    if not isinstance(raw, list):
        return {}
    return {k["id"]: k for k in raw if isinstance(k, dict) and "id" in k}


def _vorrle_kirjeid(enne: dict, parast: dict, tekstivali: str, vorrldav) -> dict:
    lisatud = [{"id": i, "text": _lyhenda(k.get(tekstivali))} for i, k in parast.items() if i not in enne]
    eemaldatud = [{"id": i, "text": _lyhenda(k.get(tekstivali))} for i, k in enne.items() if i not in parast]
    muudetud = [
        {"id": i, "before": _lyhenda(enne[i].get(tekstivali)), "after": _lyhenda(k.get(tekstivali))}
        for i, k in parast.items() if i in enne and vorrldav(enne[i]) != vorrldav(k)
    ]
    tulemus = {}
    if lisatud:
        tulemus["added"] = lisatud
    if muudetud:
        tulemus["modified"] = muudetud
    if eemaldatud:
        tulemus["removed"] = eemaldatud
    return tulemus


def _sildid(meta: dict) -> list:
    out = []
    for t in meta.get("page_tags") or []:
        if isinstance(t, dict):
            out.append(t.get("label") or t.get("id") or "")
        elif isinstance(t, str):
            out.append(t)
    return [s for s in out if s]


def summarize_page_change(before_raw: Optional[str], after_raw: Optional[str]) -> dict:
    """Mis muutus lehe JSON-is kahe versiooni vahel — ainult mittetühjad grupid.

    Tagastab `{}`, kui sisulist muutust ei ole (nt ainult `updated_at`).
    """
    enne, parast = _loe(before_raw), _loe(after_raw)
    muutus = {}

    ann = _vorrle_kirjeid(
        _kirjed(enne, "text_annotations"), _kirjed(parast, "text_annotations"),
        "comment", lambda k: k.get("comment"),
    )
    if ann:
        muutus["text_annotations"] = ann

    # Märkme muutus = tekst VÕI vastused; vastuse lisamine ei ole uus märge.
    kom = _vorrle_kirjeid(
        _kirjed(enne, "comments"), _kirjed(parast, "comments"),
        "text", lambda k: (k.get("text"), json.dumps(k.get("replies") or [], sort_keys=True)),
    )
    if kom:
        muutus["comments"] = kom

    s_enne, s_parast = _sildid(enne), _sildid(parast)
    sildid = {}
    lisatud = [s for s in s_parast if s not in s_enne]
    eemaldatud = [s for s in s_enne if s not in s_parast]
    if lisatud:
        sildid["added"] = lisatud
    if eemaldatud:
        sildid["removed"] = eemaldatud
    if sildid:
        muutus["page_tags"] = sildid

    if enne.get("status") != parast.get("status"):
        muutus["status"] = {"before": enne.get("status"), "after": parast.get("status")}

    muud = sorted(
        k for k in (set(enne) | set(parast)) - TUNTUD_VALJAD - TEHNILISED_VALJAD
        if enne.get(k) != parast.get(k)
    )
    if muud:
        muutus["other_fields"] = muud
    return muutus


def _git(repo_dir: str, *args: str, input_bytes: Optional[bytes] = None) -> bytes:
    return subprocess.run(
        ["git", *args], cwd=repo_dir, input=input_bytes,
        check=True, capture_output=True,
    ).stdout


def _read_blobs(repo_dir: str, specs: list) -> dict:
    """`rev:tee` → sisu (või None) ÜHE `git cat-file --batch` protsessiga."""
    if not specs:
        return {}
    out = _git(repo_dir, "cat-file", "--batch", input_bytes=("\n".join(specs) + "\n").encode())
    tulemus, pos = {}, 0
    for spec in specs:
        rea_lopp = out.index(b"\n", pos)
        paise = out[pos:rea_lopp].decode("utf-8", "replace")
        pos = rea_lopp + 1
        osad = paise.split()
        if len(osad) == 3 and osad[1] == "blob":
            suurus = int(osad[2])
            tulemus[spec] = out[pos:pos + suurus].decode("utf-8", "replace")
            pos += suurus + 1  # sisu järel on reavahetus
        else:
            tulemus[spec] = None  # "<spec> missing" — faili tol hetkel ei olnud
    return tulemus


def build_page_history(repo_dir: str, txt_rel: str, json_rel: str, max_count: int = 50) -> dict:
    """Lehe ajalugu uuemast vanemani, iga kirje juures `changes`.

    `has_more`: aknast jäi vanemaid versioone välja. Siis ei ole aknas ka
    originaali ja ükski kirje ei nimeta end originaaliks.
    """
    # `core.quotePath=false`: muidu tuleb `--name-only` täpitähtedega tee
    # jutumärkides ja oktaalkoodis (`"1696-R\303\266rling…"`) ega võrdu
    # `json_rel`-iga — „mis muutus" läheks vaikselt valeks.
    out = _git(
        repo_dir, "-c", "core.quotePath=false", "log", f"--max-count={max_count + 1}",
        f"--format=%x00%H{_FIELD_SEP}%an{_FIELD_SEP}%cI{_FIELD_SEP}%s",
        "--name-only", "--", txt_rel, json_rel,
    ).decode("utf-8", "replace")

    kirjed = []
    for plokk in out.split("\x00"):
        if not plokk.strip():
            continue
        paise, _, failid = plokk.partition("\n")
        osad = paise.split(_FIELD_SEP)
        if len(osad) < 4:
            continue
        kirjed.append({
            "hash": osad[0], "author": osad[1], "date": osad[2], "message": osad[3],
            "files": {f.strip() for f in failid.splitlines() if f.strip()},
        })

    has_more = len(kirjed) > max_count
    kirjed = kirjed[:max_count]

    json_muutus = [k for k in kirjed if json_rel in k["files"]]
    blobs = _read_blobs(repo_dir, [s for k in json_muutus
                                   for s in (f"{k['hash']}:{json_rel}", f"{k['hash']}^:{json_rel}")])

    ajalugu = []
    for i, k in enumerate(kirjed):
        muutus = {"text": txt_rel in k["files"]}
        if json_rel in k["files"]:
            muutus.update(summarize_page_change(
                blobs.get(f"{k['hash']}^:{json_rel}"), blobs.get(f"{k['hash']}:{json_rel}")))
        kuupaev = datetime.fromisoformat(k["date"])
        ajalugu.append({
            "hash": k["hash"][:8],
            "full_hash": k["hash"],
            "author": k["author"],
            "date": kuupaev.isoformat(),
            "formatted_date": kuupaev.strftime("%d.%m.%Y %H:%M"),
            "message": k["message"],
            "is_original": (not has_more) and i == len(kirjed) - 1,
            "changes": muutus,
        })
    return {"history": ajalugu, "has_more": has_more}
