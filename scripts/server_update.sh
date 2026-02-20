#!/bin/bash
# scripts/server_update.sh
# See skript uuendab VUTT rakendust serveris (kood + docker).
# Käivita see skript serveri juurkaustas (nt ~/VUTT).

set -e  # Peata skript vea korral

echo "🔄 [1/4] Uuendan koodi Gitist..."
git pull

echo "🐳 [2/4] Ehitan ja taaskäivitan Docker konteinerid (sh. Python serverid)..."
# Docker kasutab vahemälu (layer caching), et kiirendada ehitamist.
docker compose build backend
docker compose up -d --remove-orphans

echo "⏳ [3/4] Ootan teenuste käivitumist (5s)..."
sleep 5

echo "🔍 [4/4] Kontrollin staatust..."
docker compose ps

echo "🔑 [5/5] Parandan data/ kausta omaniku (Docker kirjutab root'ina)..."
sudo chown -R meelisf:meelisf data/

echo "✅ Uuendamine valmis!"
echo "   NB: Backend on nüüd FastAPI põhine (pordil 8002)."
echo "   Kui andmebaas vajab täitmist, käivita: ./scripts/server_seed_data.sh"
echo "   Kui frontend vajab uuendamist, lae 'dist' kaust oma arvutist üles (rsync)."
