#!/usr/bin/env python3
"""Johann Fischer (vutt:Pu837uz): eluloo allikaloend → kaardi `sources[]` (ADR 0078).

Eluloo jaotised „## Kasutatud allikad" / „## Sources Used" kaovad; nende sisu on
`ALLIKAD`-is (kirjandus vabatekstina, VUTT-i teosed viitena). Mõlemast keelest kaob
sama jaotis, seega kinnitatakse ingliskeelse tõlke ankur uuesti (ankur oli enne
kehtiv — skript kontrollib). Salvestus PUT /prosopography/{id} kaudu
(`update_person`: valideerimine, git-commit kasutaja nimel).

    python3 fischer_allikad.py             # kuivkäivitus
    python3 fischer_allikad.py --kirjuta
"""
import getpass
import hashlib
import json
import sys
import urllib.error
import urllib.request

API = "http://127.0.0.1:8002"
ISIK = "vutt:Pu837uz"
JAOTIS = {"biography_et": "\n## Kasutatud allikad\n", "biography_en": "\n## Sources Used\n"}

ALLIKAD = [
    {
        "text": "Aarma ja Bruns 2000/2020: Liivi Aarma, Alken Bruns. „Fischer, Johann”. Biographisches Lexikon für Schleswig-Holstein und Lübeck, 11 (2000); digitaalkoond BioLex Digital (2020), lk 827–829. DOI 10.23797/9783529025624."
    },
    {
        "text": "Küng 2010: Enn Küng. „Riia on Liivimaa akadeemia jaoks kohaseim ja sobivaim paik”. Tuna 3, lk 94–100. https://www.ra.ee/wp-content/uploads/2017/02/KyngEnn_Riia_on_Liivimaa_TUNA2010_3.pdf."
    },
    {
        "text": "Rauch 1961: Georg von Rauch. „Fischer, Johann”. Neue Deutsche Biographie 5, lk 189. https://www.deutsche-biographie.de/sfz16244.html."
    },
    {
        "text": "Rauch 1969: Georg von Rauch. Die Universität Dorpat und das Eindringen der frühen Aufklärung in Livland 1690–1710. Hildesheim–New York, 1943. aasta teose kordustrükk. Lk 113–116 ja 129–134."
    },
    {
        "text": "Spener, Frankfurter Briefe: Philipp Jakob Spener. Briefe aus der Frankfurter Zeit, kiri nr 110, 2.10.1676, lk 505–509. Siin märgitud lehed ei hõlma kirja lõppu."
    },
    {
        "text": "Spener, Dresdner Briefe: Philipp Jakob Spener. Briefe aus der Dresdner Zeit: 1686–1691, kiri nr 10, 4.02.1688, lk 40–45. Mõlema Speneri kirja adressaat on editsioonis nurksulgudes."
    },
    {
        "text": "Tafenau ja Põldvee 2017: Kai Tafenau, Aivar Põldvee. „Emanuel Regeri „mälestused” Liivimaa kooliasjandusest (1708)”. Tuna 4, lk 53–64; eriti lk 53–56. https://tuna.ra.ee/emanuel-regeri-malestused-liivimaa-kooliasjandusest-1708/."
    },
    {
        "text": "Wappmann 1995: Volker Wappmann. Durchbruch zur Toleranz. Die Religionspolitik des Pfalzgrafen Christian August von Sulzbach 1622–1708. Neustadt an der Aisch, 1995."
    },
    {
        "text": "Wieselgren 1964–1966: Greta Wieselgren. „Johann Fischer”. Svenskt biografiskt lexikon 16, lk 56–61. https://sok.riksarkivet.se/sbl/presentation.aspx?id=14152. Selle sünnidaatumit ei ole üle võetud."
    },
    {
        "work_id": "pjtwd9",
        "page": 22,
        "printed_page": "20–22",
        "text": "Fischer 1687",
        "note": "Reduktsiooniarutelu VUTT lk 22–24."
    },
    {
        "work_id": "o17ekb",
        "text": "Fischeri kirjakogu: HAB Wolfenbüttel, Cod. Guelf. 151 Noviss. 2°",
        "note": "HAB digiteering: http://diglib.hab.de/mss/151-noviss-2f/start.htm. Iseseisvate kirjade ja dokumentide täpsed VUTT-lehed on viidatud põhitekstis; kogu üldine autorimärge ei tähenda, et Fischer oleks iga kirja või lisatud trükise autor."
    },
    {
        "work_id": "o17ekb",
        "part_id": "3dvj8f",
        "page": 223,
        "text": "Opitzi kiri"
    },
    {
        "work_id": "es2n47",
        "page": 246,
        "text": "senatiprotokoll, VUTT lk 246–254"
    },
    {
        "work_id": "179o97",
        "page": 1,
        "text": "Dimbergi matusekutse Christina Elisabeth Fischerile"
    },
    {
        "work_id": "3ix06q",
        "page": 2,
        "text": "Wageneri disputatsiooni pühendus"
    },
    {
        "work_id": "jlctu4",
        "part_id": "07uj27",
        "text": "Fischeri matusejutlus Wilhelm Ludwig Spenerile"
    },
    {
        "work_id": "jy30do",
        "page": 1,
        "text": "Altdorfi magistripromotsiooni kutse 1659"
    },
    {
        "text": "Friedenthal 2025: Tiina-Erika Friedenthal. „Milleks piibel ja kuidas seda lugeda? Pietistlikud eessõnad ja lugemisjuhised Eesti- ja Liivimaa piiblites”. Keel ja Kirjandus 8–9, lk 721–742; siin kasutatud eriti lk 725–727. https://www.keeljakirjandus.ee/ee/archives/38792, DOI 10.54013/kk812a5."
    },
    {
        "text": "Baron, Rosenroth: Bernhard M. Baron / Bayerische Staatsbibliothek. „Christian Knorr von Rosenroth”. Literaturportal Bayern, vaadatud 19.09.2026. https://www.literaturportal-bayern.de/autorenlexikon?pnd=118723863&task=lpbauthor.default. Kasutatud Rosenrothi tegevuse ja Sulzbachi keskkonna taustaks."
    }
]


