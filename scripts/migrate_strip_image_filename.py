#!/usr/bin/env python3
"""
Ühekordne migratsioon: eemaldab lehekülgede .txt failide juhtiva pildi-nime rea.

Taust: varasem transkriptsioonimudel jättis teksti algusesse rea pildifaili
nimega (nt `r_acad_dorp_1645_29_0001.jpg`), et pilti ja teksti oleks mugav kokku
viia. Seda pole enam vaja — rida risustab redaktorit, otsinguindeksit ja
bot-prerenderit (SEO). ~12225/22224 (~55%) faili algab sellise reaga.

OHUTUS: rida eemaldatakse AINULT siis, kui see on TÄPSELT lehe enda pildifaili
nimi (`{sama_base}.jpg|.jpeg|.png`, tõusutundetu). Nii ei ole ühtki valepositiivi —
päris transkriptsioonitekst ei ole kunagi lihtsalt selle lehe pildi failinimi.

KASUTUS (serveris, Dockeris):
  docker exec vutt-backend python3 scripts/migrate_strip_image_filename.py --dry-run
  docker exec vutt-backend python3 scripts/migrate_strip_image_filename.py --apply --commit

Pärast --apply: data/ git commit (--commit teeb automaatselt) + Meilisearch
reindeks (./scripts/server_seed_data.sh vm seed-sammud), et otsing kajastaks muutust.
"""
import os
import sys
import argparse
import subprocess

_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_ROOT = os.getenv("VUTT_DATA_DIR", os.path.join(_project_root, "data"))

_IMG_EXTS = ('.jpg', '.jpeg', '.png')


def find_txt_files(root):
    for dp, _, fs in os.walk(root):
        # Jäta vahele config ja .git
        if os.sep + '.git' in dp or os.sep + 'config' in dp:
            continue
        for f in fs:
            if f.endswith('.txt') and not f.startswith('_'):
                yield os.path.join(dp, f)


def strip_leading_image_name(raw, txt_path):
    """Eemaldab esimese rea, kui see on lehe enda pildifaili nimi.

    Tagastab (fixed, changed). Konservatiivne: puutub AINULT juhtivat rida,
    mis võrdub `{base}.{jpg|jpeg|png}`-ga (base = .txt failinimi ilma laiendita).
    """
    nl = raw.find('\n')
    first = raw if nl == -1 else raw[:nl]
    rest = "" if nl == -1 else raw[nl + 1:]
    base = os.path.splitext(os.path.basename(txt_path))[0].lower()
    expected = {base + ext for ext in _IMG_EXTS}
    first_stripped = first.strip()
    low = first_stripped.lower()

    # Variant A: kogu esimene rida ON failinimi → eemalda rida (+ järgnevad tühjad).
    if low in expected:
        return rest.lstrip('\n'), True

    # Variant B: rida ALGAB oma failinimega + tühik, siis päris tekst samal real
    # (nt "r_..._0002.jpg 1633:16 LESSUS") → eemalda ainult failinime-prefiks.
    for name in expected:
        if low.startswith(name) and first_stripped[len(name):len(name) + 1].isspace():
            remainder = first_stripped[len(name):].lstrip()
            new = remainder + (("\n" + rest) if rest else "")
            return new, True

    return raw, False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true', help='Kirjuta muudatused (muidu dry-run)')
    ap.add_argument('--dry-run', action='store_true', help='Selgesõnaline dry-run (vaikimisi, kui --apply puudub)')
    ap.add_argument('--commit', action='store_true', help='Pärast --apply tee data/ git commit')
    ap.add_argument('--limit', type=int, default=0, help='Töötle ainult N esimest muudetavat (test)')
    args = ap.parse_args()

    changed = []
    scanned = 0
    for path in find_txt_files(DATA_ROOT):
        scanned += 1
        try:
            with open(path, 'r', encoding='utf-8') as f:
                raw = f.read()
        except Exception as e:
            print(f"  LUGEMISVIGA {path}: {e}")
            continue
        fixed, did = strip_leading_image_name(raw, path)
        if not did or fixed == raw:
            continue
        changed.append(path)
        if args.apply:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(fixed)
        if args.limit and len(changed) >= args.limit:
            break

    print(f"Skanniti {scanned} .txt faili.")
    print(f"{'Muudetud' if args.apply else 'Muudaks (dry-run)'}: {len(changed)} faili.")
    for p in changed[:15]:
        print(f"   {os.path.relpath(p, DATA_ROOT)}")
    if len(changed) > 15:
        print(f"   ... ja veel {len(changed) - 15}")

    if args.apply and args.commit and changed:
        msg = f"txt: eemalda juhtiv pildi-nime rida ({len(changed)} faili)"
        # Lisa AINULT muudetud .txt failid (mitte `add -A`) — data/ gitis võib
        # olla committimata runtime-config muudatusi, mida ei tohi kaasa haarata.
        rels = [os.path.relpath(p, DATA_ROOT) for p in changed]
        try:
            # Pane pathspec-id kaupa (väldib liiga pikka käsurida suure N korral).
            for i in range(0, len(rels), 500):
                subprocess.run(['git', '-C', DATA_ROOT, 'add', '--'] + rels[i:i + 500], check=True)
            subprocess.run(['git', '-C', DATA_ROOT, 'commit', '-m', msg], check=True)
            print(f"data/ git commit tehtud: {msg}")
        except subprocess.CalledProcessError as e:
            print(f"git commit ebaõnnestus: {e}")

    return 0


if __name__ == '__main__':
    sys.exit(main())
