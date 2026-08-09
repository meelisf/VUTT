# tests/test_ocr_loop_audit.py
"""OCR-i lagunemise (loop) tuvastus — #227.

Mõõdetud korpusel 2026-08-09 (21 747 lehte >=50 tokenit):
  pikim järjestikune sama token: p95 = 2, p99,5 = 959
  → kaks selgelt eraldi populatsiooni, vahepealset ala peaaegu ei ole.

Detektor on ABSOLUUTNE korduste arv, mitte katte-osakaal: katte-reegel andis
lühikestel lehtedel 240 valepositiivi (4-tokeniline lehekülg = "100% kate"),
korduste-reegel ainult ühe. Periood 2–5 on kohustuslik — 94 juhtu 250-st on
'A B A B' tüüpi, mida ühe tokeni loendur ei näeks.
"""
import pytest

from server.ocr_loop_audit import find_repeat_loop


class TestPuhasTekst:
    def test_tavaline_ladina_tekst_ei_ole_loop(self):
        text = ("De philosophia Romanorum commentatus est Carolus Kühlstaedt. "
                "Populus Romanus inde a prima origine bellis cum exteris gentibus "
                "gerundis unice fere deditus regnique sui latius extendendi cupiditate")
        assert find_repeat_loop(text) is None

    def test_tyhi_tekst(self):
        assert find_repeat_loop("") is None
        assert find_repeat_loop(None) is None

    def test_luhike_leht_ei_ole_loop(self):
        """4-tokeniline lehekülg annab 100% katte, aga kordusi on kaks — mitte loop."""
        assert find_repeat_loop("Ad lectorem Ad lectorem") is None

    def test_paar_kordust_alla_lave(self):
        assert find_repeat_loop("S. " * 9) is None


class TestLoop:
    def test_yhe_tokeni_kordus(self):
        loop = find_repeat_loop("Praefatio " + "S. " * 40)
        assert loop is not None
        assert loop["period"] == 1
        assert loop["reps"] == 40
        assert loop["pattern"] == "S."

    def test_kahe_tokeni_vaheldumine(self):
        """'A B A B …' — ühe tokeni loendur ei näeks siin midagi."""
        loop = find_repeat_loop("Propoſit. XII. " * 25)
        assert loop is not None
        assert loop["period"] == 2
        assert loop["reps"] == 25
        assert loop["pattern"] == "Propoſit. XII."

    def test_nelja_tokeni_muster(self):
        loop = find_repeat_loop("a b c d " * 15)
        assert loop is not None
        assert loop["period"] == 4
        assert loop["reps"] == 15

    def test_osaline_loop_pika_lehe_lopus(self):
        """Mudel kordas alles lehe lõpus — kate on väike, aga kordusi palju."""
        text = " ".join(f"sona{i}" for i in range(400)) + " " + "S. " * 30
        loop = find_repeat_loop(text)
        assert loop is not None
        assert loop["reps"] == 30
        assert loop["cover"] < 0.2      # kate madal — katte-reegel jätaks vahele

    def test_tokenite_arv_ja_kate(self):
        loop = find_repeat_loop("S. " * 50)
        assert loop["tokens"] == 50
        assert loop["cover"] == pytest.approx(1.0)


class TestMargendus:
    def test_vutt_tagid_ei_loe_kordusteks(self):
        """<i>…</i> paarid ei tohi ise korduseks muutuda."""
        text = " ".join(f"<i>sona{i}</i>" for i in range(60))
        assert find_repeat_loop(text) is None

    def test_marginaalia_sees_olev_loop_leitakse(self):
        assert find_repeat_loop("tekst <m>" + "S. " * 30 + "</m>") is not None

    def test_reavahetuse_poolitus_liidetakse_enne_lugemist(self):
        """gro⸗\\nße → grosse; poolitus ei tohi tekitada võltskordust."""
        text = "gro⸗\nsse " * 20
        loop = find_repeat_loop(text)
        assert loop is not None
        assert loop["pattern"] == "grosse"


class TestLavi:
    def test_min_reps_on_seadistatav(self):
        assert find_repeat_loop("S. " * 5, min_reps=3) is not None
        assert find_repeat_loop("S. " * 5, min_reps=20) is None

    def test_maksimaalne_periood_piirab(self):
        text = "a b c d e f g " * 12          # periood 7
        assert find_repeat_loop(text, max_period=5) is None
        assert find_repeat_loop(text, max_period=7) is not None
