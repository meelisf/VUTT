"""Backendi liikluse jälgimine ja häire superadminile (#786).

**Miks.** 2026-11-09 käis saidil hajutatud brauserrobot (1825 IP-d, ~24 000
päringut päevas). Koormus oli tühine, aga see tuli välja ainult juhuslikult
vearingist. Zabbix on ülikooli IT oma ja tema teavitused ei jõua meieni.

**Mida mõõdetakse.** Iga backendi jõudnud päring minutikasti: kokku,
anonüümsed (ilma `Authorization` päiseta), unikaalsed IP-d, 5xx, aeglased.
Meili ja staatilised failid lähevad nginxist otse mööda — backend näeb umbes
poolt liiklusest; häire jaoks piisab, sest kasv paistab ka siin.
Ainult mälus, 24 h; restart nullib graafiku (häirete ajalugu on kettal).

**Vahevara on puhas ASGI, mitte `BaseHTTPMiddleware`** — viimane mähib
voogvastused ümber ja murrab taustatöid. Salvestus on O(1) luku all; I/O-d
päringuteel ei ole (ADR 0002).

**Häire.** Taustalõim kontrollib iga minut viimaseid täis minuteid. Kaks liiki:
`load` (iga minut üle `TRAFFIC_ALERT_RPS`) ja `errors` (5xx osakaal üle lävendi
JA vähemalt `TRAFFIC_5XX_MIN` tükki — väike valim ei ole häire). Sama liigi uus
häire alles `TRAFFIC_ALERT_COOLDOWN` järel; viimane saatmisaeg on kettal, et
deploy ei saadaks sama häiret uuesti. Saajad: AINULT superadminid (e-kiri +
VUTT-i teatis) — teistel pole sellega midagi peale hakata.
"""
from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional

from .config import STATE_DIR, get_logger
from .utils import atomic_write_json

logger = get_logger(__name__)

TRAFFIC_ALERTS_FILE = os.path.join(STATE_DIR, "traffic_alerts.json")

HISTORY_MINUTES = 24 * 60
# Ujutuse korral ei tohi IP-hulk minutis mälu täita; üle lae loendame edasi
# ainult päringuid ja IP-arv näitab „vähemalt".
MAX_IPS_PER_MINUTE = 5000
SLOW_SECONDS = 2.0

# Lävendid. 9.11 robot oli tipptunnis ~2 päringut/s — 20/s püsivalt 10 minutit
# on kümnekordne ja tähendab, et midagi on päriselt muutunud.
TRAFFIC_ALERT_RPS = 20
TRAFFIC_ALERT_MINUTES = 10
TRAFFIC_5XX_SHARE = 0.05
TRAFFIC_5XX_MIN = 50
TRAFFIC_ALERT_COOLDOWN = 6 * 3600
MAX_ALERT_HISTORY = 50
CHECK_INTERVAL = 60

# Konteineri healthcheck ei ole liiklus.
_IGNORED_PATHS = {"/health"}

_lock = threading.Lock()
# minut (epoch // 60) → loendurid
_buckets: Dict[int, dict] = {}


def _new_bucket() -> dict:
    return {"total": 0, "anon": 0, "errors": 0, "slow": 0, "ips": set()}


def record(minute: int, *, anon: bool, ip: str, status: int, duration: float) -> None:
    """Lisab ühe päringu minutikasti. Ei viska — vahevara ei tohi päringut kukutada."""
    with _lock:
        b = _buckets.get(minute)
        if b is None:
            b = _buckets[minute] = _new_bucket()
            # Vanade kastide koristus ainult uue minuti alguses: odav ja piisav.
            piir = minute - HISTORY_MINUTES
            for vana in [m for m in _buckets if m <= piir]:
                del _buckets[vana]
        b["total"] += 1
        if anon:
            b["anon"] += 1
        if status >= 500:
            b["errors"] += 1
        if duration >= SLOW_SECONDS:
            b["slow"] += 1
        if ip and len(b["ips"]) < MAX_IPS_PER_MINUTE:
            b["ips"].add(ip)


