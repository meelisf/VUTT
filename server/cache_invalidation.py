from .cache import invalidate_cache

_sitemap_cache: dict = {"xml": None, "expires": 0.0}


def invalidate_all_caches():
    """Tühjendab kõik cache'id: kollektsioonid, soovitused, sitemap."""
    invalidate_cache()
    _sitemap_cache["xml"] = None
