"""OCR-i lagunemise (loop) tuvastus — puhas, side-effect-vaba loogika (#227).

Mudel satub mõnikord kordusesse ja täidab lehekülje sama mustriga
(„. S. S. S. …" või „Propoſit. XII. Propoſit. XII. …"). Selline tekst läheb
`lehekylje_tekst`-ina Meilisse ja bot-prerenderis Google'ile, kes loeb korduva
tokeni müüri gibberish'iks.

MÕÕDIKU VALIK (mõõdetud tootmiskorpusel 2026-08-09, 21 747 lehte >=50 tokenit):

  pikim järjestikune sama token   p95 = 2      p99,5 = 959
  korduva mustri kate leheküljest p95 = 0,015  p99,5 = 0,95

Kaks selgelt eraldi populatsiooni — läviväärtuse täpne koht on peaaegu
tähtsusetu (`reps >= 10` annab 273 lehte, `>= 50` annab 264).

Detektor on ABSOLUUTNE korduste arv, MITTE katte-osakaal:
- katte-reegel andis alla 50 tokeni lehtedel 240 valepositiivi (4-tokeniline
  lehekülg on „100% kate"), korduste-reegel ainult ühe;
- korduste-reegel on katte-reegli range ülemhulk (263 ühist, 10 ainult
  korduste omaga, 0 ainult kattega) — ei vaja minimaalse pikkuse piirangut.

Periood 2–5 on kohustuslik: 94 juhtu 250-st on „A B A B" tüüpi, mida ühe
tokeni loendur ei näeks. Periood 5 -> 20 (2026-08-25): mustriks võib olla ka
MITMEREALINE plokk. Töö 5qdpq4 lk 45 kordas „Bruks Dagh / För år D:r Lax"
(6 sõna) 315 korda ja lk 21 17-sõnalist plokki 87 korda — kumbki ei mahtunud
perioodi 5 alla. Ülempiiri tõstmine on range ÜLEMHULK: pikem periood ei saa
anda rohkem kordusi kui lühem, seega varasemad leiud ei muutu.

Lehekülje PIKKUS on kinnitav signaal, mitte kriteerium: loopinud lehe mediaan
on 1364 tokenit, puhta oma 281 — aga laeni jookseb ainult pool loopidest
(139/273) ja 55 puhast lehte on üle 1300 tokeni. Raport kuvab pikkuse
kindluse-vihjena, detektor seda ei kasuta.
"""
from .meili_doc import clean_text_for_search


def _longest_cycle(toks, max_period):
    """Pikim JÄRJESTIKUNE korduv n-gramm. Tagastab (periood, korduste arv, algus)."""
    best = (0, 0, 0)
    n = len(toks)
    for period in range(1, max_period + 1):
        i = 0
        while i + period <= n:
            reps = 1
            j = i + period
            while j + period <= n and toks[j:j + period] == toks[i:i + period]:
                reps += 1
                j += period
            if reps > best[1]:
                best = (period, reps, i)
            # Kordunud plokist saab otse üle hüpata; muidu edasi ühe võrra.
            i = j - period if reps > 1 else i + 1
    return best


def find_repeat_loop(text, min_reps=10, max_period=20):
    """Otsib lehekülje tekstist korduse-loopi.

    Tagastab ``None``, kui loopi ei ole, muidu::

        {'period': 2, 'reps': 25, 'tokens': 50, 'cover': 1.0,
         'pattern': 'Propoſit. XII.'}

    ``cover`` on korduse osakaal leheküljest (raportis kuvamiseks, mitte
    kriteeriumiks). Tekst puhastatakse ``clean_text_for_search``-iga, nii et
    VUTT-i märgendus ja reavahetuse poolitused ei tekitaks võltskordusi —
    sama teisendus, mis läheb otsinguindeksisse.
    """
    if not text:
        return None
    toks = clean_text_for_search(text).split()
    if not toks:
        return None

    period, reps, start = _longest_cycle(toks, max_period)
    if reps < min_reps:
        return None

    return {
        "period": period,
        "reps": reps,
        "tokens": len(toks),
        "cover": period * reps / len(toks),
        "pattern": " ".join(toks[start:start + period]),
    }
