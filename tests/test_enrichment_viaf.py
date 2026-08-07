"""VIAF rikastuse RDF-sõeluja testid.

Näidis on lühendatud väljavõte päris VIAF-i vastusest (viaf.org/viaf/40261703,
Karl Kühlstaedt) — sealhulgas VIAF-i omapära, et schema:name ja
schema:alternateName liidavad ees- ja perekonnanime tühikuta.
"""
from server.prosopography.enrichment import _parse_viaf_rdf

VIAF_RDF = """<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:schema="http://schema.org/"
         xmlns:skos="http://www.w3.org/2004/02/skos/core#">
  <rdf:Description rdf:about="http://viaf.org/viaf/40261703">
    <schema:name>Carl Gotthard Kühlstädt</schema:name>
    <schema:familyName>Kühlstaedt</schema:familyName>
    <schema:givenName>Karl</schema:givenName>
    <schema:name xml:lang="de-DE">KarlKühlstaedt</schema:name>
    <skos:prefLabel xml:lang="de-DE">KarlKühlstaedt</skos:prefLabel>
    <schema:alternateName>Carl GotthardKühlstaedt</schema:alternateName>
    <schema:givenName>Carl Gotthard</schema:givenName>
    <schema:familyName>Kühlstaedt</schema:familyName>
    <schema:alternateName>Carolus G.Kuhlstaedt</schema:alternateName>
    <schema:givenName>Carolus G.</schema:givenName>
    <schema:familyName>Kuhlstaedt</schema:familyName>
    <skos:altLabel>Kühlstädt, Karl1805-1838</skos:altLabel>
    <schema:gender rdf:resource="http://www.wikidata.org/entity/Q6581097"/>
    <schema:sameAs>
      <rdf:Description rdf:about="http://d-nb.info/gnd/122483294"/>
    </schema:sameAs>
    <schema:sameAs>
      <rdf:Description rdf:about="http://isni.org/isni/000000001643332X"/>
    </schema:sameAs>
    <schema:sameAs>
      <rdf:Description rdf:about="http://www.wikidata.org/entity/Q126845238"/>
    </schema:sameAs>
  </rdf:Description>
</rdf:RDF>
"""


def test_aliases_saavad_tuhiku_tagasi():
    """VIAF annab "KarlKühlstaedt"; ees-/perekonnanime osade järgi taastame tühiku."""
    result = _parse_viaf_rdf(VIAF_RDF)
    aliases = result["name.aliases"]

    assert "Karl Kühlstaedt" in aliases
    assert "Carl Gotthard Kühlstaedt" in aliases
    assert "Carolus G. Kuhlstaedt" in aliases
    # Juba tühikuga nimi jääb puutumata
    assert "Carl Gotthard Kühlstädt" in aliases
    # Liidetud kuju ei tohi läbi lipsata
    assert "KarlKühlstaedt" not in aliases


def test_altlabel_jaetakse_valja():
    """skos:altLabel on pööratud ja eluaastad on nime küljes — mitte kasutada."""
    result = _parse_viaf_rdf(VIAF_RDF)
    assert "Kühlstädt, Karl1805-1838" not in result["name.aliases"]


def test_seotud_identifikaatorid():
    result = _parse_viaf_rdf(VIAF_RDF)
    assert result["_linked_gnd"] == "122483294"
    # Q126845238 tuleb schema:sameAs alt, MITTE schema:gender (Q6581097 = mees)
    assert result["_linked_wikidata"] == "Q126845238"


def test_aliaste_arv_on_piiratud():
    many = "\n".join(
        f"<schema:alternateName>Nimi {i}</schema:alternateName>" for i in range(40)
    )
    xml = (
        '<?xml version="1.0"?>'
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"'
        ' xmlns:schema="http://schema.org/">'
        f'<rdf:Description rdf:about="http://viaf.org/viaf/1">{many}</rdf:Description>'
        "</rdf:RDF>"
    )
    assert len(_parse_viaf_rdf(xml)["name.aliases"]) == 20


def test_tuhi_kirje_ei_kuku_labi():
    """Olematu VIAF-kirje annab sisuta RDF-i — tulemus on tühi, mitte erind."""
    xml = (
        '<?xml version="1.0"?>'
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"'
        ' xmlns:schema="http://schema.org/"/>'
    )
    assert _parse_viaf_rdf(xml) == {}
