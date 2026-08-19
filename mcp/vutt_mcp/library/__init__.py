"""Lokaalne sekundaarkirjanduse kogu (valikuline moodul).

Erand `vutt_mcp` senisest invariandist „õhuke klient avaliku API otsas, oma
olekut ei hoia" — vt ADR ja spekk 2026-08-19-kirjanduse-kogu-mcp-design.md.
"""
from .config import LibrarySettings, library_available, load_library_settings

__all__ = ["LibrarySettings", "library_available", "load_library_settings"]