def snapshot(now_minute: Optional[int] = None) -> List[dict]:
    """Minutiread vanimast uusimani; tühjad minutid on nullidega (graafik ei hüppa)."""
    now_minute = now_minute if now_minute is not None else int(time.time() // 60)
    with _lock:
        if not _buckets:
            return []
        algus = max(min(_buckets), now_minute - HISTORY_MINUTES + 1)
        read = []
        for m in range(algus, now_minute + 1):
            b = _buckets.get(m)
            read.append({
                "minute": datetime.fromtimestamp(m * 60, timezone.utc).isoformat(),
                "total": b["total"] if b else 0,
                "anon": b["anon"] if b else 0,
                "errors": b["errors"] if b else 0,
                "slow": b["slow"] if b else 0,
                "ips": len(b["ips"]) if b else 0,
            })
    return read


def reset() -> None:
    """Testidele."""
    with _lock:
        _buckets.clear()


# --- Häired -------------------------------------------------------------------

def evaluate(now_minute: int) -> List[dict]:
    """Puhas otsus: millised häireliigid kehtivad viimaste täis minutite põhjal.

    Jooksev minut ei lähe arvesse — ta on pooleli ja alati „vaikne".
    """
    with _lock:
        aken = [_buckets.get(m) for m in range(now_minute - TRAFFIC_ALERT_MINUTES, now_minute)]
        read = [(b["total"], b["errors"], len(b["ips"])) if b else (0, 0, 0) for b in aken]
    tulemus = []
    if all(total >= TRAFFIC_ALERT_RPS * 60 for total, _, _ in read):
        kokku = sum(r[0] for r in read)
        tulemus.append({
            "kind": "load",
            "requests": kokku,
            "rps": round(kokku / (TRAFFIC_ALERT_MINUTES * 60), 1),
            "max_ips_per_minute": max(r[2] for r in read),
        })
    kokku = sum(r[0] for r in read)
    vigu = sum(r[1] for r in read)
    if vigu >= TRAFFIC_5XX_MIN and kokku and vigu / kokku >= TRAFFIC_5XX_SHARE:
        tulemus.append({
            "kind": "errors",
            "requests": kokku,
            "errors": vigu,
            "share": round(vigu / kokku, 3),
        })
    return tulemus


def _load_alerts() -> dict:
    import json
    try:
        with open(TRAFFIC_ALERTS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return {"last_sent": dict(data.get("last_sent") or {}),
                    "history": list(data.get("history") or [])}
    except (OSError, ValueError):
        pass
    return {"last_sent": {}, "history": []}


def list_alerts() -> List[dict]:
    """Häirete ajalugu, uusim ees."""
    return _load_alerts()["history"]


def _superadmins() -> List[dict]:
    from .auth import is_at_least, load_users
    return [dict(u, username=name) for name, u in load_users().items()
            if is_at_least(u.get("role", ""), "superadmin")]


def _message(alert: dict) -> tuple:
    if alert["kind"] == "load":
        subject = "VUTT: liiklus püsivalt kõrge"
        body = (f"Viimase {TRAFFIC_ALERT_MINUTES} minuti jooksul jõudis backendi "
                f"{alert['requests']} päringut (~{alert['rps']}/s, lävend "
                f"{TRAFFIC_ALERT_RPS}/s igal minutil). Kuni {alert['max_ips_per_minute']} "
                f"eri IP-d minutis.")
    else:
        subject = "VUTT: palju serverivigu (5xx)"
        body = (f"Viimase {TRAFFIC_ALERT_MINUTES} minuti jooksul {alert['errors']} "
                f"5xx vastust {alert['requests']} päringust ({alert['share'] * 100:.1f} %).")
    body += ("\n\nGraafik: https://vutt.utlib.ut.ee/admin/maintenance"
             f"\nSama liiki uut kirja ei saadeta enne {TRAFFIC_ALERT_COOLDOWN // 3600} tunni möödumist.")
    return subject, body


def _notify(alert: dict) -> None:
    """Saadab superadminidele. Iga saaja tõrge eraldi — üks ei peata teist."""
    from .mailer import send_mail
    from .notifications_ops import create_notification
    subject, body = _message(alert)
    for u in _superadmins():
        try:
            create_notification(u["username"], "traffic_alert", subject, body,
                                link="/admin/maintenance", metadata={"kind": alert["kind"]})
        except Exception:
            logger.warning("Liiklushäire teatise loomine ebaõnnestus", exc_info=True)
        if u.get("email"):
            ok, viga = send_mail(u["email"], subject, body)
            if not ok:
                logger.warning("Liiklushäire kirja saatmine ebaõnnestus: %s", viga)


def check_and_alert(now: Optional[float] = None) -> List[dict]:
    """Üks kontrollsamm. Tagastab tegelikult saadetud häired."""
    now = now if now is not None else time.time()
    kehtivad = evaluate(int(now // 60))
    if not kehtivad:
        return []
    olek = _load_alerts()
    saadetud = []
    for alert in kehtivad:
        eelmine = olek["last_sent"].get(alert["kind"])
        if eelmine is not None and now - float(eelmine) < TRAFFIC_ALERT_COOLDOWN:
            continue
        alert = dict(alert, at=datetime.fromtimestamp(now, timezone.utc).isoformat())
        olek["last_sent"][alert["kind"]] = now
        olek["history"].insert(0, alert)
        saadetud.append(alert)
    if not saadetud:
        return []
    del olek["history"][MAX_ALERT_HISTORY:]
    try:
        # Enne saatmist: kirjutustõrge ei tohi tähendada iga minut uut kirja.
        atomic_write_json(TRAFFIC_ALERTS_FILE, olek)
    except OSError:
        logger.warning("traffic_alerts.json kirjutamine ebaõnnestus; häiret ei saadeta",
                       exc_info=True)
        return []
    for alert in saadetud:
        _notify(alert)
    return saadetud


def _loop() -> None:
    from .heartbeat import mark_error, mark_success, register_job
    register_job("traffic-monitor", interval_seconds=CHECK_INTERVAL,
                 description="Liikluse häire superadminile (#786)")
    while True:
        time.sleep(CHECK_INTERVAL)
        try:
            check_and_alert()
            mark_success("traffic-monitor")
        except Exception as e:  # lõim ei tohi surra
            logger.warning("Liikluse kontroll ebaõnnestus", exc_info=True)
            mark_error("traffic-monitor", e)


def start_background() -> None:
    threading.Thread(target=_loop, daemon=True, name="traffic-monitor").start()


# --- Vahevara -------------------------------------------------------------------

class TrafficMiddleware:
    """Puhas ASGI vahevara: loeb staatuse `http.response.start` sõnumist."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("path") in _IGNORED_PATHS:
            await self.app(scope, receive, send)
            return
        algus = time.monotonic()
        staatus = {"code": 500}  # erind enne vastust = 500

        async def send_wrapper(message):
            if message.get("type") == "http.response.start":
                staatus["code"] = message.get("status", 500)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            try:
                headers = dict(scope.get("headers") or [])
                anon = not headers.get(b"authorization", b"").strip()
                ip = (headers.get(b"x-real-ip")
                      or (headers.get(b"x-forwarded-for") or b"").split(b",")[0]
                      or b"").decode("latin-1").strip()
                if not ip and scope.get("client"):
                    ip = scope["client"][0] or ""
                record(int(time.time() // 60), anon=anon, ip=ip,
                       status=staatus["code"], duration=time.monotonic() - algus)
            except Exception:
                # Mõõtmine ei tohi päringut kukutada.
                pass
