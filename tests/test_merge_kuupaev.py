"""Liitmise sünni-/surmaaeg: täpsem ühilduv kuupäev võidab (#240).

`1640` täpsusega „aasta" ja `1640-02-05` täpsusega „päev" on sama teadmine —
liitmine võtab täpsema, ükskõik kummal kaardil see on. Päris vastuolu
(`1555` vs `1556`) jätab ellujääva kaardi väärtuse.
"""
from server.prosopography.merge_ops import _merged_date


def _d(date, precision, place=None, **extra):
    return {"date": date, "precision": precision, "place": place, "original_text": None,
            "date_to": None, "bound": None, "calendar": None, "is_circa": False,
            "notes": None, **extra}


def test_allika_tapsem_kuupaev_tapsustab_sihi_aastat():
    tulemus = _merged_date(_d("1640-02-05", "day"), _d("1640-01-01", "year"))
    assert tulemus["date"] == "1640-02-05"
    assert tulemus["precision"] == "day"


def test_paljas_aasta_sihil_tapsustatakse_samuti():
    assert _merged_date(_d("1747-03-15", "day"), _d("1747", "year"))["date"] == "1747-03-15"


def test_kuu_tapsusega_siht_tapsustatakse_sama_kuu_paevaga():
    assert _merged_date(_d("1640-02-05", "day"), _d("1640-02-01", "month"))["date"] == "1640-02-05"


def test_sihi_koht_jaab_kui_allikal_kohta_pole():
    koht = {"id": "Q649", "label": "Moskva"}
    tulemus = _merged_date(_d("1705-05-05", "day"), _d("1705", "year", place=koht))
    assert tulemus["place"] == koht


def test_allika_koht_voidab_kui_moolemal_on():
    allika_koht = {"id": "Q649", "label": "Moskva"}
    tulemus = _merged_date(_d("1705-05-05", "day", place=allika_koht),
                           _d("1705", "year", place={"id": None, "label": "Moskau"}))
    assert tulemus["place"] == allika_koht


def test_sihi_tapsem_kuupaev_jaab():
    assert _merged_date(_d("1640", "year"), _d("1640-02-05", "day")) is None


def test_vastuolu_jatab_sihi_vaartuse():
    assert _merged_date(_d("1555", "year"), _d("1556", "year")) is None
    assert _merged_date(_d("1654-05-18", "day"), _d("1705", "year")) is None


def test_sama_tapsusega_erinev_paev_ei_ole_tapsustus():
    assert _merged_date(_d("1640-02-06", "day"), _d("1640-02-05", "day")) is None


def test_tapsus_puudu_ei_tapsustata():
    """Täpsuseta kuupäeva ei saa hinnata — kahtluse korral jääb siht."""
    assert _merged_date(_d("1640-02-05", "day"), _d("1640-01-01", None)) is None
    assert _merged_date(_d("1640-02-05", None), _d("1640", "year")) is None


def test_tuhi_siht_saab_allika():
    allikas = _d("1640", "year")
    assert _merged_date(allikas, None) == allikas
    assert _merged_date(allikas, _d(None, None)) == allikas


def test_tuhi_allikas_ei_muuda():
    assert _merged_date(None, _d("1640", "year")) is None
    assert _merged_date(_d(None, None), _d("1640", "year")) is None
