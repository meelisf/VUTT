#!/usr/bin/env python3
"""Kasutusstatistika päevane kokkuvõte nginxi logist (#855).

**Miks.** Umami eemaldati 2026-11-19; liikluspaneel (#786) on häiresüsteem
(ainult backend, mälus, 24 h) ja selle arvu määravad avatud vahekaardid.
nginxi logis on kogu liiklus olemas, aga logrotate hoiab seda 14 päeva —
pikem ajalugu tekib ainult igapäevasest kokkuvõttest.

**Kus jookseb.** HOSTIS (mitte Dockeris), sest logi on `/var/log/nginx/`.
Ainult standardteek — ei impordi `server`-it (süsteemi python3-l pole sõltuvusi).
Kasutaja peab kuuluma `adm` gruppi (logide lugemisõigus). crontab:

    15 0 * * * cd ~/VUTT && python3 scripts/usage_stats.py 2>&1 | logger -t vutt-usage-stats

Logrotate jookseb keskööl; skript loeb nii `vutt_access.log` kui `.1` ja
filtreerib kuupäeva järgi, nii et ajastus ei ole kriitiline. Esmakordselt
(või pärast vahelejäänud öid) `--backfill`: kõik logides leiduvad täis päevad.

**Mida salvestatakse.** Ainult arvud päeva kohta + top-loendid (teose/isiku ID,
viitaja DOMEEN, roboti nimi). IP-aadresse ega User-Agente kettale EI kirjutata.
Fail: `$VUTT_STATE_DIR/usage_stats.json` (vaikimisi `<repo>/state/`, sama reegel
mis `server/config.py`-s; valvur `tests/test_usage_stats.py`). Sama päeva
kordusjooks asendab kirje — skript on idempotentne.

**Mida logist EI näe.** Töölaud laeb teoseid Meili POST-päringutega ja
pildipäringuid ei logita (`access_log off`), seega SPA sees avatud teoseid ei
ole näha — `top_works` on ainult OTSE avatud teosed (väline link, järjehoidja,
värskendus). JavaScripti käivitav brauserirobot (9.11.2026) näeb välja nagu
inimene ja paistab `visitors` hüppena.
"""
from __future__ import annotations

import argparse
import glob
import gzip
import json
import os
import re
import sys
import tempfile
from collections import Counter
from datetime import date, datetime, timedelta
from typing import Dict, Iterable, Iterator, List, Optional

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Sama reegel mis server/config.py STATE_DIR — server-it importida ei saa.
STATE_DIR = os.getenv("VUTT_STATE_DIR") or os.path.join(_PROJECT_ROOT, "state")
USAGE_STATS_FILE = os.path.join(STATE_DIR, "usage_stats.json")
DEFAULT_LOG_GLOB = "/var/log/nginx/vutt_access.log*"

TOP_N = 15
# Üle selle päevi ei hoita (~3 aastat; kirje on ~2 KB).
MAX_DAYS = 1100

# combined-formaat: ip - user [aeg] "meetod tee protokoll" staatus suurus "viitaja" "UA"
LINE_RE = re.compile(
    r'(?P<ip>\S+) \S+ \S+ \[(?P<day>\d{2}/\w{3}/\d{4}):[^\]]*\] '
    r'"(?P<method>[A-Z]+) (?P<path>\S+)[^"]*" (?P<status>\d{3}) \S+ '
    r'"(?P<ref>[^"]*)" "(?P<ua>[^"]*)"'
)

# Jälgimine (ülikooli IT Zabbix, `HEAD /` iga minut) — ei ole robot ega külastaja.
MONITOR_RE = re.compile(r"zabbix|uptime|pingdom|statuscake", re.I)
BOT_RE = re.compile(
    r"bot|crawl|spider|slurp|scan|python|curl|wget|go-http|java/|okhttp|libwww|"
    r"httpx|axios|node-fetch|headless|scrapy|censys|petal|semrush|ahrefs|"
    r"facebookexternal|meta-external|dataforseo|preview|feed",
    re.I,
)
BOT_NAME_RE = re.compile(r"([A-Za-z][\w.-]*?(?:bot|spider|crawler|inspect|scanner))\b", re.I)

