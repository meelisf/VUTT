from collections import Counter

from server.marginalia_audit import audit_marginalia


def kinds(text: str) -> Counter:
    return Counter(f.kind for f in audit_marginalia(text))


def test_puhtad_reapohised_marginaaliad():
    assert audit_marginalia("enne\n<m>üks</m>\n<m><i>kaks</i></m>\npärast") == []


def test_pesastatud_m_tagid():
    result = kinds("<m><m>tekst</m></m>")
    assert result["nested"] == 1


def test_tasakaalustamata_avav_ja_sulgev_tag():
    assert kinds("<m>tekst")["unbalanced"] == 1
    assert kinds("tekst</m>")["unbalanced"] == 1


def test_mitmerealine_plokk():
    result = kinds("<m>esimene\nteine</m>")
    assert result["multiline"] == 1


def test_rea_keskel_olev_plokk():
    result = kinds("tekst <m>märkus</m> jätkub")
    assert result["inline"] == 1


def test_marginaalia_ristub_inline_tagiga():
    assert kinds("<i><m>tekst</i></m>")["crossing"] >= 1
    assert kinds("<m><i>tekst</m></i>")["crossing"] >= 1


def test_tavaliste_inline_tagide_ristumine_ei_ole_marginaalia_leid():
    assert kinds("<i><b>tekst</i></b>")["crossing"] == 0


def test_leianumber_ja_valjavote():
    findings = audit_marginalia("puhas\n<m>vigane")
    assert findings[0].line == 2
    assert findings[0].excerpt == "<m>vigane"
