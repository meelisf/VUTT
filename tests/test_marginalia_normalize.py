"""
normalize_marginalia_tags: teeb <m> alati VÄLIMISEKS tägiks marginaalia-real,
parandades ristuvad/mässitud inline-tägid (OCR/transkriptsiooni artefakt).

Survey 2026-06-13: ~1500 rida 4171-st on <i><m>...</i></m> tüüpi → ei renderdu
ega indekseeru õigesti. Normaliseerimine teeb editori parseri JA split_marginalia
usaldusväärseks ilma tolerantsus-loogikat dubleerimata.
"""
from server.marginalia_normalize import normalize_marginalia_tags as norm
from server.marginalia_normalize import strip_empty_tags as strip


def test_ees_inline_tag_liigub_m_sisse():
    assert norm('<i><m>Ratio 3.</i></m>') == '<m><i>Ratio 3.</i></m>'


def test_jarel_close_tag_liigub_m_sisse():
    assert norm('<m><i>fine.</m></i>') == '<m><i>fine.</i></m>'


def test_ristuv_molemalt_poolt():
    assert norm('<i><m>Ratio 4.</m></i>') == '<m><i>Ratio 4.</i></m>'


def test_puhas_plokk_ei_muutu():
    assert norm('<m><i>1</i></m>') == '<m><i>1</i></m>'
    assert norm('<m>Exordium</m>') == '<m>Exordium</m>'


def test_idempotentne():
    once = norm('<i><m>Ratio 4.</m></i>')
    assert norm(once) == once


def test_inline_m_keset_rida_ei_muutu():
    # Rea keskel olev <m> on inline-marginaalia, mitte plokk — ära puutu
    txt = 'tekst <m>inline</m> jätkub'
    assert norm(txt) == txt


def test_mitmerealine_plokk_ei_muutu():
    # <m> avaneb ühel real, sulgub teisel — normaliseerija ei puutu (parser käsitleb)
    txt = '<m> Arg. 2.\njätkub\nlõpp</m>'
    assert norm(txt) == txt


def test_reavahetused_ja_ws_sailivad():
    txt = 'esimene rida\n<i><m>Ratio 3.</i></m>\nkolmas rida'
    assert norm(txt) == 'esimene rida\n<m><i>Ratio 3.</i></m>\nkolmas rida'


def test_taanded_sailivad():
    assert norm('  <i><m>Ratio</i></m>  ') == '  <m><i>Ratio</i></m>  '


def test_mitu_inline_tagi():
    # <i><b> mõlemad ees → mõlemad <m> sisse
    assert norm('<i><b><m>X</b></i></m>') == '<m><i><b>X</b></i></m>'


def test_cs_ja_hi_tagid():
    assert norm('<cs><m>verbum</cs></m>') == '<m><cs>verbum</cs></m>'
    assert norm('<m><hi>NB</m></hi>') == '<m><hi>NB</hi></m>'


def test_ann_tag_numbriga():
    # <ann1> peab samuti liikuma (annotatsioon)
    assert norm('<ann1><m>Jocoser:</ann1></m>') == '<m><ann1>Jocoser:</ann1></m>'


def test_tuhi_string():
    assert norm('') == ''
    assert norm('tavaline tekst ilma tägideta') == 'tavaline tekst ilma tägideta'


def test_lopureavahetus_sailib():
    assert norm('<i><m>X</i></m>\n') == '<m><i>X</i></m>\n'


def test_split_marginalia_normaliseeritud_sisuga():
    # Pärast normaliseerimist annab split_marginalia puhta marginaaliasisu
    from server.meilisearch_ops import split_marginalia
    text = 'Habemus\n<i><m>Ratio</i></m>\nipsum'
    main, notes = split_marginalia(text)
    assert '<m>' not in main and '</m>' not in main
    assert 'Ratio' in notes
    # peamine tekst EI tohi sisaldada marginaalia orvu inline-tägi
    assert '<i>' not in main and '</i>' not in main


# --- strip_empty_tags: tühjade/üleliigsete tagide koristus ---

def test_strip_tuhi_inline():
    assert strip('<i></i>') == ''
    assert strip('<b></b>') == ''
    assert strip('<cs></cs>') == ''
    assert strip('<hi></hi>') == ''


def test_strip_tuhi_marginaalia():
    assert strip('<m></m>') == ''


def test_strip_pesastatud_tuhi():
    # <m><i></i></m> → eemalda <i></i> → <m></m> → '' (püsipunkt)
    assert strip('<m><i></i></m>') == ''
    assert strip('<m><b><i></i></b></m>') == ''


def test_strip_sailitab_sisu_ymber():
    # Tühi täg keset teksti — naabertekst säilib
    assert strip('Apoc.<i></i> 12.') == 'Apoc. 12.'
    assert strip('<m>Vide</m> ja <i></i> veel') == '<m>Vide</m> ja  veel'


def test_strip_ws_only_sisu_sailib():
    # Ainult-tühik sisu: eemalda tagid, SÄILITA tühik (ära kaota nähtavat märki)
    assert strip('foo<i> </i>bar') == 'foo bar'
    assert strip('<m>  </m>') == '  '


def test_strip_ei_puuduta_taidetud_tage():
    assert strip('<m>Exordium</m>') == '<m>Exordium</m>'
    assert strip('<i>kursiiv</i>') == '<i>kursiiv</i>'
    assert strip('<m><i>1</i></m>') == '<m><i>1</i></m>'


def test_strip_ei_puuduta_ann_fn_pb():
    # ann (ID viitab andmetele), fn (joonealune), pb (self-closing) jäävad puutumata
    assert strip('<ann1></ann1>') == '<ann1></ann1>'
    assert strip('<fn></fn>') == '<fn></fn>'
    assert strip('text<pb/>more') == 'text<pb/>more'


def test_strip_idempotentne():
    once = strip('<m><i></i></m>tekst<b></b>')
    assert strip(once) == once


def test_strip_tuhi_string_ja_tagideta():
    assert strip('') == ''
    assert strip('tavaline tekst') == 'tavaline tekst'


def test_strip_reavahetused_sailivad():
    assert strip('rida üks\n<m></m>\nrida kaks') == 'rida üks\n\nrida kaks'


# --- normalize_marginalia_tags: kombineeritud (järjesta + korista) ---

def test_normalize_kutsub_strip_empty():
    # Ristuv + tühi: kõigepealt järjesta <m> välimiseks, siis korista tühjad
    assert norm('<i><m></i></m>') == ''


def test_normalize_strip_ka_ilma_m_ta():
    # Inline-tühi failis ILMA <m>-ta peab samuti koristuma (varajane väljumine ei tohi blokeerida)
    assert norm('Apoc.<i></i> 12.') == 'Apoc. 12.'


def test_normalize_tuhi_marginaalia_real():
    assert norm('enne\n<m></m>\npärast') == 'enne\n\npärast'
