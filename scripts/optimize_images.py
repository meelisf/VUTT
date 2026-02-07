#!/usr/bin/env python3
"""
Piltide ühekordne optimeerimisskript.

1. PNG → JPG konverteerimine (quality=92, RGBA → RGB valge taustaga)
2. Suurte JPG-de (>3MB) rekompressioon (quality=85)

Kasutamine:
    python3 scripts/optimize_images.py              # Dry-run (näita mida teeks)
    python3 scripts/optimize_images.py --apply      # Rakenda muudatused

NB! Pärast käivitamist tuleb uuendada Meilisearch:
    python3 scripts/sync_meilisearch.py --apply
"""

import os
import sys
import glob
import argparse

try:
    from PIL import Image
except ImportError:
    print("Viga: Pillow puudub. Installi: pip install Pillow")
    sys.exit(1)

# Konfiguratsioon
BASE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
PNG_JPG_QUALITY = 92       # PNG → JPG kvaliteet (kõrgem, kuna esimene konverteerimine)
RECOMPRESS_QUALITY = 85    # Suurte JPG-de rekompressiooni kvaliteet
SIZE_THRESHOLD_MB = 3      # Ainult >3MB JPG-sid kompressitakse


def find_png_files(base_dir):
    """Leiab kõik PNG failid, v.a. thumbnailid."""
    results = []
    for root, dirs, files in os.walk(base_dir):
        for f in files:
            if f.lower().endswith('.png') and not f.startswith('_thumb_'):
                results.append(os.path.join(root, f))
    return sorted(results)


def find_large_jpgs(base_dir, threshold_bytes):
    """Leiab JPG failid, mis ületavad suuruspiiri."""
    results = []
    for root, dirs, files in os.walk(base_dir):
        for f in files:
            if f.lower().endswith('.jpg') and not f.startswith('_thumb_'):
                path = os.path.join(root, f)
                if os.path.getsize(path) > threshold_bytes:
                    results.append(path)
    return sorted(results)


def convert_png_to_jpg(png_path, quality, dry_run=True):
    """Konverteerib PNG → JPG. Tagastab (uus_tee, vana_suurus, uus_suurus) või None."""
    jpg_path = os.path.splitext(png_path)[0] + '.jpg'
    old_size = os.path.getsize(png_path)

    if dry_run:
        # Hinda suurust ilma salvestamata
        return jpg_path, old_size, None

    try:
        with Image.open(png_path) as img:
            # RGBA → RGB valge taustaga
            if img.mode in ('RGBA', 'P', 'LA'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1])  # Alpha kanal maskina
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')

            img.save(jpg_path, 'JPEG', quality=quality, optimize=True)
            os.chmod(jpg_path, 0o644)

        new_size = os.path.getsize(jpg_path)

        # Kustuta originaal-PNG
        os.remove(png_path)

        return jpg_path, old_size, new_size

    except Exception as e:
        print(f"  VIGA: {png_path}: {e}")
        return None


def recompress_jpg(jpg_path, quality, dry_run=True):
    """Rekompressib JPG. Tagastab (vana_suurus, uus_suurus) või None."""
    old_size = os.path.getsize(jpg_path)

    if dry_run:
        return old_size, None

    try:
        with Image.open(jpg_path) as img:
            if img.mode != 'RGB':
                img = img.convert('RGB')
            img.save(jpg_path, 'JPEG', quality=quality, optimize=True)
            os.chmod(jpg_path, 0o644)

        new_size = os.path.getsize(jpg_path)
        return old_size, new_size

    except Exception as e:
        print(f"  VIGA: {jpg_path}: {e}")
        return None


def fmt_size(bytes_val):
    """Vormindab baitid loetavaks."""
    if bytes_val is None:
        return "?"
    if bytes_val > 1024 * 1024:
        return f"{bytes_val / 1024 / 1024:.1f}MB"
    return f"{bytes_val / 1024:.0f}KB"


def main():
    parser = argparse.ArgumentParser(description="Piltide optimeerimine")
    parser.add_argument('--apply', action='store_true', help="Rakenda muudatused (vaikimisi dry-run)")
    args = parser.parse_args()

    dry_run = not args.apply

    if dry_run:
        print("=== DRY RUN — muudatusi ei tehta ===\n")
    else:
        print("=== RAKENDAMINE ===\n")

    # --- 1. PNG → JPG ---
    png_files = find_png_files(BASE_DIR)
    print(f"PNG failid: {len(png_files)} tk")

    png_saved = 0
    for png_path in png_files:
        rel = os.path.relpath(png_path, BASE_DIR)
        result = convert_png_to_jpg(png_path, PNG_JPG_QUALITY, dry_run)
        if result:
            jpg_path, old_size, new_size = result
            if dry_run:
                print(f"  {rel}: {fmt_size(old_size)} → JPG")
            else:
                saved = old_size - new_size
                png_saved += saved
                print(f"  {rel}: {fmt_size(old_size)} → {fmt_size(new_size)} (−{fmt_size(saved)})")

    # --- 2. Suured JPG-d ---
    threshold = SIZE_THRESHOLD_MB * 1024 * 1024
    large_jpgs = find_large_jpgs(BASE_DIR, threshold)
    print(f"\nSuured JPG-d (>{SIZE_THRESHOLD_MB}MB): {len(large_jpgs)} tk")

    jpg_saved = 0
    for jpg_path in large_jpgs:
        rel = os.path.relpath(jpg_path, BASE_DIR)
        result = recompress_jpg(jpg_path, RECOMPRESS_QUALITY, dry_run)
        if result:
            old_size, new_size = result
            if dry_run:
                print(f"  {rel}: {fmt_size(old_size)}")
            else:
                saved = old_size - new_size
                jpg_saved += saved
                print(f"  {rel}: {fmt_size(old_size)} → {fmt_size(new_size)} (−{fmt_size(saved)})")

    # --- Kokkuvõte ---
    print(f"\n{'=' * 40}")
    if dry_run:
        print(f"PNG konverteerimisi: {len(png_files)}")
        print(f"JPG rekompressioone: {len(large_jpgs)}")
        print("Käivita uuesti --apply lipuga, et rakendada.")
    else:
        total_saved = png_saved + jpg_saved
        print(f"PNG kokkuhoid: {fmt_size(png_saved)}")
        print(f"JPG kokkuhoid: {fmt_size(jpg_saved)}")
        print(f"KOKKU säästetud: {fmt_size(total_saved)}")
        print(f"\nNüüd käivita: python3 scripts/sync_meilisearch.py --apply")


if __name__ == '__main__':
    main()
