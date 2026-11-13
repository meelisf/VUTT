#!/usr/bin/env python3
"""Teise vooru (Z39.50) ESTERi märkuste andmefail ühe teemajaotuse kohta.

Sisend: <jaotus>_otsused.jsonl (Sonnet-agentide hinnang) ja <jaotus>_z_kandidaadid.json
(z_otsi.py väljund, siit ESTERi kirjete andmed). Lisaread (kohaviit, vastuolud, osa
selgitus) on käsitsi kirjutatud allolevas tabelis, sest neid ei saa usaldusväärselt
tuletada. Väljund on sama kujuga kui esimese vooru emil_ester_seosed.json, nii et
kirjutajaks sobib ../emil_ester_markused.py --andmed <fail>.

    python3 koosta_markused.py oigusteadus

Vt docs/emil-esteri-kirjetega-sidumine.md („Teine voor”).
"""
import json
import os
import sys

SIIN = os.path.dirname(os.path.abspath(__file__))
KUUPAEV = "2026-11-13"
JALUS = f"_Seos leitud automaatselt ESTERi otsingu põhjal (autor ja pealkiri), {KUUPAEV}._"

# Teemajaotus → kaustanimi (data/) ja lühinimi viidete jaoks.
KAUSTAD = {
    "2li9jm": ("oigusteadus-balti-manuskriptide-kogu-sustemaatiline-sedelkataloog-2li9jm",
               "Õigusteadus (Balti)"),
}

