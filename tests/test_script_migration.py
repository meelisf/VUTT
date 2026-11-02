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
