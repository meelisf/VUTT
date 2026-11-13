"""Bounded process-wide cache and pacing for interactive place lookups.

The lock coalesces concurrent identical requests. Wikimedia's cooldown is
shared by all users of this worker; callers receive Retry-After instead of
retrying in a tight loop. No network work is done under a register write lock.
"""
import copy
import json
import math
import threading
import time
import urllib.error
import urllib.request
from email.utils import parsedate_to_datetime

HEADERS = {"User-Agent": "VUTT-Historical-Archive/1.0 (https://vutt.utlib.ut.ee; vutt@utlib.ut.ee)"}
_lock = threading.Lock()
_cache = {}
_next_request = 0.0
_cooldown = 0.0


class WikidataBusy(Exception):
    def __init__(self, retry_after=60):
        self.retry_after = max(1, math.ceil(retry_after))
        super().__init__(f"Wikidata: proovi uuesti {self.retry_after}s pärast")


def _retry_seconds(value):
    try:
        return max(1, float(value))
    except (ValueError, TypeError):
        try:
            return max(1, parsedate_to_datetime(value).timestamp() - time.time())
        except (ValueError, TypeError, AttributeError):
            return 60


def get_json(url, *, ttl=3600):
    global _next_request, _cooldown
    with _lock:
        now = time.monotonic()
        cached = _cache.get(url)
        if cached and cached[0] > now:
            return copy.deepcopy(cached[1])
        if _cooldown > now:
            raise WikidataBusy(_cooldown - now)
        delay = _next_request - now
        if delay > 0:
            time.sleep(delay)
        _next_request = time.monotonic() + 1
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code in (429, 503):
                seconds = _retry_seconds(error.headers.get("Retry-After"))
                _cooldown = time.monotonic() + seconds
                raise WikidataBusy(seconds) from error
            raise
        error = data.get("error") or {}
        if error:
            if error.get("code") in ("maxlag", "ratelimited"):
                _cooldown = time.monotonic() + 60
                raise WikidataBusy(60)
            raise ValueError("Wikidata: " + str(error.get("code", "error")))
        if len(_cache) >= 512:
            _cache.pop(next(iter(_cache)))
        _cache[url] = (time.monotonic() + ttl, data)
        return copy.deepcopy(data)
