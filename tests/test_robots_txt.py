# tests/test_robots_txt.py
import os

ROBOTS = os.path.join(os.path.dirname(__file__), "..", "public", "robots.txt")


def _read():
    with open(ROBOTS, encoding="utf-8") as f:
        return f.read()


def test_blocks_training_bots():
    txt = _read()
    for ua in ["GPTBot", "Google-Extended", "CCBot", "ClaudeBot", "anthropic-ai", "Bytespider"]:
        assert f"User-agent: {ua}" in txt, ua


def test_does_not_block_search_referral_bots():
    txt = _read()
    # Need EI TOHI olla eraldi Disallow-grupis
    for ua in ["OAI-SearchBot", "PerplexityBot", "Perplexity-User", "FirecrawlAgent"]:
        assert f"User-agent: {ua}" not in txt, ua


def test_keeps_sitemap_and_wildcard_group():
    txt = _read()
    assert "Sitemap: https://vutt.utlib.ut.ee/sitemap.xml" in txt
    assert "User-agent: *" in txt
    # Googlebot/Bingbot ei tohi olla üheski Disallow: / grupis
    assert "\nUser-agent: Googlebot\nDisallow: /" not in txt
