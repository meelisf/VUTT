#!/usr/bin/env python3
"""
Migreerib olemasolevad teoste staatused: arvutab teose_staatus iga teose jaoks
ja uuendab selle kõigil teose lehekülgedel.

Käivita üks kord pärast teose_staatus välja lisamist.
"""

import os
import meilisearch
from dotenv import load_dotenv
from collections import defaultdict

load_dotenv()

MEILI_HOST = os.getenv("MEILISEARCH_URL", "http://127.0.0.1:7700")
MEILI_KEY = os.getenv("MEILISEARCH_MASTER_KEY", "")

# Lehekülje staatused (peavad vastama types.ts PageStatus enum-ile)
PAGE_STATUS_RAW = "Toores"
PAGE_STATUS_DONE = "Valmis"

def calculate_work_status(page_statuses: list[str]) -> str:
    """Arvutab teose koondstaatuse lehekülgede staatuste põhjal."""
    if not page_statuses:
        return "Toores"
    
    # Kõik valmis -> Valmis
    if all(s == PAGE_STATUS_DONE for s in page_statuses):
        return "Valmis"
    
    # Kõik toores (või puuduvad) -> Toores
    if all(s == PAGE_STATUS_RAW or not s for s in page_statuses):
        return "Toores"
    
    # Muidu -> Töös
    return "Töös"

def main():
    print(f"Ühendun Meilisearch'iga: {MEILI_HOST}")
    client = meilisearch.Client(MEILI_HOST, MEILI_KEY)
    index = client.index("teosed")
    
    # 1. Päri kõik dokumendid (leheküljed)
    print("Pärin kõik leheküljed...")
    all_docs = []
    offset = 0
    limit = 1000
    
    while True:
        result = index.get_documents({
            "offset": offset,
            "limit": limit,
            "fields": ["id", "teose_id", "status"]
        })
        
        docs = result.results
        if not docs:
            break
        
        all_docs.extend(docs)
        offset += len(docs)
        print(f"  Laetud {len(all_docs)} lehekülge...")
    
    print(f"Kokku {len(all_docs)} lehekülge")
    
    # 2. Grupeeri teoste kaupa
    works = defaultdict(list)
    for doc in all_docs:
        # Meilisearch Document objektid kasutavad atribuute, mitte dict
        work_id = getattr(doc, "teose_id", None)
        if work_id:
            works[work_id].append(doc)
    
    print(f"Leitud {len(works)} teost")
    
    # 3. Arvuta iga teose koondstaatus ja uuenda dokumendid
    updates = []
    status_counts = {"Toores": 0, "Töös": 0, "Valmis": 0}
    
    for work_id, pages in works.items():
        page_statuses = [getattr(p, "status", None) or PAGE_STATUS_RAW for p in pages]
        work_status = calculate_work_status(page_statuses)
        status_counts[work_status] += 1
        
        # Lisa teose_staatus igale leheküljele
        for page in pages:
            updates.append({
                "id": page.id,
                "teose_staatus": work_status
            })
    
    print(f"\nTeoste staatused:")
    print(f"  Toores: {status_counts['Toores']}")
    print(f"  Töös: {status_counts['Töös']}")
    print(f"  Valmis: {status_counts['Valmis']}")
    
    # 4. Uuenda dokumentid partiidena
    print(f"\nUuendan {len(updates)} lehekülge...")
    batch_size = 1000
    
    for i in range(0, len(updates), batch_size):
        batch = updates[i:i + batch_size]
        task = index.update_documents(batch)
        
        # Oota task'i valmimist
        client.wait_for_task(task.task_uid)
        print(f"  Uuendatud {min(i + batch_size, len(updates))}/{len(updates)}")
    
    print("\nMigratsioon lõpetatud!")

if __name__ == "__main__":
    main()
