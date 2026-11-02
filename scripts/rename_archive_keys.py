#!/usr/bin/env python3
"""Hoidjate registri võtmed → „linn + asutuse praegune lühend" (ADR 0076 täiendus 2026-11-02).

Teeb kolm asja, kõik vaikimisi kuivkäivitusena:
  1. eksemplaride `holder` vana võti → uus (`bulk_update_works`, üks commit);
  2. `archives.json` uuel kujul (`save_config_with_git`): uued võtmed, aliased (vana
     VUTT-i võti, Jaansoni lühend, lakanud asutus), Jaansoni ülejäänud hoidjad juurde;
  3. ootel eksemplari-ettepanekute `fields.holder` ja `base.holder` (`state/` SQLite) —
     muidu jääksid read `blocked_holder`-isse ja muudatusread `stale`-iks.

Korduskäivitus on ohutu: juba uue võtmega kirje võetakse alusena, aliased liidetakse.

Kasutuselevõtt (nagu ADR 0076 p 8): backend seisma, kuivkäivitus, --apply, uus image
üles, täisreindeks (`archive_refs_text` kannab hoidja võtit ja nime).
  1. docker stop vutt-backend
  2. uue image'iga: kuivkäivitus, siis --apply
  3. server_update.sh --no-cache + frontendi rsync
  4. server_seed_data.sh

Kasutus:
  python3 scripts/rename_archive_keys.py                 # kuivkäivitus
  python3 scripts/rename_archive_keys.py --apply
  python3 scripts/rename_archive_keys.py --data-dir /koopia --state-dir /koopia-state
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# (uus võti, nimi | None = jäta olemasolev, aliased, vana VUTT-i võti | None)
#
# Aliaseks EI panda mitmetähenduslikku kuju: `KB` (Stockholm / København), `RA`
# (Rahvusarhiiv / Riksarkivet). `Riga BGGA` ei ole kellegi alias: Jaanson ise kirjutab
# „Riga (früher in BGGA)" — praegune asukoht teadmata.
REGISTRY = [
    # Eesti
    ("Tartu TÜR", "Tartu Ülikooli Raamatukogu", ["Tartu ÜR", "TÜR"], "TÜR"),
    ("Tartu RA", "Rahvusarhiiv", ["Tartu EAA"], "RA"),
    ("Tartu EKM", "Eesti Kirjandusmuuseum", ["Tartu KM"], None),
    ("Tartu TÜM", "Tartu Ülikooli muuseum", ["Tartu ÜAM"], None),
    ("Tallinn RR", "Rahvusraamatukogu", ["Tallinn ERR", "RR"], "RR"),
    ("Tallinn TLÜAR", "Tallinna Ülikooli Akadeemiline Raamatukogu", ["Tallinn EAR", "TLÜAR baltika"],
     "TLÜAR baltika"),
    ("Tallinn TLA", "Tallinna Linnaarhiiv", ["Tallinn LA"], None),
    # Läti, Leedu, Venemaa
    ("Riga LUAB", "Latvijas Universitātes Akadēmiskā bibliotēka", ["Riga LAB", "Riga StB", "LUAB Latvia"],
     "LUAB Latvia"),
    ("Riga LNB", "Latvijas Nacionālā bibliotēka", ["LNB"], "LNB"),
    ("Riga LVVA", None, ["LVVA"], "LVVA"),
    ("Vilnius LMAVB", "Lietuvos mokslų akademijos Vrublevskių biblioteka", ["Vilnius LAB"], None),
    ("Petersburg RNB", "Российская национальная библиотека", ["NL Russia"], "NL Russia"),
    ("Petersburg BAN", "Библиотека Российской академии наук", ["Petersburg BRAN"], None),
    # Soome
    ("Helsinki KK", "Kansalliskirjasto", ["Helsinki YK"], None),
    ("Helsinki SKS", "Suomalaisen Kirjallisuuden Seuran kirjasto", ["Helsinki SKSK"], None),
    # Rootsi, Taani
    ("Stockholm KB", "Kungliga biblioteket", [], "KB"),
    ("Stockholm RA", "Riksarkivet", ["Riksarkivet"], "Riksarkivet"),
    ("Uppsala UB", None, ["UUB"], "UUB"),
    ("Lund UB", "Lunds universitetsbibliotek", ["UB Lund"], "UB Lund"),
    ("Göteborg UB", "Göteborgs universitetsbibliotek", [], None),
    ("Linköping StB", "Linköpings stadsbibliotek (Stiftsbiblioteket)", ["Linköping LB"], None),
    ("Skara LB", "Skara stifts- och landsbibliotek", [], None),
    ("Växjö StB", "Växjö stadsbibliotek (Stiftsbiblioteket)", ["Växjö LB", "Växjö bibliotek"],
     "Växjö bibliotek"),
    ("Kalmar StB", "Kalmar stadsbibliotek (Stifts- och gymnasiebiblioteket)", [], None),
    ("Karlstad StB", "Karlstads stadsbibliotek", [], None),
    ("Västerås StB", "Västerås stadsbibliotek (Stiftsbiblioteket)", [], None),
    ("Östersund JLB", "Jämtlands läns bibliotek", [], None),
    ("København KB", "Det Kgl. Bibliotek", ["KB København"], "KB København"),
    # Saksamaa, Austria, Suurbritannia
    ("Berlin SBB", "Staatsbibliothek zu Berlin – Preußischer Kulturbesitz", ["Berlin StB"], None),
    ("Dresden SLUB", "Sächsische Landesbibliothek – Staats- und Universitätsbibliothek Dresden",
     ["Dresden UB"], None),
    ("Göttingen SUB", "Niedersächsische Staats- und Universitätsbibliothek Göttingen", ["Göttingen UB"], None),
    ("Halle ULB", "Universitäts- und Landesbibliothek Sachsen-Anhalt", ["Halle UB"], None),
    ("Halle FSt", "Franckesche Stiftungen zu Halle, Hauptbibliothek", ["Halle/Saale FSt"], None),
    ("Jena ThULB", "Thüringer Universitäts- und Landesbibliothek Jena", ["Jena UB"], None),
    ("Gotha FBG", "Forschungsbibliothek Gotha der Universität Erfurt", ["Gotha FLB"], None),
    ("Greifswald UB", "Universitätsbibliothek Greifswald", [], None),
    ("Rostock UB", "Universitätsbibliothek Rostock", [], None),
    ("Aurich BOL", "Landschaftsbibliothek Aurich (Bibliothek der Ostfriesischen Landschaft)", [], None),
    ("Weimar HAAB", "Herzogin Anna Amalia Bibliothek", [], None),
    ("Wolfenbüttel HAB", None, ["HAB"], "HAB"),
    ("München BSB", None, ["BSB"], "BSB"),
    ("Herrnhut UA", None, ["UAH"], "UAH"),
    ("Wien ÖAW", "Bibliothek der Österreichischen Akademie der Wissenschaften", ["Wien AB"], None),
    ("London BL", "British Library", [], None),
]

# Vana võti kandis kogu nime, mis on uurijale leidmiseks vajalik („Baltika kogu" on
# käibenimetus). Hoidja nimest see kaob, seega läheb ta kohaviida ette.
SHELFMARK_PREFIX = {"TLÜAR baltika": "Baltika kogu"}

# Praegune kuju on kontrollimata — raport loetleb need ülevaatuseks. Kontrollitud
# 2026-11-02: Rootsi stiftsbiblioteket'id on (v.a Skara) linnaraamatukogu osakonnad,
# Skara stifts- och landsbibliotek kannab vana nime edasi.
UNVERIFIED = {"Karlstad StB", "Östersund JLB"}


def build_registry(current: dict) -> tuple[dict, dict, list]:
    """Uus register + ümbernimetuste kaart + hoiatused. Puhas funktsioon (testitav).

    Alus on vana võtmega kirje või (korduskäivitusel) juba uue võtmega kirje. Kirjed,
    mida REGISTRY ei tunne, jäävad muutmata lõppu ja annavad hoiatuse.
    """
    from server.archives_registry import build_entry, clean_aliases, find_conflict
    new, renames, warnings, used = {}, {}, [], set()
    for key, name, aliases, old in REGISTRY:
        base = current.get(key) or (current.get(old) if old else None) or {}
        if key in current:
            used.add(key)
        if old and old in current:
            used.add(old)
            if old != key:
                renames[old] = key
        merged = clean_aliases([*(base.get("aliases") or []), *aliases])
        new[key] = build_entry(name or base.get("name") or key, base.get("url") or "", merged)
    for key, entry in current.items():
        if key not in used:
            warnings.append(f"hoidja {key!r} puudub kaardistusest — jääb muutmata")
            new[key] = entry
    for key, entry in new.items():
        hit = find_conflict(new, key, entry.get("aliases") or [])
        if hit:
            raise ValueError(f"nimekuju {hit[0]!r} on kahel kirjel: {key!r} ja {hit[1]!r}")
    return new, renames, warnings


def prefixed_shelfmark(old_holder, shelfmark):
    """Kohaviit koos vana võtme kogu nimega (`SHELFMARK_PREFIX`); muidu muutmata."""
    prefix = SHELFMARK_PREFIX.get(old_holder)
    if not prefix:
        return shelfmark
    if not shelfmark:
        return prefix
    if prefix.split()[0].casefold() in shelfmark.casefold():
        return shelfmark
    return f"{prefix}, {shelfmark}"


def rename_exemplar(x: dict, renames: dict) -> dict:
    """Eksemplar uue hoidja võtmega (ja vajadusel kogu nimega kohaviidas)."""
    old = x.get("holder")
    if old not in renames:
        return x
    out = {**x, "holder": renames[old]}
    shelfmark = prefixed_shelfmark(old, x.get("shelfmark"))
    if shelfmark:
        out["shelfmark"] = shelfmark
    return out


def rename_rows(rows: list, renames: dict) -> int:
    """Ettepaneku ridade `fields.holder` / `base.holder` ümber; tagastab muudetud väljade arvu.

    Kohaviida eesliide läheb ainult OOTEL uue eksemplari reale: otsustatud rida on ajalugu,
    ja ootel muudatusrea `base` peab jääma elava seisuga võrreldavaks (seda kontrollib raport).
    """
    n = 0
    for r in rows:
        f = r.get("fields")
        if (r.get("op") == "create" and r.get("status") == "pending" and isinstance(f, dict)
                and f.get("holder") in SHELFMARK_PREFIX and f.get("holder") in renames):
            f["shelfmark"] = prefixed_shelfmark(f["holder"], f.get("shelfmark"))
            n += 1
        for part in ("fields", "base"):
            d = r.get(part)
            if isinstance(d, dict) and d.get("holder") in renames:
                d["holder"] = renames[d["holder"]]
                n += 1
    return n


def blocked_updates(rows: list, live: dict) -> list:
    """Ootel muudatusread, mille `base.shelfmark` viitab eksemplarile, mille kohaviit muutub."""
    return [r.get("exemplar_id") for r in rows
            if r.get("op") == "update" and r.get("status") == "pending"
            and "shelfmark" in (r.get("base") or {}) and r.get("exemplar_id") in live]


def suspicious_shelfmark(x: dict, registry: dict) -> bool:
    """Kohaviidas on hoidja nimi või reavahetus (migratsiooni või käsitsi sisestuse jääk)."""
    s = x.get("shelfmark") or ""
    name = (registry.get(x.get("holder")) or {}).get("name") or ""
    return "\n" in s or (bool(name) and name.casefold() in s.casefold())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="kirjuta (vaikimisi kuivkäivitus)")
    ap.add_argument("--data-dir", help="andmekaust (vaikimisi server.config)")
    ap.add_argument("--state-dir", help="state-kaust (vaikimisi server.config)")
    args = ap.parse_args()
    if args.data_dir:
        os.environ["VUTT_DATA_DIR"] = os.path.abspath(args.data_dir)
    if args.state_dir:
        os.environ["VUTT_STATE_DIR"] = os.path.abspath(args.state_dir)

    from server.config import ARCHIVES_FILE, BASE_DIR
    from server.archives_registry import read_archives
    current = read_archives(ARCHIVES_FILE)
    if not current:
        print(f"PEATUS: hoidjate register on tühi või loetamatu ({ARCHIVES_FILE})")
        return 2
    try:
        registry, renames, warnings = build_registry(current)
    except ValueError as e:
        print(f"PEATUS: {e}")
        return 2

    print("Ümbernimetused:")
    for old, key in renames.items():
        print(f"  {old!r:24} → {key!r}")
    added = [k for k in registry if k not in current and k not in renames.values()]
    print(f"Uusi hoidjaid: {len(added)} ({', '.join(added)})")
    for w in warnings:
        print(f"HOIATUS: {w}")

    items, per_holder, review, prefixed = [], {}, [], {}
    for entry in sorted(os.scandir(BASE_DIR), key=lambda e: e.name):
        meta_path = os.path.join(entry.path, "_metadata.json")
        if not entry.is_dir() or not os.path.exists(meta_path):
            continue
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
        exemplars = meta.get("exemplars") or []
        for x in exemplars:
            if not isinstance(x, dict):
                continue
            key = renames.get(x.get("holder"), x.get("holder"))
            per_holder[key] = per_holder.get(key, 0) + 1
            if key not in registry:
                review.append(f"{meta.get('id')}: hoidja {x.get('holder')!r} puudub registrist")
            if x.get("holder") in SHELFMARK_PREFIX and x.get("holder") in renames:
                review.append(f"{meta.get('id')}: kohaviit {x.get('shelfmark')!r} → "
                              f"{prefixed_shelfmark(x['holder'], x.get('shelfmark'))!r}")
                prefixed.setdefault(meta.get("id"), set()).add(x.get("id"))
            if suspicious_shelfmark({**x, "holder": key}, registry):
                review.append(f"{meta.get('id')}: kahtlane kohaviit ({key}): {x.get('shelfmark')!r}")
        if not any(isinstance(x, dict) and x.get("holder") in renames for x in exemplars):
            continue

        def transform(m: dict) -> dict:
            return {"exemplars": [rename_exemplar(x, renames) if isinstance(x, dict) else x
                                  for x in m.get("exemplars") or []]}

        items.append((meta_path, transform))

    print(f"Teoseid, mille eksemplari hoidja muutub: {len(items)}")
    for key, n in sorted(per_holder.items(), key=lambda kv: -kv[1]):
        print(f"  {key}: {n}")

    from server import exemplar_proposals as ep
    proposal_updates = []
    if os.path.exists(ep.DB_PATH):
        import sqlite3
        db = sqlite3.connect(ep.DB_PATH)
        for pid, work_id, payload in db.execute("SELECT id, work_id, payload FROM proposal"):
            data = json.loads(payload)
            for ex_id in blocked_updates(data.get("rows") or [], {e: 1 for e in prefixed.get(work_id, ())}):
                review.append(f"ettepanek {pid}: ootel muudatusrea base.shelfmark ({ex_id}) jääb stale'iks")
            if rename_rows(data.get("rows") or [], renames):
                proposal_updates.append((json.dumps(data, ensure_ascii=False), pid))
        db.close()
    print(f"Ettepanekuid, mille hoidja muutub: {len(proposal_updates)}")

    review += [f"hoidja {k!r}: praegune nimi/lühend kontrollimata" for k in sorted(UNVERIFIED)]
    if review:
        print("\nÜLEVAATUSEKS:")
        for r in review:
            print(f"  - {r}")

    if not args.apply:
        print("\nKuivkäivitus — --apply kirjutab.")
        return 0

    # Järjekord: teosed → register → ettepanekud. Teoste partii on all_or_nothing; kui see
    # kukub, jääb register vanaks ja kõik on endiselt kooskõlas.
    if items:
        from server.metadata_ops import bulk_update_works
        res = bulk_update_works(items, "Automaatne",
                                f"Eksemplarid: hoidjate võtmed uuel kujul ({len(items)} teost, ADR 0076)",
                                all_or_nothing=True)
        print(f"→ teosed: {res}")
        if res.get("failed") or not res.get("git_committed"):
            return 1
    from server.git_ops import save_config_with_git
    save_config_with_git(ARCHIVES_FILE, registry, "Automaatne",
                         message=f"Hoidjate register: võti = linn + praegune lühend, aliased "
                                 f"({len(renames)} ümbernimetust, {len(added)} uut; ADR 0076)")
    print("→ register kirjutatud")
    if proposal_updates:
        with ep._db() as db:
            db.executemany("UPDATE proposal SET payload=? WHERE id=?", proposal_updates)
        print(f"→ ettepanekud: {len(proposal_updates)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
