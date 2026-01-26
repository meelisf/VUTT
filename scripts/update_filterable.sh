#!/bin/bash
# Uuenda Meilisearchi filtreeritavad atribuudid

# Võti peab tulema keskkonnamutujast (nt .env failist või shellist)
MEILI_KEY="${MEILI_MASTER_KEY}"

if [ -z "$MEILI_KEY" ]; then
  echo "VIGA: MEILI_MASTER_KEY keskkonnamutuja on määramata!"
  exit 1
fi

DATA='["aasta","author_names","authors_text","autor","collection","collections_hierarchy","creator_ids","creators","genre","genre_en","genre_et","genre_ids","languages","lehekylje_number","location_id","originaal_kataloog","page_tags","publisher","publisher_id","respondens","respondens_names","status","tags","tags_en","tags_et","tags_ids","teose_id","teose_staatus","title","trükkal","type","type_en","type_et","work_id","year"]'

# Proovi localhost
echo "Proovin localhost:7700..."
RESULT=$(curl -s -X PATCH "http://localhost:7700/indexes/teosed/settings/filterable-attributes" -H "Content-Type: application/json" -H "Authorization: Bearer ${MEILI_KEY}" --data "${DATA}" 2>&1)
echo "Vastus: ${RESULT}"

# Kui localhost ei tööta, proovi meilisearch
if [[ -z "$RESULT" || "$RESULT" == *"Connection refused"* || "$RESULT" == *"error"* ]]; then
  echo ""
  echo "Proovin meilisearch:7700..."
  RESULT=$(curl -s -X PATCH "http://meilisearch:7700/indexes/teosed/settings/filterable-attributes" -H "Content-Type: application/json" -H "Authorization: Bearer ${MEILI_KEY}" --data "${DATA}" 2>&1)
  echo "Vastus: ${RESULT}"
fi

echo ""
echo "Kontrollin tulemust..."
sleep 2
curl -s "http://localhost:7700/indexes/teosed/settings/filterable-attributes" -H "Authorization: Bearer ${MEILI_KEY}" 2>/dev/null || curl -s "http://meilisearch:7700/indexes/teosed/settings/filterable-attributes" -H "Authorization: Bearer ${MEILI_KEY}"
echo ""
