"""Prepress-plaani puhas geomeetria. Ilma failideta, ilma PDF-ita."""
import pytest

from server.upload import prepress_plan as pp


def _plan(**over):
    """Kolme lehega plaan, kõik vaikeseades: ükski leht ei poolitu."""
    plan = pp.default_plan(3)
    plan.update(over)
    return plan


def _split_plan(**over):
    """Kolme lehega plaan, kus KÕIK lehed poolituvad üldjoonelt.

    Vastab vanale `enabled=True` seisule — uues mudelis kannab sama tähendust
    lehe `mode: "default"`, mille annab „Poolita kõik".
    """
    plan = _plan(**over)
    for page in plan["pages"]:
        page["mode"] = "default"
    return plan


# --- default_plan ---

# --- effective_split_x ---

def test_valjajatmine_ei_kustuta_kasitsi_seatud_joont():
    """§11: excluded ja mode on risti. Väljajätmine domineerib väljundi
    koostamisel (page_cuts), aga poolitusolek jääb alles ja hakkab uuesti
    kehtima, kui leht OCR-i tagasi lisatakse."""
    plan = _plan()
    plan["pages"][0].update(mode="custom", split_x=0.42, excluded=True)
    assert pp.page_cuts(plan, 1, 100) == []
    assert pp.effective_split_x(plan, 1) == 0.42   # olek alles
    plan["pages"][0]["excluded"] = False
    assert pp.page_cuts(plan, 1, 100) == [(0, 42), (42, 100)]


def test_default_mode_kasutab_globaalset_joont():
    plan = _split_plan(default_split_x=0.48)
    assert pp.effective_split_x(plan, 1) == 0.48


def test_custom_mode_kirjutab_globaalse_ule():
    plan = _split_plan(default_split_x=0.5)
    plan["pages"][1].update(mode="custom", split_x=0.46)
    assert pp.effective_split_x(plan, 1) == 0.5
    assert pp.effective_split_x(plan, 2) == 0.46


def test_nosplit_mode_ei_poolita():
    plan = _split_plan()
    plan["pages"][2]["mode"] = "nosplit"
    assert pp.effective_split_x(plan, 3) is None


def test_tundmatu_leht_ja_puuduv_plaan():
    assert pp.effective_split_x(None, 1) is None
    assert pp.effective_split_x(_split_plan(), 99) is None


# --- is_trivial_plan ---

def test_tyhi_plaan_on_triviaalne():
    """REGRESSIOON: triviaalne plaan peab andma tänase PDF-teekonna."""
    assert pp.is_trivial_plan(None) is True
    assert pp.is_trivial_plan(pp.default_plan(3)) is True


def test_ainult_valjajatmised_on_triviaalne():
    """Väljajätmised EI mõjuta triviaalsust — originaalfail saadetakse edasi."""
    plan = _split_plan()
    for p in plan["pages"]:
        p["mode"] = "nosplit"
    plan["pages"][0]["excluded"] = True
    assert pp.is_trivial_plan(plan) is True


def test_uks_poolitus_teeb_plaani_mittetriviaalseks():
    plan = _split_plan()
    for p in plan["pages"]:
        p["mode"] = "nosplit"
    plan["pages"][1]["mode"] = "default"
    assert pp.is_trivial_plan(plan) is False


# --- page_cuts: piksliinvariandid ---

@pytest.mark.parametrize("width", [100, 101, 2280, 2281, 4961])
def test_poolitus_ei_kaota_ega_dubleeri_veergu(width):
    """cut_px täpselt piiril: len(vasak) + len(parem) == width."""
    plan = _split_plan(default_split_x=0.5)
    cuts = pp.page_cuts(plan, 1, width)
    assert len(cuts) == 2
    (l0, l1), (r0, r1) = cuts
    assert l0 == 0 and r1 == width
    assert l1 == r0                       # ei kattu, ei jäta auku
    assert (l1 - l0) + (r1 - r0) == width  # ükski veerg ei kao


@pytest.mark.parametrize("x", [0.05, 0.4999, 0.5, 0.5001, 0.95])
def test_poolitus_servavaartustel_jatab_molemad_pooled_mittetyhjaks(x):
    plan = _split_plan(default_split_x=x)
    (l0, l1), (r0, r1) = pp.page_cuts(plan, 1, 2280)
    assert l1 - l0 >= 1
    assert r1 - r0 >= 1


