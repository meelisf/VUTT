"""Serveri juhend, mille klient süstib konteksti ENNE esimest tööriistakutset.

MCP `initialize` vastuse `instructions`-väli. Claude Code kuvab selle pealkirja
all „The following MCP servers have provided instructions…" ja **lõikab 2048
märgi pealt** — `test_instructions.py` valvab piiri.

Siia kuulub see, mida ükski üksik tööriista kirjeldus ei ütle: mis korpus see
on, MIS KEELES tuleb otsida ja mis järjekorras tööriistu kasutada. Tööriista
enda semantika (parameetrid, tagastus) jääb tööriista docstringi.
"""

# Keelte lehekülgede arvud pärinevad list_filter_values("languages")-ist
# (mõõdetud 2026-08-23). Suurusjärk on siin oluline, mitte täpne number.
SERVER_INSTRUCTIONS = """\
VUTT = Tartu ülikooli varauusaegse (1632-1710) trükikorpuse transkriptsioonid
(vutt.utlib.ut.ee). Kõik tööriistad on read-only.

KEELED - arvesta neid, muidu otsid tühja:
- Alliktekstid: ladina ~15600 lk, saksa ~4500, rootsi ~2100, kreeka ~2100;
  eestikeelset teksti on ainult ~440 lk. Otsi seega ladina- või saksakeelse
  sõnaga, MITTE eestikeelse terminiga ("disputatio", mitte "väitluskiri").
  Varauusaegne ortograafia kõigub (u/v, i/j, ß/ss, ae/æ) - otsi lühikest tüve.
- Ühesõnaline päring toimib sõnaosa otsinguna: "orati" leiab "orationem",
  "orationes" jne. Mitmesõnalises päringus tohib ainult VIIMANE sõna olla
  poolik: "oratio panegyr" ei leia "orationem panegyricam".
- Sekundaarkirjandus (list_literature, search_literature) on peamiselt saksa-
  ja eestikeelne, osalt rootsi ja inglise. Sama mõiste on kahes kihis eri
  keeles: allikast otsi "typographus", sekundaarist "trükkal" / "Buchdrucker".

TÖÖKÄIK:
1. list_filter_values (collections, languages, genres, types) - filtriväärtused
   on suletud loend, ära oleta neid.
2. search_works = MILLISED teosed teemat käsitlevad; search_pages = KUS midagi
   mainitakse.
3. get_pages(work_id, from_page, to_page) = täistekst.
4. Isikud: search_persons / get_person (prosopograafia, ~2350 kaarti).
5. Sekundaarkirjandus on ERALDI kogu, mitte korpuse osa: list_literature
   näitab, mis seal on; get_literature_pages nõuab page_ref="printed" (trükise
   number) või "pdf" (faili leht).

REEGLID:
- work_id on nanoid ("v7Kq2mXp"), mitte pealkiri ega kaustanimi; tuleb iga
  tulemusega kaasa, anna edasi järgmisele tööriistale.
- Otsing on vaikimisi range (kõik sõnad peavad leheküljel esinema). Tühja
  tulemuse järel proovi lühemat päringut ja relax_matching=true.
- Tekst on masinlugemine. Lehe seisund kasvavas usaldusväärsuses: Toores
  (kontrollimata OCR) < Töös < Parandatud < Annoteeritud < Valmis (inimese
  kinnitatud).
- Tühi tulemus EI tõesta, et teemat pole - kontrolli enne list_filter_values'i
  ja list_literature'iga, kas õige allikas on kogus üldse olemas."""
