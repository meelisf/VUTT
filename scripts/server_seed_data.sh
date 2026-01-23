#!/bin/bash
# scripts/server_seed_data.sh
# See skript täidab Meilisearchi andmebaasi nullist.
# NB! See võib võtta aega ja kustutab olemasoleva indeksi 'teosed'.

echo "⚠️  HOIATUS: See skript kustutab ja taasloob 'teosed' indeksi."
read -p "Kas oled kindel? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]
then
    exit 1
fi

echo "🚀 [1/2] Koondan andmed (consolidate)..."
docker exec -it vutt-backend python3 scripts/1-1_consolidate_data.py

echo "🚀 [2/2] Saadan Meilisearchi (upload)..."
docker exec -it vutt-backend python3 scripts/2-1_upload_to_meili.py

echo "✅ Andmed laetud!"
