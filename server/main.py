import threading
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import (
    PORT, ALLOWED_ORIGINS, BASE_DIR, UPLOAD_ENABLED, UPLOADS_DIR,
    check_render_concurrency, get_logger,
)
from .utils import build_work_id_cache

logger = get_logger(__name__)
from .meilisearch_ops import metadata_watcher_loop, _keepwarm_loop, _ensure_filterable_attributes, get_meilisearch_sync_status
from .upload_ops import start_upload_sync_loop
from .reocr_ops import start_reocr_background
from .git_ops import run_git_fsck, start_git_commit_graph_loop
from .heartbeat import snapshot as heartbeat_snapshot
# NB: upload/re-OCR endpointid + nende ops-importid elavad nüüd routerites
# (server/routers/upload.py, reocr.py). Paketi-tasandi re-eksport käib
# server/__init__.py kaudu otse ops-moodulitest, seega main.py ei impordi neid.
from .prosopography.router import router as prosopography_router
from .prosopography.historical_regions import start_historical_regions_warm_loop
from .routers.notifications import router as notifications_router
from .routers.upload import router as upload_router
from .routers.reocr import router as reocr_router
from .routers.pages import router as pages_router
from .routers.auth import router as auth_router
from .routers.admin import router as admin_router
from .routers.user_settings import router as user_settings_router
from .routers.public_registries import router as public_registries_router
from .routers.public import router as public_router
from .routers.editing import router as editing_router
from .routers.collections import router as collections_router
from .routers.ocr_jobs import router as ocr_jobs_router
from .prosopography.indices import rebuild_indices

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"VUTT FastAPI käivitus.")
    # Ei blokeeri käivitust — RENDER_SEMAPHORE on protsessi-lokaalne ja seda
    # ei saa siit parandada; hoiatus on selleks, et põhjus oleks logis olemas,
    # kui keegi workerite arvu tõstab (ADR 0028).
    _render_hoiatus = check_render_concurrency()
    if _render_hoiatus:
        logger.warning(_render_hoiatus)
    from .prosopography.places_ops import validate_places_config
    try:
        validate_places_config()
        logger.info("places.json + origin_groups.json valideeritud")
    except ValueError as e:
        logger.error("places.json konfiguratsiooniviga: %s", e)
        raise SystemExit(1)
    build_work_id_cache()
    # Tervikluse kontroll ja ajalooindeksi hooldus ei pea API käivitumist blokeerima.
    threading.Thread(target=run_git_fsck, daemon=True, name="git-fsck").start()
    start_git_commit_graph_loop()
    from .auth import warn_if_no_superadmin
    warn_if_no_superadmin()
    threading.Thread(target=rebuild_indices, daemon=True).start()
    threading.Thread(target=metadata_watcher_loop, daemon=True).start()
    threading.Thread(target=_keepwarm_loop, daemon=True).start()
    threading.Thread(target=_ensure_filterable_attributes, daemon=True).start()
    start_historical_regions_warm_loop()
    start_upload_sync_loop()  # upload taustasünk — AINULT API-protsessis (mitte image_server import)
    start_reocr_background()  # re-OCR restardi-jätkamine (AINULT API-protsessis); orbude
                              # taaste + reaper käivad taustalõimes, et maas OCR-server ei
                              # blokeeriks API käivitumist (#181)
    # Rippuv ada_fetching → ada_error. Ilma selleta blokeeriks CAS „Laen uuesti"
    # nupu igaveseks, sest upload_progress kadus restardiga.
    from .ada.fetch import taasta_rippuvad_fetchid
    threading.Thread(target=taasta_rippuvad_fetchid, daemon=True,
                     name="ada-fetch-recovery").start()
    # Rippuv `applying` → awaiting_split või error (#256). Restart tapab
    # apply-lõime enne, kui ta staatust muuta jõuab; ilma taasteta jääb upload
    # igaveseks „OCR server töötleb…" alla. Otsus tuleb lokaalsest state'ist,
    # SSH-d siin EI OLE (ADR 0002).
    from .upload.apply_recovery import taasta_rippuvad_applyd
    threading.Thread(target=taasta_rippuvad_applyd, daemon=True,
                     name="apply-recovery").start()
    yield
    print("VUTT FastAPI sulgemine.")

app = FastAPI(title="VUTT API", version="1.0.0", lifespan=lifespan)
app.include_router(prosopography_router, prefix="/prosopography")
app.include_router(notifications_router)
app.include_router(upload_router)
app.include_router(reocr_router)
app.include_router(ocr_jobs_router)
app.include_router(pages_router)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(user_settings_router)
app.include_router(public_registries_router)
app.include_router(public_router)
app.include_router(editing_router)
app.include_router(collections_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================================================
# AUTENTIMISE DEPENDENCY
# =========================================================

# =========================================================
# AUTENTIMISE DEPENDENCY (ühine — server/deps.py)
# =========================================================
# Refaktoreeringu Faas 0: funktsioonid on tõstetud server/deps.py-sse, et
# luua üks tõene allikas kõigile domeeni-routeritele (vt
# docs/_archive/REFACTOR_main_py_2026-06-25.md). Siin jäetakse backward-compat
# re-eksport, sest osa main.py endpointe ja teste viitab neile nimedele.
from .deps import get_user, require_role, get_json_data

# Teose _metadata.json lugemine (ühine — server/work_meta.py). Kasutatakse
# viewer-token, shareable, download, SEO meta ja collections ligipääsukontrollis.

# =========================================================
# TOIMETAMINE JA SALVESTAMINE
# =========================================================

# =========================================================
# TEAVITUSED (notifications) — tõstetud Faas 1 server/routers/notifications.py +
# server/notifications_ops.py. Siin backward-compat re-eksport, sest osa main.py
# endpointe ja teste võivad viidata vanadele ``_``-nimedele.
# =========================================================
from .notifications_ops import (
    safe_username as _safe_username,
    get_notifications_path as _get_notifications_path,
    load_notifications as _load_notifications,
    save_notifications as _save_notifications,
    append_notification as _append_notification,
    create_notification as _create_notification,
    find_username_by_display_name as _find_username_by_display_name,
    _notifications_lock,
)


# =========================================================
# AVALIKUD ANDMED JA SEO
# =========================================================

@app.get("/health")
async def health(): return {"status": "ok"}


# NB: admin-only — lekitab sisemist operatiivinfot (last_error stringid, dir_name'id).
# Avalik /health (üleval) jääb liveness-checkiks. Tee on /admin/ all, et nginx
# proksiks selle /api/files/admin/ kaudu; auth jõustub app-tasandil (require_role).
@app.get("/admin/health/background")
async def background_health(user=Depends(require_role("admin"))):
    """Taustatööde heartbeat ja Meilisearch async queue seis (ainult admin)."""
    data = heartbeat_snapshot()
    data["meilisearch_sync"] = get_meilisearch_sync_status()
    return data

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
