"""ESTERi Z39.50 kandidaadid sedelite märksõnade järgi.

Sisend: margsonad.jsonl (Haiku). Väljund: kandidaadid.json — iga sedeli kohta TÜ
käsikirjalised kirjed (040 ErTUR + leader/6 t,d,f või 773/351 Säilik/500 Käsikiri).
Päringud sõnaindeksis (1=1016, mitu sõna = AND): perenimi+sõna, sõna+sõna.
"""
import json
import re
import subprocess
import sys
import time

D = sys.argv[1]
MAX_SHOW = 100
MAX_HITS = 300  # laiemaid päringuid ei näidata (müra, aeglane)


def yaz(paringud):
    """Üks yaz-client sessioon: iga päring = find + show. Tagastab listi (hits, kirjed)."""
    cmd = ["open tcp:www.ester.ee:212/innopac", "format usmarc"]
    for attr, p in paringud:
        cmd += [f'find @attr 1={attr} "{p}"', f"show 1+{MAX_SHOW}"]
    cmd.append("quit")
    out = subprocess.run(["yaz-client"], input="\n".join(cmd) + "\n", capture_output=True,
                         text=True, timeout=300).stdout
    tulem = []
    for blokk in out.split("Sent searchRequest.")[1:]:
        m = re.search(r"Number of hits: (\d+)", blokk)
        hits = int(m.group(1)) if m else 0
        kirjed = []
        if hits > MAX_HITS:
            tulem.append((hits, kirjed))
            continue
        for rec in blokk.split("[INNOPAC]Record type: USmarc")[1:]:
            ridu = rec.strip().splitlines()
            leader = ridu[0] if ridu else ""
            valjad = {}
            for r in ridu[1:]:
                mm = re.match(r"^(\d{3}) (.*)$", r)
                if mm:
                    valjad.setdefault(mm.group(1), []).append(mm.group(2).strip())
            kirjed.append({"leader": leader, "f": valjad})
        tulem.append((hits, kirjed))
    return tulem


def alam(v, kood):
    m = re.search(r"\$" + kood + r" ([^$]*)", v)
    return m.group(1).strip() if m else ""


def tu_kasikiri(k):
    f = k["f"]
    if not any("ErTUR" in v for v in f.get("040", [])):
        return False
    t = k["leader"][6:7]
    return (t in "tdf") or "773" in f or any("Säilik" in v for v in f.get("351", [])) \
        or any("äsikiri" in v for v in f.get("500", []))


def puhas(v):
    """Indikaatorid maha (kõik enne esimest $), alamväljade koodid maha."""
    return re.sub(r"\$[a-z0-9] ", "", re.sub(r"^[^$]*", "", v)).strip()


def kokkuvote(k):
    f = k["f"]
    b = re.search(r"b\d{7}[\dx]", " ".join(f.get("035", []) + f.get("907", [])))
    g = lambda tag, kood="a": " ".join(alam(v, kood) for v in f.get(tag, []))
    return {
        "b": b.group(0) if b else None,
        "autor": g("100") or g("110") or g("700"),
        "pealkiri": " ".join(puhas(v) for v in f.get("245", []))[:400],
        "ilmunud": " ".join(puhas(v) for v in f.get("260", []) + f.get("264", []))[:150],
        "maht": " ".join(puhas(v) for v in f.get("300", []))[:120],
        "kogu": " ".join(puhas(v) for v in f.get("773", []))[:200],
        "markused": " | ".join(puhas(v) for v in f.get("500", []) + f.get("541", []))[:300],
    }


def paringud(m):
    """Autoriindeks (1003) perenimi; pealkirjaindeks (4) iga sõna eraldi;
    sõnaindeks (1016, AND) ainult täppideta sõnadega (täpitähti see indeks ei leia)."""
    sonad = [s.replace('"', "") for s in m.get("pealkirjasonad") or [] if s and len(s) >= 3][:3]
    nimed = [n.replace('"', "") for n in m.get("autorid") or [] if n and len(n) >= 3][:2]
    ascii_ = lambda t: all(ord(c) < 128 for c in t)
    p = [(1003, n) for n in nimed] + [(4, s) for s in sonad]
    for n in nimed:
        for s in sonad[:2]:
            if ascii_(n + s):
                p.append((1016, f"{n} {s}"))
    if len(sonad) >= 2 and ascii_(sonad[0] + sonad[1]):
        p.append((1016, f"{sonad[0]} {sonad[1]}"))
    return list(dict.fromkeys(p))[:8]


def main():
    margsonad = [json.loads(l) for l in open(f"{D}/margsonad.jsonl") if l.strip()]
    tulemus = []
    for i, m in enumerate(margsonad):
        p = paringud(m)
        kand, stat = {}, []
        if p:
            try:
                for (attr, q), (hits, kirjed) in zip(p, yaz(p)):
                    q = f"{attr}:{q}"
                    tu = [k for k in kirjed if tu_kasikiri(k)]
                    stat.append({"paring": q, "hits": hits, "tu_kasikirju": len(tu), "naidatud": len(kirjed)})
                    for k in tu:
                        s = kokkuvote(k)
                        if s["b"]:
                            kand.setdefault(s["b"], {**s, "paringud": []})["paringud"].append(q)
            except subprocess.TimeoutExpired:
                stat.append({"viga": "timeout"})
        # järjestus: mitu eri päringut > üks päring, mis andis vähe TÜ käsikirju
        tu_arv = {x["paring"]: x.get("tu_kasikirju", 0) for x in stat if "paring" in x}
        valik = []
        for k in kand.values():
            k["paringud"] = sorted(set(k["paringud"]))
            k["skoor"] = len(k["paringud"])
            if k["skoor"] >= 2 or any(tu_arv.get(q, 99) <= 5 for q in k["paringud"]):
                valik.append(k)
        valik.sort(key=lambda k: -k["skoor"])
        tulemus.append({**m, "paringud": stat, "kandidaadid": valik[:8]})
        print(f"{i+1}/{len(margsonad)} lk {m['lk']}: {len(p)} päringut, {len(kand)} kandidaati", flush=True)
        time.sleep(0.2)
    json.dump(tulemus, open(f"{D}/z_kandidaadid.json", "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
