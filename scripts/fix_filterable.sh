#!/bin/bash
# Lisab puuduvad filterableAttributes Meilisearchi otse (curl kaudu).
# Kasuta kui Docker konteiner on vana build ja server_seed_data.sh ei aita.

cd "$(dirname "$0")/.." || exit 1
source .env

curl -X PATCH "http://localhost:7700/indexes/teosed/settings/filterable-attributes" \
  -H "Authorization: Bearer $MEILI_KEY" \
  -H "Content-Type: application/json" \
  -d '["author_names","authors_text","collection","collections","collections_hierarchy","creator_ids","creators","genre","genre_en","genre_et","genre_ids","languages","lehekylje_number","location","location_id","originaal_kataloog","page_tags","page_tags_en","page_tags_et","page_tags_ids","page_tags_suggest_en","page_tags_suggest_et","publisher","publisher_id","respondens_names","status","tags","tags_en","tags_et","tags_ids","teose_staatus","title","type","type_en","type_et","type_ids","work_id","year"]'

echo ""
echo "Oota ~15 sekundit kuni Meilisearch reindekseerib, siis kontrolli."