def paring(meetod, tee, keha=None, token=None):
    paised = {"Content-Type": "application/json"}
    if token:
        paised["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(API + tee, method=meetod, headers=paised,
                                 data=json.dumps(keha).encode() if keha is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def rasi(tekst):
    # Sama mis server/prosopo_biography_fields.text_hash.
    return hashlib.sha256((tekst or "").strip().encode("utf-8")).hexdigest()[:12]


def main():
    kood, kaart = paring("GET", f"/prosopography/{ISIK}")
    if kood != 200:
        sys.exit(f"Kaarti ei saanud: {kood}")
    if kaart.get("sources"):
        sys.exit(f"Kaardil on juba allikaid ({len(kaart['sources'])}) — ei kirjuta üle.")
    uus = {}
    for vali, pealkiri in JAOTIS.items():
        tekst = kaart.get(vali) or ""
        if tekst.count(pealkiri) != 1:
            sys.exit(f"{vali}: jaotist {pealkiri.strip()!r} ei ole täpselt üks kord")
        algus = tekst.index(pealkiri)
        if "\n## " in tekst[algus + len(pealkiri):]:
            sys.exit(f"{vali}: jaotise järel on veel pealkirju — ei lõika")
        uus[vali] = tekst[:algus].rstrip() + "\n"
        print(f"{vali}: {len(tekst)} → {len(uus[vali])} märki; eemaldub:")
        print("    " + tekst[algus:].strip().replace("\n", "\n    ")[:600] + " …")
    ankur = (kaart.get("biography_en_src") or {}).get("hash")
    kinnita = ankur == rasi(kaart.get("biography_et"))
    print(f"\nEN tõlkeankur {'kehtiv → kinnitatakse uuesti' if kinnita else 'ei ole kehtiv → jääb puutumata'}")
    print(f"\nAllikaid: {len(ALLIKAD)} ({sum('work_id' in a for a in ALLIKAD)} VUTT-i viidet)")
    for i, a in enumerate(ALLIKAD, 1):
        print(f"  {i:2} {json.dumps(a, ensure_ascii=False)[:140]}")

    if "--kirjuta" not in sys.argv:
        print("\nKuivkäivitus. Kirjutamiseks: --kirjuta")
        return
    kasutaja = input("Kasutajanimi: ").strip()
    kood, vastus = paring("POST", "/login", {"username": kasutaja, "password": getpass.getpass("Parool: ")})
    token = vastus.get("token")
    if kood != 200 or not token:
        sys.exit(f"Sisselogimine ebaõnnestus: {kood} {vastus.get('message')}")
    keha = {"sources": ALLIKAD, **uus, "updated_at": kaart["updated_at"],
            **({"_confirm_translation": ["biography_en"]} if kinnita else {})}
    kood, vastus = paring("PUT", f"/prosopography/{ISIK}", keha, token=token)
    if kood != 200:
        sys.exit(f"VIGA {kood}: {vastus}")
    print(f"OK — {len(vastus.get('sources') or [])} allikat, updated_at {vastus.get('updated_at')}")


if __name__ == "__main__":
    main()
