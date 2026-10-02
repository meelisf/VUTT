import json, re, statistics, unicodedata
from pathlib import Path
from bench import GT, OUT

def lev(a, b):
    prev = list(range(len(b)+1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j]+1, cur[j-1]+1, prev[j-1]+(ca != cb)))
        prev = cur
    return prev[-1]

def raw(t):
    t = unicodedata.normalize("NFC", t)
    return "\n".join(" ".join(l.split()) for l in t.strip().splitlines() if l.strip())

def norm(t):
    # Tolerantne: ſ=s, poolitusmärgid ühtseks, arhiivitempel välja, reavahetus = tühik
    t = raw(t)
    t = "\n".join(l for l in t.splitlines() if not re.search(r"R\.?\s*19\.?\s*G", l))
    t = t.replace("ſ", "s").replace("⸗", "-").replace("¬", "-").replace("=", "-")
    return " ".join(t.split())

def cer(h, g, f): h, g = f(h), f(g); return lev(h, g) / len(g)
def wer(h, g): h, g = norm(h).split(), norm(g).split(); return lev(h, g) / len(g)

res = json.loads((OUT / "results.json").read_text())
by = {}
for x in res:
    if "error" in x: continue
    k = (x["model"], x["effort"])
    by.setdefault(k, []).append(x)
rows = []
for (m, e), xs in by.items():
    c_raw = [cer(x["text"], GT, raw) for x in xs]
    c_n = [cer(x["text"], GT, norm) for x in xs]
    w = [wer(x["text"], GT) for x in xs]
    costs = [x["cost"] for x in xs if x["cost"]]
    rows.append((statistics.mean(c_n), m, e, c_n, c_raw, statistics.mean(w),
                 max(costs) if costs else None, statistics.mean(x["secs"] for x in xs)))
rows.sort()
print("%-38s %-4s %-13s %-7s %-6s %-9s %s" % ("mudel", "eff", "CERnorm r1/r2", "CERraw", "WER", "$/lk", "s"))
for r in rows:
    print("%-38s %-4s %5.1f%% %5.1f%%  %5.1f%%  %5.1f%%  %-9s %.0f" % (
        r[1], r[2], r[3][0]*100, r[3][-1]*100, statistics.mean(r[4])*100, r[5]*100,
        ("%.4f" % r[6]) if r[6] else "?", r[7]))
json.dump([dict(model=r[1], effort=r[2], cer_norm=r[3], cer_raw=r[4], wer=r[5], cost=r[6], secs=r[7]) for r in rows],
          open(OUT / "scores.json", "w"), indent=1)
