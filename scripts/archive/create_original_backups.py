#!/usr/bin/env python3
"""
Loob .backup.ORIGINAL failid kõigile .txt failidele, kus neid veel pole.

Loogika:
1. Kui .backup.ORIGINAL juba eksisteerib → jäta vahele
2. Kui on olemas vanemaid .backup.* faile → kopeeri kõige vanem → .backup.ORIGINAL
3. Kui pole ühtegi backupi → kopeeri praegune .txt → .backup.ORIGINAL

Käivita serveris:
    python3 create_original_backups.py

Enne käivitamist kontrolli BASE_DIR väärtust!
"""

import os
import shutil
import glob
from datetime import datetime

# =========================================================
# MUUDA VASTAVALT SERVERI KONFIGURATSIOONILE
BASE_DIR = "/home/mf/Dokumendid/LLM/tartu-acad/data/04_sorditud_dokumendid/"
# =========================================================

DRY_RUN = False  # True = ainult näita, mida teeks; False = tee päriselt

def create_original_backups():
    """Käib läbi kõik kataloogid ja loob .backup.ORIGINAL failid."""
    
    stats = {
        'skipped_exists': 0,      # .backup.ORIGINAL juba olemas
        'created_from_backup': 0,  # Loodud vanemast backupist
        'created_from_txt': 0,     # Loodud praegusest .txt failist
        'errors': 0
    }
    
    print(f"BASE_DIR: {BASE_DIR}")
    print(f"DRY_RUN: {DRY_RUN}")
    print("-" * 60)
    
    # Käime läbi kõik alamkataloogid
    for catalog_name in sorted(os.listdir(BASE_DIR)):
        catalog_path = os.path.join(BASE_DIR, catalog_name)
        
        if not os.path.isdir(catalog_path):
            continue
        
        # Leiame kõik .txt failid (v.a .backup.* failid)
        txt_files = glob.glob(os.path.join(catalog_path, "*.txt"))
        txt_files = [f for f in txt_files if '.backup.' not in f]
        
        for txt_path in sorted(txt_files):
            original_backup_path = f"{txt_path}.backup.ORIGINAL"
            txt_filename = os.path.basename(txt_path)
            
            # 1. Kui .backup.ORIGINAL juba eksisteerib → jäta vahele
            if os.path.exists(original_backup_path):
                stats['skipped_exists'] += 1
                continue
            
            # 2. Leiame olemasolevad backupid
            existing_backups = sorted(glob.glob(f"{txt_path}.backup.*"))
            # Eemaldame ORIGINAL (juhuks kui glob leidis)
            existing_backups = [b for b in existing_backups if not b.endswith('.backup.ORIGINAL')]
            
            try:
                if existing_backups:
                    # Vanemad backupid olemas - kõige vanem on originaal
                    oldest_backup = existing_backups[0]
                    oldest_name = os.path.basename(oldest_backup)
                    
                    if DRY_RUN:
                        print(f"[DRY] {catalog_name}/{txt_filename} ← {oldest_name}")
                    else:
                        shutil.copy2(oldest_backup, original_backup_path)
                        print(f"[BACKUP→ORIG] {catalog_name}/{txt_filename} ← {oldest_name}")
                    
                    stats['created_from_backup'] += 1
                else:
                    # Pole ühtegi backupi - praegune .txt ON originaal
                    if DRY_RUN:
                        print(f"[DRY] {catalog_name}/{txt_filename} (praegune txt)")
                    else:
                        shutil.copy2(txt_path, original_backup_path)
                        print(f"[TXT→ORIG] {catalog_name}/{txt_filename}")
                    
                    stats['created_from_txt'] += 1
                    
            except Exception as e:
                print(f"[ERROR] {catalog_name}/{txt_filename}: {e}")
                stats['errors'] += 1
    
    # Kokkuvõte
    print("-" * 60)
    print("KOKKUVÕTE:")
    print(f"  Vahele jäetud (ORIGINAL olemas): {stats['skipped_exists']}")
    print(f"  Loodud vanemast backupist:       {stats['created_from_backup']}")
    print(f"  Loodud praegusest .txt failist:  {stats['created_from_txt']}")
    print(f"  Vigu:                            {stats['errors']}")
    print(f"  KOKKU töödeldud:                 {sum(stats.values())}")
    
    if DRY_RUN:
        print("\n⚠️  DRY_RUN režiim - midagi ei muudetud!")
        print("    Muuda DRY_RUN = False ja käivita uuesti.")

if __name__ == "__main__":
    create_original_backups()
