from collections import Counter

from server.marginalia_audit import audit_marginalia
from server.marginalia_migrate import migrate_marginalia_per_line


def test_mitmerealine_plokk_jagatakse_ridadeks():
    result = migrate_marginalia_per_line("enne\n<m>üks\nkaks</m>\npärast")
    assert result.text == "enne\n<m>üks</m>\n<m>kaks</m>\npärast"
    assert result.regions_changed == 1


def test_tasakaalus_pesastus_lamendatakse():
    result = migrate_marginalia_per_line("<m><m>tekst</m></m>")
    assert result.text == "<m>tekst</m>"
    assert result.regions_changed == 1
    assert audit_marginalia(result.text) == []


def test_inline_tag_suletakse_ja_taasavatakse_reapiiril():
    result = migrate_marginalia_per_line("<m><i>üks\nkaks</i></m>")
    assert result.text == "<m><i>üks</i></m>\n<m><i>kaks</i></m>"


def test_tyhi_rida_sailib_ilma_tuhja_m_plokita():
    result = migrate_marginalia_per_line("<m>üks\n\nkaks</m>")
    assert result.text == "<m>üks</m>\n\n<m>kaks</m>"
    assert result.text.count("\n") == 2


def test_ainult_tuhja_inline_tagiga_rida_muutub_puhtaks_tuhjaks_reaks():
    result = migrate_marginalia_per_line("<m>üks\n<i> </i>\nkaks</m>")
    assert result.text == "<m>üks</m>\n \n<m>kaks</m>"


def test_taanded_ja_loputyhikud_sailivad():
    result = migrate_marginalia_per_line("  <m> üks\nkaks </m>  ")
    assert result.text == "  <m> üks</m>\n<m>kaks </m>  "


def test_kanooniline_sisend_on_idempotentne():
    text = "<m>üks</m>\n<m><i>kaks</i></m>"
    first = migrate_marginalia_per_line(text)
    second = migrate_marginalia_per_line(first.text)
    assert first.text == text
    assert first.regions_changed == 0
    assert second.text == text


def test_tasakaalustamata_fail_jaetakse_puutumata():
    text = "<m><m>9. Arg.</m>\ntavaline"
    result = migrate_marginalia_per_line(text)
    assert result.text == text
    assert result.regions_changed == 0
    assert result.skipped["unbalanced-file"] == 1


def test_rea_keskel_olev_m_jaetakse_puutumata():
    text = "tekst <m>märkus</m> jätkub"
    result = migrate_marginalia_per_line(text)
    assert result.text == text
    assert result.skipped["inline-region"] == 1


def test_ristuv_inline_markup_jaetakse_puutumata():
    text = "<m><i><b>tekst</i></b></m>"
    result = migrate_marginalia_per_line(text)
    assert result.text == text
    assert result.skipped["inline-crossing"] == 1


def test_annotatsiooni_ei_dubleerita_ule_rea():
    text = "<m><ann1>üks\nkaks</ann1></m>"
    result = migrate_marginalia_per_line(text)
    assert result.text == text
    assert result.skipped["structured-tag-spans-line"] == 1


def test_mitu_ohutut_piirkonda_migreeritakse_korraga():
    text = "<m>a\nb</m>\nvahe\n<m><m>c</m></m>"
    result = migrate_marginalia_per_line(text)
    assert result.text == "<m>a</m>\n<m>b</m>\nvahe\n<m>c</m>"
    assert result.regions_changed == 2


def test_nahtav_tekst_ja_ridade_arv_ei_muutu():
    text = "enne\n<m><b>üks\nkaks</b></m>\npärast"
    result = migrate_marginalia_per_line(text)
    strip = lambda value: __import__("re").sub(r"</?[a-z]+\d*[^>]*>", "", value)
    assert strip(result.text) == strip(text)
    assert result.text.count("\n") == text.count("\n")
    assert Counter(f.kind for f in audit_marginalia(result.text))["multiline"] == 0
