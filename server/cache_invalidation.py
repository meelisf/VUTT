from .cache import invalidate_cache

_sitemap_cache: dict = {"xml": None, "expires": 0.0}
_home_cache: dict = {"html": None, "expires": 0.0}
_work_meta_cache: dict = {}  # work_id -> (mtime_key: float, html: str)


def invalidate_all_caches():
    """Tühjendab kõik cache'id: kollektsioonid, soovitused, sitemap ja bot-HTML."""
    invalidate_cache()
    _sitemap_cache["xml"] = None
    _home_cache["html"] = None
    _work_meta_cache.clear()