# Taustaküsitlus (#854) — ei ole kasutaja tegevus, aga näitab sisselogitud vahekaarte.
POLL_RE = re.compile(r"^/api/files/(notifications|admin/registrations|verify-token)(?:\?|$)")
LOGGED_IN_RE = re.compile(r"^/api/files/(notifications|verify-token)(?:\?|$)")
APP_API_RE = re.compile(r"^/(api/files|meili)/")
MEILI_SEARCH_RE = re.compile(r"^/meili/(?:multi-search|indexes/[^/]+/search)")
SAVE_RE = re.compile(r"^/api/files/save(?:\?|$)")
# SPA marsruudid — skännerite `/www`, `/boaform` jms saavad samuti 200 (index.html),
# seepärast loetakse lehelaadimiseks ainult päris marsruute.
PAGE_RE = re.compile(r"^/(?:$|\?|work/|persons(?:/|\?|$)|search(?:/|\?|$)|stats(?:/|\?|$)|review(?:/|\?|$)|admin(?:/|\?|$))")
WORK_RE = re.compile(r"^/work/([a-z0-9]{6})(?:[/?]|$)")
PERSON_RE = re.compile(r"^/persons/vutt(?::|%3A)(P[a-z0-9]{6,12})(?:[/?]|$)", re.I)
OWN_HOSTS = ("vutt.utlib.ut.ee",)


def _day_key(nginx_day: str) -> str:
    """'20/Nov/2026' → '2026-11-20' (logi kohalik kuupäev, nagu nginx ta kirjutas)."""
    return datetime.strptime(nginx_day, "%d/%b/%Y").date().isoformat()


def classify_ua(ua: str) -> str:
    """'monitor' | 'bot' | 'human'. Tühi UA või paljas 'Mozilla/5.0' on robot."""
    if MONITOR_RE.search(ua):
        return "monitor"
    if not ua or ua == "-" or ua.strip() == "Mozilla/5.0" or BOT_RE.search(ua):
        return "bot"
    return "human"


def bot_name(ua: str) -> str:
    m = BOT_NAME_RE.search(ua)
    if m:
        return m.group(1)
    if not ua or ua == "-":
        return "(tühi)"
    return ua.split("/")[0].split(" ")[0][:40] or "(tühi)"


def referrer_domain(ref: str) -> Optional[str]:
    """Väline viitaja domeenina; oma sait, tühi ja vigane → None."""
    if not ref or ref == "-":
        return None
    m = re.match(r"^[a-z][a-z0-9+.-]*://([^/:?#]+)", ref, re.I)
    if not m:
        return None
    host = m.group(1).lower()
    if host.startswith("www."):
        host = host[4:]
    if host in OWN_HOSTS:
        return None
    # IP-aadressi kettale ei kirjutata — ka viitajana mitte.
    if re.fullmatch(r"[\d.]+|\[?[0-9a-f:]+\]?", host):
        return "(IP-aadress)"
    return host


class DayStats:
    def __init__(self) -> None:
        self.requests = 0
        self.monitoring = 0
        self.bot_requests = 0
        self.polling = 0
        self.page_loads = 0
        self.meili_queries = 0
        self.saves = 0
        self._visitor_ips: set = set()
        self._logged_in_ips: set = set()
        self._bot_ips: set = set()
        self.works: Counter = Counter()
        self.persons: Counter = Counter()
        self.referrers: Counter = Counter()
        self.bots: Counter = Counter()

    def add(self, m: "re.Match[str]") -> None:
        self.requests += 1
        ua, path, method = m.group("ua"), m.group("path"), m.group("method")
        kind = classify_ua(ua)
        if kind == "monitor":
            self.monitoring += 1
            return
        if kind == "bot":
            self.bot_requests += 1
            self._bot_ips.add(m.group("ip"))
            self.bots[bot_name(ua)] += 1
            return
        ip, status = m.group("ip"), int(m.group("status"))
        if LOGGED_IN_RE.match(path):
            self._logged_in_ips.add(ip)
        if POLL_RE.match(path):
            self.polling += 1
            return
        if APP_API_RE.match(path):
            # Skännerid ja otsingurobotid API-t ei kasuta — parim lihtne
            # külastaja tunnus, mida logist saab.
            self._visitor_ips.add(ip)
        if MEILI_SEARCH_RE.match(path):
            self.meili_queries += 1
        elif method == "POST" and SAVE_RE.match(path) and status < 400:
            self.saves += 1
        elif method == "GET" and status == 200 and PAGE_RE.match(path):
            self.page_loads += 1
            w = WORK_RE.match(path)
            if w:
                self.works[w.group(1)] += 1
            p = PERSON_RE.match(path)
            if p:
                self.persons["vutt:" + p.group(1)] += 1
            dom = referrer_domain(m.group("ref"))
            if dom:
                self.referrers[dom] += 1

    def to_dict(self, day: str) -> dict:
        top = lambda c: [[k, n] for k, n in c.most_common(TOP_N)]  # noqa: E731
        return {
            "date": day,
            "requests": self.requests,
            "visitors": len(self._visitor_ips),
            "logged_in": len(self._logged_in_ips),
            "page_loads": self.page_loads,
            "meili_queries": self.meili_queries,
            "saves": self.saves,
            "polling": self.polling,
            "bot_requests": self.bot_requests,
            "bot_ips": len(self._bot_ips),
            "monitoring": self.monitoring,
            "top_works": top(self.works),
            "top_persons": top(self.persons),
            "referrers": top(self.referrers),
            "bots": top(self.bots),
        }


