"""Prosopograafia asukoha invariant: ÜKS juur, mitte kolm.

Taust (#221): kaardid migreeriti 2026-05-25 data/config/prosopography/ alla,
aga pildid jäid state/-i ja kaks vana koopiat kogusid enda ümber kasutajaid.
Need testid on selle vastu, et asukohad vaikselt uuesti lahku läheksid.
"""
import os

from server import config


def test_pildid_on_prosopograafia_juure_all():
    """PROSOPOGRAPHY_IMAGES_DIR peab olema PROSOPOGRAPHY_DIR alamkaust."""
    root = os.path.realpath(config.PROSOPOGRAPHY_DIR)
    images = os.path.realpath(config.PROSOPOGRAPHY_IMAGES_DIR)
    assert os.path.commonpath([root, images]) == root
    assert os.path.basename(images) == "images"


def test_prosopograafia_juur_on_data_config_all():
    """Juur ise peab elama data/config/-is, mitte state/-is."""
    data_config = os.path.realpath(config.DATA_CONFIG_DIR)
    root = os.path.realpath(config.PROSOPOGRAPHY_DIR)
    assert os.path.commonpath([data_config, root]) == data_config


def test_uhtegi_prosopograafia_teed_ei_ehitata_state_alt():
    """state/ ei tohi esineda ÜHESKI prosopograafia teekonstandis."""
    state = os.path.realpath(config.STATE_DIR)
    for name in ("PROSOPOGRAPHY_DIR", "PROSOPOGRAPHY_IMAGES_DIR",
                 "PROSOPOGRAPHY_INDEX_FILE", "PERSON_ALIASES_FILE"):
        path = os.path.realpath(getattr(config, name))
        assert os.path.commonpath([state, path]) != state, (
            "{} osutab veel state/-i: {}".format(name, path)
        )
