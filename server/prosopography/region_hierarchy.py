"""Halduspiirkondade hierarhia: lapsele lähima ülemise tasandi vanema leidmine.

Puhas geomeetria — ei tea Overpassist, cache'ist ega GeoJSON-i kujust midagi.
OHM-i `admin_level`-is on VÄIKSEM arv kõrgem tasand (2 = riik, 3 = selle osa).
"""

from typing import List, Optional, Sequence

from shapely.errors import GEOSException
from shapely.geometry.base import BaseGeometry

# Osa lapse pindalast, mis peab kandidaadi sisse jääma, et teda vanemaks lugeda.
# Osaliselt kattuv üksus (nt Brandenburg-Preußen, mille üks pool jääb HRR-ist
# välja) peab jääma vanemata: puuduv vanem on parem kui vale vanem.
PARENT_MIN_CONTAINMENT = 0.75


def _containment_ratio(child: BaseGeometry, candidate: BaseGeometry, child_area: float) -> float:
    """Osa lapse pindalast, mis jääb kandidaadi sisse."""
    if candidate.contains(child):
        return 1.0
    if not candidate.intersects(child):
        return 0.0
    try:
        return candidate.intersection(child).area / child_area
    except GEOSException:
        # Üks vigane polügoon ei tohi kogu piirkonnakihti maha võtta.
        return 0.0


def _parent_index(
    index: int,
    levels: Sequence[int],
    geometries: Sequence[BaseGeometry],
    ancestor_levels: Sequence[int],
    min_containment: float,
) -> Optional[int]:
    child = geometries[index]
    child_area = child.area
    if child_area <= 0:
        return None

    # Lähim ülemine tase enne kaugemat: level 4 otsib kõigepealt level-3 vanemat.
    for candidate_level in ancestor_levels:
        if candidate_level >= levels[index]:
            continue
        best_index = None
        best_ratio = 0.0
        for other, other_level in enumerate(levels):
            if other == index or other_level != candidate_level:
                continue
            ratio = _containment_ratio(child, geometries[other], child_area)
            if ratio >= min_containment and ratio > best_ratio:
                best_index = other
                best_ratio = ratio
        if best_index is not None:
            return best_index
    return None


def find_parents(
    levels: Sequence[int],
    geometries: Sequence[BaseGeometry],
    min_containment: float = PARENT_MIN_CONTAINMENT,
) -> List[Optional[int]]:
    """Igale elemendile vanema indeks samas järjestuses või None.

    Ruutkeerukus on siinsete mahtude juures (Euroopas ~80–300 piirkonda) tähtsusetu.
    """
    ancestor_levels = sorted(set(levels), reverse=True)
    return [
        _parent_index(index, levels, geometries, ancestor_levels, min_containment)
        for index in range(len(levels))
    ]
