
import sys
import os
import sys

# Lisa projektijuuur pathi, et importida server paketti
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server.meilisearch_ops import sync_work_to_meilisearch

if len(sys.argv) < 2:
    print("Kasutamine: python3 scripts/debug_meili_sync.py <teose_kausta_nimi>")
    sys.exit(1)

work_id = sys.argv[1]
print(f"Testin sünkroonimist teosele: {work_id}")

try:
    success = sync_work_to_meilisearch(work_id)
    if success:
        print("EDU: Sünkroonimine õnnestus!")
    else:
        print("VIGA: Sünkroonimine ebaõnnestus (tagastas False).")
except Exception as e:
    print(f"KRIITILINE VIGA: {e}")
    import traceback
    traceback.print_exc()