# (work_id, lk) → käsitsi lisatud andmed.
#   koht:  kohaviite rida (ESTERi 773 + endine Mscr), None = ESTERis puudub
#   b:     mitme kirje korral kõik b-numbrid (otsuses on ainult esimene)
#   silt:  päise täpsustus sulgudes
#   read:  põhjenduse read (osa, ebakindel, vastuolu)
#   pealkirjad: b → lühikirjeldus mitme kirje loendis (kui ESTERi pealkiri kärbiks eristava osa)
#   autor: ülekirjutus, kui ESTERi 100/700 koondväli on segane ("" = jäta välja)
LISA = {
    ("2li9jm", 3): {"read": ["Sedelil Alex 2935, ESTERis kohaviit puudub."]},
    ("2li9jm", 15): {"koht": "F 55, nim. 1, endine Mscr 1171"},
    ("2li9jm", 20): {"koht": "F 55, nim. 1, endine Mscr 521",
                     "read": ["Maht erineb: sedelil (2) + 106 l., ESTERis 111 l."]},
    ("2li9jm", 35): {"read": ["Sedelil Alex 2930, ESTERis kohaviit puudub.",
                              "Formaat erineb: sedelil 4°, ESTERis 34 cm."]},
    ("2li9jm", 48): {"koht": "F 55, nim. 1, endine Mscr 1177"},
    ("2li9jm", 71): {"koht": "F 55, nim. 1, endine Mscr 136",
                     "read": ["Maht erineb: sedelil 136 lt., ESTERis 63 l."]},
    ("2li9jm", 95): {"koht": "F 93 (Leesment)"},
    ("2li9jm", 96): {"silt": "köited",
                     "b": ["b40491602", "b40491572", "b40493672", "b40493866", "b40494081"],
                     "pealkirjad": {
                         "b40491602": "Leges, Statuta, Constitutiones, Privilegia Regni Poloniae … Vol. 2: 1550–1609. 496 l.",
                         "b40491572": "Leges, Constitutiones et Privilegia Regni Poloniae … Vol. 3: 1609–1640. 456 l.",
                         "b40493672": "Leges, Constitutiones et Privilegia Regni Poloniae … Vol. 4: 1641–1668. 600 l.",
                         "b40493866": "Leges, Constitutiones et Privilegia Regni Poloniae … Vol. 5: 1669–1697. 639 l.",
                         "b40494081": "Leges, Constitutiones et Privilegia Regni Poloniae … Vol. 6: 1697–1736. 321 l.",
                     },
                     "read": ["Sedel kirjeldab viieköitelist tervikut (Tomus II–VI, Ald 2961–2965); "
                              "ESTERis on igal köitel oma kirje (vol. 2–6). "
                              "ESTERis kohaviit puudub."]},
    ("2li9jm", 97): {"read": ["Sedelil Ald. 2931, ESTERis kohaviit puudub.",
                              "Maht erineb: sedelil 172 lt., ESTERis 177 l."]},
    ("2li9jm", 108): {"silt": "mitu kirjet", "koht": "F 8 (Müthel)",
                      "b": ["b51618485", "b51618552"],
                      "read": ["Sedel katab 1. ja 2. kogu; ESTERis on need eraldi kirjetena."]},
    ("2li9jm", 123): {"silt": "köited",
                      "b": ["b40568325", "b40569986", "b40569731", "b40571592", "b40571907"],
                      "read": ["Sedel kirjeldab viit köidet (Ad 2925–2929); ESTERis on igal köitel "
                               "oma kirje. ESTERis kohaviit puudub."]},
    ("2li9jm", 124): {"autor": "",
                      "read": ["Sedelil Alex 2934, ESTERis kohaviit puudub.",
                               "Maht erineb: sedelil 263 lt., ESTERis 264 l."]},
    ("2li9jm", 147): {"autor": "Russow, Balthasar; Ewers, Johann Philipp Gustav",
                      "koht": "F 1 (Mscr), number ESTERis puudub",
                      "read": ["Ebakindel vaste: Kuhlweini tempel (Narva) ja Eestimaa õigusallikate "
                               "ärakirjad kattuvad, aga maht erineb (sedelil 308 lt., ESTERis 475 l.) "
                               "ja Mscr 1069 ESTERis ei esine."]},
    ("2li9jm", 158): {"read": ["Sedelil Alex. 2936, ESTERis kohaviit puudub."]},
    ("2li9jm", 171): {"silt": "mitu kirjet", "koht": "F 20 (Rummel)",
                      "b": ["b50496621", "b50011327", "b50499415"],
                      "read": ["Sedel loetleb Rummeli käsikirjalise pärandi (nr 14 jj); ESTERis on "
                               "osadel eraldi kirjed. Seotud on nr 14, 17 ja 20–21, ülejäänuid "
                               "ESTERist ei leitud."]},
    ("2li9jm", 200): {"koht": "F 55, nim. 1, endine Mscr 803"},
    ("2li9jm", 202): {"koht": "F 55, nim. 1, endine Mscr 1165",
                      "read": ["Sedeli OCR-tekstis „1465”, pildil on läbi kriipsutatud Mscr 1165.",
                               "Maht erineb: sedelil 190 lt., ESTERis 183 l."]},
    ("2li9jm", 221): {"read": ["Sedelil Mnsc. 427, ESTERis kohaviit puudub."]},
    ("2li9jm", 226): {"read": ["Sedelil Mnsc. 427, ESTERis kohaviit puudub."]},
}


def md(s):
    """Markdowni erimärgid, nagu esimeses voorus (ADR 0008: toores tekst, mitte märgendus)."""
    for c in "\\[]*_`":
        s = s.replace(c, "\\" + c)
    return s


def link(b):
    # ESTERi püsilink ilma kontrollnumbrita.
    return f"[{b}](https://www.ester.ee/record={b[:-1]}*est)"


def kirjeldus(c, autor=None):
    autor = c["autor"] if autor is None else autor
    autor = autor.strip().rstrip(",.").strip()
    pealkiri = " ".join(c["pealkiri"].split()).rstrip(" ./")
    if len(pealkiri) > 220:
        pealkiri = pealkiri[:220].rstrip(" ,;:./") + " …"
    osad = [x for x in (autor, pealkiri, c["ilmunud"].strip().rstrip(".")) if x]
    tekst = ""
    for x in osad:
        tekst += x if not tekst else (" " if tekst.endswith("…") else ". ") + x
    return md(tekst) + "."


