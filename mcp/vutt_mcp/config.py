"""Env-muutujate lugemine ja valideerimine.

`VUTT_MEILI_SEARCH_KEY` on ADR 0021 teadlik erand „üks nimi ühe seade kohta"
reeglist: VUTT-is kannab sama väärtus nime `MEILI_SEARCH_KEY`, aga see server
paigaldatakse pipx-iga globaalselt ega loe repo `.env`-i — prefiks väldib
kollisiooni kasutaja shellis oleva võõra `MEILI_SEARCH_KEY`-ga.
"""
import os
from dataclasses import dataclass

from .errors import VuttConfigError

DEFAULT_BASE_URL = "https://vutt.utlib.ut.ee"


@dataclass(frozen=True)
class Settings:
    base_url: str
    meili_key: str


def load_settings() -> Settings:
    """Loeb seaded keskkonnast. Võrku EI puuduta.

    Käivitamisel ei tehta ühtki päringut: VUTT-i lühike katkestus kliendi
    käivitamise hetkel ei tohi tähendada, et agent kaotab kogu
    tööriistakomplekti. Kehtetu võti selgub esimesel tööriistakutsel.
    """
    key = os.getenv("VUTT_MEILI_SEARCH_KEY", "").strip()
    if not key:
        raise VuttConfigError(
            "VUTT_MEILI_SEARCH_KEY puudub. Võta otsinguvõti VUTT-i serverist "
            "ja sea see keskkonnamuutujaks enne vutt-mcp käivitamist."
        )
    base = os.getenv("VUTT_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    return Settings(base_url=base, meili_key=key)
