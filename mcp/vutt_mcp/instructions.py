"""Serveri juhend, mille klient süstib konteksti ENNE esimest tööriistakutset.

MCP `initialize` vastuse `instructions`-väli. Claude Code kuvab selle pealkirja
all „The following MCP servers have provided instructions…" ja **lõikab 2048
märgi pealt** — `test_instructions.py` valvab piiri.

Siia kuulub see, mida ükski üksik tööriista kirjeldus ei ütle: mis korpus see
on, MIS KEELES tuleb otsida ja mis järjekorras tööriistu kasutada. Tööriista
enda semantika (parameetrid, tagastus) jääb tööriista docstringi.
"""

# ARVE SIIA EI PANDA. Lehekülgede ja kaartide hulgad muutuvad iga upload'iga,
# aga juhend elab koodis — iga number siin vananeb vaikselt. Suurusjärgu ütle
# sõnadega („valdavalt ladina", „väga vähe"); täpse arvu saab agent ise
# list_filter_values'ist.
SERVER_INSTRUCTIONS = """\
VUTT = ajalooliste tekstide transkriptsioonitöölaud (vutt.utlib.ut.ee).
Tuum on 17. sajandi Tartu trükised, aga kogu ulatub sellest mõlemas suunas
välja ja sisaldab ka sekundaarkirjandust - ÄRA eelda kitsast ajapiiri,
ulatust piira kollektsiooniga. Kõik tööriistad on read-only.

KEELED - arvesta neid, muidu otsid tühja:
- Alliktekstid on valdavalt ladina- ja saksakeelsed, kõrval rootsi ja kreeka;
  eestikeelset teksti on väga vähe. Otsi seega ladina- või saksakeelse sõnaga,
  MITTE eestikeelse terminiga ("disputatio", mitte "väitluskiri").
  Ortograafia kõigub (u/v, i/j, ß/ss, ae/æ) - otsi lühikest tüve.
- Ühesõnaline päring toimib sõnaosa otsinguna: "orati" leiab "orationem",
  "orationes" jne. Mitmesõnalises päringus tohib ainult VIIMANE sõna olla
  poolik: "oratio panegyr" ei leia "orationem panegyricam".
- Sekundaarkirjandus on peamiselt saksa- ja eestikeelne. Sama mõiste on kahes
  kihis eri keeles: allikast otsi "typographus", sekundaarist "trükkal" /
  "Buchdrucker".

TÖÖKÄIK:
1. list_filter_values (collections, languages, genres, types) - suletud loend,
   ära oleta väärtusi.
2. search_works = MILLISED teosed teemat käsitlevad; search_pages = KUS midagi
   mainitakse.
3. get_pages(work_id, from_page, to_page) = täistekst.
4. Isikud: search_persons / get_person (prosopograafia).
5. Sekundaarkirjandus on ERALDI kogu, mitte korpuse osa: list_literature
   näitab, mis seal on; get_literature_pages nõuab page_ref="printed" (trükise
   number) või "pdf" (faili leht).

REEGLID:
- work_id on nanoid ("v7Kq2mXp"), mitte pealkiri; tuleb iga tulemusega kaasa.
- Otsing on vaikimisi range (kõik sõnad peavad leheküljel esinema). Tühja
  tulemuse järel proovi lühemat päringut ja relax_matching=true.
- Tekst on masinlugemine. Lehe seisund kasvavas usaldusväärsuses: Toores
  (kontrollimata OCR) < Töös < Parandatud < Annoteeritud < Valmis (inimese
  kinnitatud).
- Tühi tulemus EI tõesta, et teemat pole - kontrolli enne list_filter_values'i
  ja list_literature'iga, kas õige allikas on kogus üldse olemas."""
