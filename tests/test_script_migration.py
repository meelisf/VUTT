"""ADR 0077: suhtelise <cs> teisendus absoluutseks <f>-iks + põhikirja signaal."""
from server.script_migration import cs_to_f, hyphen_signal, infer_base, is_premigration_base, text_hash


# --- antiikvateos: ümbernimetamine ---

def test_antiikvateos_cs_on_f():
    assert cs_to_f("Thesis <cs>Gott sey Lob</cs> prima", "A") == "Thesis <f>Gott sey Lob</f> prima"


def test_antiikvateos_ilma_cs_ita_muutumata():
    assert cs_to_f("Thesis prima", "A") == "Thesis prima"


def test_antiikvateos_cs_kursiiviga_kursiiv_voidab():
    # <f> ja <i> välistavad teineteist: kursiiv on alati antiikva
    assert cs_to_f("<cs>Gott <i>Deus</i></cs>", "A") == "<f>Gott</f> <i>Deus</i>"


# Sisemine täg otsustab: <cs> kursiivi SEES on antiikvateoses fraktuurisõna kursiivlõigus
# (nimed, kohanimed). Esimene migratsioon viskas selle ära (91 Valmis-lehte, 2026-11-02).

def test_antiikvateos_cs_kursiivi_sees_on_f_kursiiv_tykeldub():
    assert cs_to_f("<i>ne in <cs>Frödzwijck</cs> &c. Regij</i>", "A") == \
        "<i>ne in </i><f>Frödzwijck</f><i> &c. Regij</i>"


def test_antiikvateos_cs_kursiivi_alguses_tyhja_kursiivi_ei_jaa():
    assert cs_to_f("<i><cs>Saalſtad</cs>/ Domine</i>", "A") == "<f>Saalſtad</f><i>/ Domine</i>"


def test_antiikvateos_cs_kursiivis_vale_pesastusega():
    # tootmisest: <cs> suletakse pärast </i>-d
    assert cs_to_f("<i><cs>Saalſtad</cs>/ Domine in <cs>Frödz⸗</i></cs>", "A") == \
        "<f>Saalſtad</f><i>/ Domine in </i><f>Frödz⸗</f>"


def test_antiikvateos_cs_kursiivis_ainult_kirjavahemark_ei_tykelda():
    assert cs_to_f("<i>a <cs>.</cs> b</i>", "A") == "<i>a . b</i>"


def test_antiikvateos_cs_kursiivis_mitu_rida():
    assert cs_to_f("<i>in <cs>Frödz⸗</cs></i>\n<i><cs>wijck</cs> &c.</i>", "A") == \
        "<i>in </i><f>Frödz⸗</f>\n<f>wijck</f><i> &c.</i>"


def test_fraktuurteos_cs_kursiivis_jaab_antiikvaks():
    assert cs_to_f("<i>Deus <cs>Christus</cs></i>", "F") == "<i>Deus Christus</i>"
    # tootmisest (1632-1 Relatio): kahekordne <cs> ümber kursiivi
    assert cs_to_f("<cs><i><cs>Fridericus Menius</i></cs>", "F") == "<i>Fridericus Menius</i>"


def test_cs_inside_italic():
    from server.script_migration import cs_inside_italic
    assert cs_inside_italic("<i>in <cs>Frödz⸗</cs></i>")
    assert cs_inside_italic("<i>a\nb <cs>X</cs></i>")
    assert not cs_inside_italic("<cs>Gott <i>Deus</i></cs>")
    assert not cs_inside_italic("<i>a</i> <cs>X</cs>")


def test_pesastatud_cs_ei_poora_tagasi():
    # tootmisest (1647-17): sisemine <cs> on topeltmärgendus, mitte tagasipööre
    assert cs_to_f("<cs>Konungs <cs>Balker</cs></cs>", "A") == "<f>Konungs</f> <f>Balker</f>"


# --- fraktuurteos: ümberpööramine ---

def test_fraktuurteos_rida_mahitakse():
    assert cs_to_f("sich bey den <cs>exercitiis</cs> finden", "F") == \
        "<f>sich bey den</f> exercitiis <f>finden</f>"


def test_fraktuurteos_servamargid_sees():
    assert cs_to_f("(Gott sey Lob).", "F") == "<f>(Gott sey Lob).</f>"
    assert cs_to_f("vnd Ge⸗\nwitter", "F") == "<f>vnd Ge⸗</f>\n<f>witter</f>"


def test_fraktuurteos_numbrid_lauses_sees_eraldi_valja():
    assert cs_to_f("im Jahr 1644. am 3. Martii", "F") == "<f>im Jahr 1644. am 3. Martii</f>"
    assert cs_to_f("12", "F") == "12"


def test_fraktuurteos_kreeka_katkestab():
    assert cs_to_f("vom λόγος wort", "F") == "<f>vom</f> λόγος <f>wort</f>"


def test_fraktuurteos_struktuuritagi_sees():
    assert cs_to_f("<catch>Vor⸗</catch>", "F") == "<catch><f>Vor⸗</f></catch>"
    assert cs_to_f("<m>Ge⸗</m>", "F") == "<m><f>Ge⸗</f></m>"


def test_fraktuurteos_kursiiv_fn_pb_valjas():
    assert cs_to_f("Text <i>exercitiis</i> mehr", "F") == "<f>Text</f> <i>exercitiis</i> <f>mehr</f>"
    assert cs_to_f("Wort<fn>1</fn><pb/>", "F") == "<f>Wort</f><fn>1</fn><pb/>"
    assert cs_to_f("<cs><i>Deus</i></cs>", "F") == "<i>Deus</i>"


