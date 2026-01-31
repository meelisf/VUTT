import os
import json

BASE_DIR = os.getcwd()
PEOPLE_FILE = os.path.join(BASE_DIR, 'state', 'people.json')

def load_people_aliases():
    if os.path.exists(PEOPLE_FILE):
        try:
            with open(PEOPLE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {}

def get_creator_aliases(creators, people_data):
    aliases = []
    for creator in creators:
        creator_id = creator.get('id')
        if creator_id and people_data.get(creator_id):
            person = people_data[creator_id]
            if person.get('aliases'):
                aliases.extend(person['aliases'])
    return aliases

creators = [
    {
      "name": "Lorenz Luden",
      "role": "praeses",
      "id": "Q1870103",
      "source": "wikidata"
    }
]

print("--- DEBUG ALIASES ---")
print(f"Reading from: {PEOPLE_FILE}")

people_data = load_people_aliases()
print(f"People data loaded. Count: {len(people_data)}")

if "Q1870103" in people_data:
    print(f"Ludenius found: {people_data['Q1870103']['aliases']}")
else:
    print("Ludenius NOT found in people.json")

aliases = get_creator_aliases(creators, people_data)
authors_text = [c['name'] for c in creators if c.get('name')] + aliases
print(f"Final authors_text: {authors_text}")