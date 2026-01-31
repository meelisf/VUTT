import sys
import os
import time

# Lisa server kaust pythoni teele
sys.path.append(os.getcwd())

from server.people_ops import fetch_wikidata_aliases, load_people_data, save_people_data, PEOPLE_FILE

def test_caesar():
    print("--- TEST PEOPLE OPS ---")
    creator_id = "Q1048" # Julius Caesar
    
    print(f"1. Testin ühendust Wikidataga ID={creator_id}...")
    try:
        data = fetch_wikidata_aliases(creator_id)
        if data:
            print("   EDU! Saadi andmed:")
            print(f"   Nimi: {data['primary_name']}")
            print(f"   Aliased (kokku {len(data['aliases'])}): {data['aliases'][:3]}...")
            print(f"   ID-d: {data['ids']}")
        else:
            print("   VIGA: Andmeid ei leitud või tekkis viga.")
            return
    except Exception as e:
        print(f"   KRIITILINE VIGA: {e}")
        return

    print("\n2. Testin salvestamist people.json faili...")
    print(f"   Faili asukoht: {PEOPLE_FILE}")
    
    try:
        people_data = load_people_data()
        print(f"   Olemasolevaid kirjeid: {len(people_data)}")
        
        people_data[creator_id] = data
        save_people_data(people_data)
        print("   Salvestamine õnnestus.")
        
        # Kontroll
        check_data = load_people_data()
        if creator_id in check_data:
            print("   KONTROLL: Caesar on failis olemas!")
        else:
            print("   VIGA: Salvestasime, aga failist ei leia.")
            
    except Exception as e:
        print(f"   SALVESTAMISE VIGA: {e}")

if __name__ == "__main__":
    test_caesar()