def test_erineva_laiusega_lehed_kasutavad_sama_x_frac_oigesti():
    """Skaneeringute laius kõigub päriselt (mõõdetud 2280–2344 px).
    Iga leht arvutab oma cut_px OMA laiusest."""
    plan = _split_plan(default_split_x=0.5)
    assert pp.page_cuts(plan, 1, 2280)[0][1] == 1140
    assert pp.page_cuts(plan, 2, 2344)[0][1] == 1172
    assert pp.page_cuts(plan, 3, 2303)[0][1] == 1152  # round(1151.5) → 1152


def test_poolitamata_leht_annab_yhe_taislaiuse_loike():
    assert pp.page_cuts(pp.default_plan(1), 1, 2280) == [(0, 2280)]


def test_valjajaetud_leht_annab_tyhja_listi():
    plan = _split_plan()
    plan["pages"][0]["excluded"] = True
    assert pp.page_cuts(plan, 1, 2280) == []


# --- plan_to_sequence ja output_page_count ---

def test_plan_to_sequence_nummerdab_vasak_parem_jarjekorras():
    plan = _split_plan(default_split_x=0.5)
    plan["pages"][1]["mode"] = "nosplit"
    plan["pages"][2]["excluded"] = True
    seq = pp.plan_to_sequence(plan, [100, 100, 100])
    assert seq == [
        {"src_page": 1, "x0": 0, "x1": 50, "out_index": 1},
        {"src_page": 1, "x0": 50, "x1": 100, "out_index": 2},
        {"src_page": 2, "x0": 0, "x1": 100, "out_index": 3},
    ]


def test_output_page_count_ei_vaja_laiusi():
    plan = _split_plan()
    plan["pages"][1]["mode"] = "nosplit"
    plan["pages"][2]["excluded"] = True
    assert pp.output_page_count(plan, 3) == 3
    assert pp.output_page_count(pp.default_plan(3), 3) == 3


def test_vaikeplaan_ei_poolita_uhtki_lehte():
    """§2: default_split_x on üldjoone väärtus, mitte rakendatud joon."""
    plan = pp.default_plan(3)
    assert [p["mode"] for p in plan["pages"]] == ["nosplit"] * 3
    assert plan["default_split_x"] == 0.5
    assert "enabled" not in plan
    assert pp.output_page_count(plan, 3) == 3
    assert pp.is_trivial_plan(plan) is True


def test_poolita_koik_annab_default_moodi_lehed():
    plan = pp.default_plan(2)
    for page in plan["pages"]:
        page["mode"] = "default"
    assert pp.effective_split_x(plan, 1) == 0.5
    assert pp.output_page_count(plan, 2) == 4
    assert pp.is_trivial_plan(plan) is False


def test_legacy_plaan_enabled_false_ei_hakka_poolitama():
    """MIGRATSIOON: staging'us olevad plaanid kannavad veel vana kuju."""
    legacy = {
        "enabled": False,
        "default_split_x": 0.5,
        "preview_status": "ready",
        "preview_done": 3,
        "pages": [
            {"n": 1, "mode": "default", "split_x": None, "excluded": False},
            {"n": 2, "mode": "custom", "split_x": 0.4, "excluded": False},
            {"n": 3, "mode": "nosplit", "split_x": None, "excluded": True},
        ],
    }
    pp.normalize_legacy_plan(legacy)

    assert "enabled" not in legacy
    assert legacy["pages"][0]["mode"] == "nosplit"      # default → nosplit
    assert legacy["pages"][1]["mode"] == "custom"       # käsitsi töö jääb
    assert legacy["pages"][1]["split_x"] == 0.4
    assert legacy["pages"][2]["excluded"] is True


def test_legacy_plaan_enabled_true_sailitab_poolituse():
    legacy = {
        "enabled": True,
        "default_split_x": 0.5,
        "pages": [{"n": 1, "mode": "default", "split_x": None, "excluded": False}],
    }
    pp.normalize_legacy_plan(legacy)
    assert "enabled" not in legacy
    assert legacy["pages"][0]["mode"] == "default"      # jäi poolituma


def test_normaliseerimine_on_idempotentne():
    plan = pp.default_plan(2)
    pp.normalize_legacy_plan(plan)
    pp.normalize_legacy_plan(plan)
    assert [p["mode"] for p in plan["pages"]] == ["nosplit", "nosplit"]
