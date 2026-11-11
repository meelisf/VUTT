"""Välised Docker-pildid on kinnitatud täpse versiooniga (#764 N10-10).

Ujuv tag (`latest`, `v1`, `postgresql-latest`) laseks käsitsi `pull`-il versiooni
andmekausta alt ära nihutada — Meili andmekaust on versioonitundlik.
Oma pilt (`vutt-backend:latest`) ehitatakse kohapeal ja on erand.
"""
import re
from pathlib import Path

COMPOSE = Path(__file__).resolve().parents[1] / "docker-compose.yml"
OMA_PILDID = {"vutt-backend"}
# Lubatud: täpne versioon (v1.33.1, 3.0.3) või major.minor-alpine stiilis Postgres (15-alpine).
UJUV = re.compile(r"(^|[-.])latest$|^v?\d+$")


def _images():
    for line in COMPOSE.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*image:\s*(\S+)", line)   # kommenteeritud read (# image:) jäävad välja
        if m:
            yield m.group(1)


def test_valised_pildid_on_kinnitatud():
    images = list(_images())
    assert images, "docker-compose.yml-ist ei leitud ühtki pilti"
    for image in images:
        name, _, tag = image.rpartition(":")
        if name.rsplit("/", 1)[-1] in OMA_PILDID:
            continue
        assert tag and not UJUV.search(tag), f"ujuv tag: {image}"


def test_meili_ja_umami_tootmise_versioonil():
    images = set(_images())
    assert "getmeili/meilisearch:v1.33.1" in images
    assert "ghcr.io/umami-software/umami:3.0.3" in images