def iter_lines(paths: Iterable[str]) -> Iterator[str]:
    for p in paths:
        opener = gzip.open if p.endswith(".gz") else open
        try:
            with opener(p, "rt", encoding="utf-8", errors="replace") as f:
                yield from f
        except OSError as e:
            print(f"Hoiatus: {p} lugemine ebaõnnestus: {e}", file=sys.stderr)


def summarize(lines: Iterable[str], days: Optional[set] = None) -> Dict[str, dict]:
    """Päevade kokkuvõtted. `days=None` → kõik leitud päevad."""
    stats: Dict[str, DayStats] = {}
    for line in lines:
        m = LINE_RE.match(line)
        if not m:
            continue
        day = _day_key(m.group("day"))
        if days is not None and day not in days:
            continue
        stats.setdefault(day, DayStats()).add(m)
    return {d: s.to_dict(d) for d, s in stats.items()}


def load(path: str = None) -> List[dict]:
    path = path or USAGE_STATS_FILE
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    days = data.get("days") if isinstance(data, dict) else None
    return [d for d in days if isinstance(d, dict) and d.get("date")] if isinstance(days, list) else []


def merge(existing: List[dict], new: Dict[str, dict]) -> List[dict]:
    """Uued kirjed asendavad sama päeva vanad; järjestus kuupäeva järgi, lagi MAX_DAYS."""
    by_day = {d["date"]: d for d in existing}
    by_day.update(new)
    return [by_day[k] for k in sorted(by_day)][-MAX_DAYS:]


def write(days: List[dict], path: str = None) -> None:
    path = path or USAGE_STATS_FILE
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".usage_stats.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"version": 1, "days": days}, f, ensure_ascii=False, indent=1)
        # Backend loeb Dockeris teise kasutajana — fail peab olema loetav.
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--date", help="päev YYYY-MM-DD (vaikimisi eile)")
    ap.add_argument("--backfill", action="store_true",
                    help="kõik logides leiduvad täis päevad (tänane jääb välja)")
    ap.add_argument("--logs", nargs="*", help=f"logifailid (vaikimisi {DEFAULT_LOG_GLOB})")
    ap.add_argument("--out", default=USAGE_STATS_FILE)
    ap.add_argument("--dry-run", action="store_true", help="prindi, ära kirjuta")
    args = ap.parse_args(argv)

    today = date.today()
    if args.backfill:
        wanted = None
        paths = args.logs or sorted(glob.glob(DEFAULT_LOG_GLOB))
    else:
        day = date.fromisoformat(args.date) if args.date else today - timedelta(days=1)
        wanted = {day.isoformat()}
        # Päev on tavaliselt `.1`-s; paar rida võib olla rotatsiooni piiri taga.
        paths = args.logs or [p for p in sorted(glob.glob(DEFAULT_LOG_GLOB)) if not p.endswith(".gz")]

    new = summarize(iter_lines(paths), wanted)
    new.pop(today.isoformat(), None)  # pooleli päev ei lähe kirja
    if not new:
        print("Logidest ei leitud ühtki sobivat päeva.", file=sys.stderr)
        return 1
    if args.dry_run:
        print(json.dumps(new, ensure_ascii=False, indent=1))
        return 0
    write(merge(load(args.out), new), args.out)
    for d in sorted(new):
        s = new[d]
        print(f"{d}: külastajaid {s['visitors']}, sisse logitud {s['logged_in']}, "
              f"lehelaadimisi {s['page_loads']}, salvestusi {s['saves']}, robotipäringuid {s['bot_requests']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