def main():
    jaotus = sys.argv[1]
    otsused = [json.loads(r) for r in open(os.path.join(SIIN, f"{jaotus}_otsused.jsonl"), encoding="utf-8")]
    kand = json.load(open(os.path.join(SIIN, f"{jaotus}_z_kandidaadid.json"), encoding="utf-8"))
    kirjed = {c["b"]: c for s in kand for c in s["kandidaadid"]}
    # <jaotus>_b_kaart.json: vana 035 „(Tartu)” number → õige 907 number (2026-11-13 parandus).
    kaart_tee = os.path.join(SIIN, f"{jaotus}_b_kaart.json")
    vana_b = json.load(open(kaart_tee, encoding="utf-8")) if os.path.exists(kaart_tee) else {}

    seotud = [o for o in otsused if o["olek"] != "erinev"]
    puudu = [k for k in LISA if k not in {(o["work_id"], o["lk"]) for o in seotud}]
    if puudu:
        sys.exit(f"LISA-s on lehti, mida otsustes pole: {puudu}")

    # b → lehed, et viidata sama kirjega seotud teistele sedelitele.
    b_lehed = {}
    for o in seotud:
        for b in LISA.get((o["work_id"], o["lk"]), {}).get("b", [o["b"]]):
            b_lehed.setdefault(b, []).append((o["work_id"], o["lk"]))

    valja = []
    for o in seotud:
        k = (o["work_id"], o["lk"])
        lisa = LISA.get(k, {})
        bb = lisa.get("b", [o["b"]])
        if bb[0] != o["b"]:
            sys.exit(f"{k}: LISA b-loend peab algama otsuse b-numbriga {o['b']}")
        if any(b not in kirjed for b in bb):
            sys.exit(f"{k}: kirjet pole kandidaatides: {[b for b in bb if b not in kirjed]}")
        kaust, _ = KAUSTAD[o["work_id"]]
        silt = lisa.get("silt") or ("kandidaat" if o["olek"] == "kandidaat" else None)
        pais = f"**ESTER ({silt}):** " if silt else "**ESTER:** "
        pais += ", ".join(link(b) for b in bb)
        if lisa.get("koht"):
            pais += " · " + md(lisa["koht"])
        ridu = [pais]
        if len(bb) == 1:
            ridu.append(kirjeldus(kirjed[bb[0]], lisa.get("autor")))
        ridu += lisa.get("read", [])
        if len(bb) > 1:
            lyhi = lisa.get("pealkirjad", {})
            ridu += [f"- {link(b)} " + (md(lyhi[b]) if b in lyhi else kirjeldus(kirjed[b], lisa.get("autor")))
                     for b in bb]
            ridu.append("")  # tühi rida lõpetab loendi, muidu jätkaks järgmine rida viimast punkti
        teised = sorted({lk for b in bb for lk in b_lehed[b] if lk != k})
        if teised:
            ridu.append("Sama kirjega on seotud ka: " + ", ".join(
                f"[{KAUSTAD[w][1]} lk {lk}](https://vutt.utlib.ut.ee/work/{w}/{lk})" for w, lk in teised) + ".")
        ridu.append(JALUS)
        kirje = {
            "id": f"{o['work_id']}-{o['lk']}", "work_id": o["work_id"], "lk": o["lk"],
            "kaust": kaust, "fail": f"{kaust}-{o['lk']:03d}.txt", "b": bb,
            "tekst": "\n".join(ridu),
        }
        # Varem vale (vana Tartu) numbriga kirjutatud märkus asendatakse, mitte ei lisata uut.
        vanad = [v for v, uus in vana_b.items() if uus in bb]
        if vanad:
            kirje["asenda_b"] = vanad
        valja.append(kirje)

    tee = os.path.join(SIIN, f"{jaotus}_markused.json")
    with open(tee, "w", encoding="utf-8") as f:
        json.dump(valja, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"{len(valja)} märkust → {tee}")


if __name__ == "__main__":
    main()
