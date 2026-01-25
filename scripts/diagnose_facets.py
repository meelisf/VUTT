
import os
import sys
import json
import meilisearch

# Lisa serveri kaust pathi, et saaks importida configi
current_dir = os.path.dirname(os.path.abspath(__file__))
server_dir = os.path.join(os.path.dirname(current_dir), 'server')
sys.path.append(server_dir)

try:
    import config
except ImportError:
    print("Viga: Ei saanud importida server/config.py moodulit.")
    sys.exit(1)

def run_diagnostics():
    print(f"Ühendun Meilisearchi: {config.MEILI_URL}")
    if not config.MEILI_KEY:
        print("HOIATUS: Meilisearch API key puudub konfiguratsioonis!")
    
    try:
        client = meilisearch.Client(config.MEILI_URL, config.MEILI_KEY)
        index = client.index(config.INDEX_NAME)
    except Exception as e:
        print(f"Viga ühendumisel: {e}")
        return

    # Test parameetrid (kasutaja mainitud)
    # 1630-1636
    filter_expr = ["aasta >= 1630", "aasta <= 1636"]
    
    # Päring 1: Ilma distinctita (loeb lehekülgi)
    print("\n--- TEST 1: Ilma distinctita (vaikimisi) ---")
    try:
        res1 = index.search('', {
            'filter': filter_expr,
            'limit': 0,
            'facets': ['genre_et']
        })
        print(f"Total Hits (Lehekülgi): {res1.get('estimatedTotalHits')}")
        facets = res1.get('facetDistribution', {}).get('genre_et', {})
        print("Facetid (genre_et):")
        print(json.dumps(facets, indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"Viga päringus 1: {e}")

    # Päring 2: Distinctiga (peaks lugema teoseid?)
    print("\n--- TEST 2: Distinct 'teose_id' ---")
    try:
        res2 = index.search('', {
            'filter': filter_expr,
            'limit': 0,
            'distinct': 'teose_id',
            'facets': ['genre_et']
        })
        print(f"Total Hits (Teoseid?): {res2.get('estimatedTotalHits')}")
        
        facets = res2.get('facetDistribution', {}).get('genre_et', {})
        print("Facetid (genre_et):")
        print(json.dumps(facets, indent=2, ensure_ascii=False))
        
        # Kontrolliks: kas Meilisearchi dokumentatsioon peab paika?
        # Dokumentatsioon ütleb: facetDistribution returns the count of matching documents.
        # Kui distinct on peal, kas see loeb dokumentideks unikaalsed teosed?
        
    except Exception as e:
        print(f"Viga päringus 2: {e}")

if __name__ == "__main__":
    run_diagnostics()