def test_juba_absoluutne_tekst_muutumata():
    assert cs_to_f("<f>schon</f> Antiqua", "F") == "<f>schon</f> Antiqua"


# --- põhikirja signaal ---

def test_signaal_poolitusmargist():
    assert hyphen_signal(["vnd Ge⸗\nwitter", "<cs>Ex-</cs>\nemplum"]) == (2, 0)
    assert hyphen_signal(["ex-\nemplum", "<cs>Got⸗</cs>\nt"]) == (0, 2)


def test_signaal_sulgevad_tagid_ja_vahemik():
    assert hyphen_signal(["<m><f>Ge⸗</f></m>"]) == (1, 0)
    assert hyphen_signal(["anno 1640-\n1650"]) == (0, 0)


def test_infer_base_vastuolu_on_none():
    assert infer_base(["Ge⸗\nx", "ex-\ny"])[0] is None
    assert infer_base(["Ge⸗\nx"])[0] == "F"
    assert infer_base(["kein Signal"])[0] is None


# --- manifest ---

def test_premigration_base():
    manifest = {"works": {"w1": {"base": "F", "pages": {
        "p1.txt": {"in": text_hash("vana"), "out": text_hash("<f>vana</f>")},
        "p2.txt": {"in": text_hash("sama"), "out": text_hash("sama")},
    }}}}
    assert is_premigration_base("w1", "p1.txt", "vana", manifest)
    assert not is_premigration_base("w1", "p1.txt", "<f>vana</f>", manifest)
    assert not is_premigration_base("w1", "p2.txt", "sama", manifest)  # teisendus ei muutnud
    assert not is_premigration_base("w2", "p1.txt", "vana", manifest)


# --- keelepõhine põhikiri ---
from server.script_migration import detect_language, to_absolute  # noqa: E402


def test_keeletuvastus():
    assert detect_language("Disputatio de anima quae est in corpore et non sine Deo") == "lat"
    assert detect_language("Vnd die Hand deß HErrn kompt vber dich vnd ſolt blind ſein") == "deu"
    assert detect_language("Een Juugfru dygdig och som liufſte blomſter är") == "swe"
    assert detect_language("Thesis") is None


def test_cs_leht_pohikiri_valjaspool_cs_i_keelest():
    t = "Dort dein Tisbit, O HERR! <cs>expostulirte</cs> vnd die Welt ist nicht mehr"
    new, info = to_absolute(t, "Toores")
    assert info["base"] == "F" and info["kind"] == "cs"
    assert "expostulirte" in new and "<f>Dort dein Tisbit, O HERR!</f>" in new
    t2 = "L. B. in <cs>Düderoff</cs>/ Domino in quod est et non"
    new2, info2 = to_absolute(t2, "Toores")
    assert info2["base"] == "A" and new2 == "L. B. in <f>Düderoff</f>/ Domino in quod est et non"


def test_cs_ita_saksa_leht_mahitakse_ladina_jaab():
    new, info = to_absolute("vnd die Welt ist nicht\nmit dem Herrn auff", "Toores")
    assert info["kind"] == "whole" and new == "<f>vnd die Welt ist nicht</f>\n<f>mit dem Herrn auff</f>"
    new2, info2 = to_absolute("Quod est in corpore\net non sine Deo", "Toores")
    assert info2["kind"] == "antiqua" and new2 == "Quod est in corpore\net non sine Deo"


def test_segaleht_rea_kaupa():
    t = ("Quae est in corpore et non sine Deo\nsed in anima quod est\n"
         "Vnd die Welt ist nicht mehr\nmit dem Herrn auff Erden\nSolch Lob")
    new, info = to_absolute(t, "Toores")
    assert info["kind"] == "mixed"
    lines = new.split("\n")
    assert "<f>" not in lines[0] and "<f>" not in lines[1]
    assert lines[2].startswith("<f>") and lines[4] == "<f>Solch Lob</f>"  # pärib eelmise


def test_ule_vaadatud_lehe_poolitus_vastuolus_keelega():
    new, info = to_absolute("Vnd die Welt ist nicht ex-\nmit dem Herrn auff", "Valmis")
    assert info["conflict"] is True and info["base"] == "F"


def test_lehe_otsus_voidab_ja_tundmatu():
    assert to_absolute("vnd die Welt ist nicht", "Toores", override="A")[1]["kind"] == "antiqua"
    _, info = to_absolute("Xyz <cs>abc</cs>", "Toores")
    assert info["kind"] == "unknown"
    _, info2 = to_absolute("Xyz <cs>abc</cs>", "Toores", fallback="F")
    assert info2["base"] == "F" and info2["reason"] == "teose otsus"


def test_terve_leht_cs_is_pohikiri_sisu_vastand():
    new, info = to_absolute("<cs>vnd die Welt ist nicht mit dem Herrn</cs>", "Toores")
    assert info["base"] == "A" and info["reason"] == "<cs>-i sisu keel"
    assert new == "<f>vnd die Welt ist nicht mit dem Herrn</f>"


def test_toimetaja_marge_nurksulgudes_ei_lahe_f_i():
    assert cs_to_f("[tühi lehekülg]", "F") == "[tühi lehekülg]"
    assert cs_to_f("vnd Ge⸗ [loetamatu] witter", "F") == "<f>vnd Ge⸗</f> [loetamatu] <f>witter</f>"
