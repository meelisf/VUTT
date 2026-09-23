"""Serveripoolsed vead kliendivigade ringi (#133, serveripool).

Kaks allikat, mida keegi ei näinud enne, kui kasutaja kurtis:

1. **Taustalõime surm** — keep-warm, re-OCR poll, upload-sünk jt on
   daemon-lõimed; erindiga surnud lõim kadus vaikselt `docker logs`-i.
   `threading.excepthook` püüab ainult LÕIME SURMA: loop, mis püüab ise ja
   jätkab, siia ei jõua (seda katab heartbeat, #88). `ThreadPoolExecutor`-i
   tööde erindid jäävad future'isse ega jõua konksuni.
2. **FastAPI käsitlemata erind** — 500 vastus. `HTTPException` ei ole viga
   ja siia ei jõua (ExceptionMiddleware käsitleb ta enne).

Salvestus ise elab `client_errors.record_server_error`-is (sama valge
nimekiri, puhastus ja kaetud ring).
"""
import threading

from fastapi import FastAPI, Request
from fastapi.responses import PlainTextResponse
from starlette.concurrency import run_in_threadpool

from . import client_errors


def _thread_hook(args) -> None:
    # SystemExit lõimes on tahtlik lõpp — vaikimisi konks vaikib ka selle kohta.
    if args.exc_type is not SystemExit:
        try:
            nimi = getattr(args.thread, "name", None)
            client_errors.record_server_error("server:thread", args.exc_value, thread=nimi)
        except Exception:
            pass  # konks, mis viskab, peidaks algse vea
    _thread_hook.eelmine(args)


_thread_hook.eelmine = threading.__excepthook__


def install_thread_excepthook() -> None:
    """Paigaldab konksu; eelmine konks (traceback stderr-i) jookseb edasi."""
    if threading.excepthook is _thread_hook:
        return
    _thread_hook.eelmine = threading.excepthook
    threading.excepthook = _thread_hook


def install_http_handler(app: FastAPI) -> None:
    """500-käsitleja: salvestab erindi, vastus jääb samaks mis enne.

    Starlette kutsub käsitlejat `ServerErrorMiddleware`-is ja viskab erindi
    pärast edasi, seega uvicorni traceback jääb logisse alles.
    """
    async def _kasitle(request: Request, exc: Exception):
        url = "{} {}".format(request.method, request.url.path)
        if request.url.query:
            url += "?" + request.url.query
        # Faili kirjutus = blokeeriv I/O, mitte event-loopis (ADR 0002).
        await run_in_threadpool(client_errors.record_server_error,
                                "server:http", exc, url=url)
        return PlainTextResponse("Internal Server Error", status_code=500)

    app.add_exception_handler(Exception, _kasitle)
