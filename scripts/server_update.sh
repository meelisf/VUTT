#!/bin/bash
# scripts/server_update.sh
# See skript uuendab VUTT rakendust serveris (kood + docker).
# Käivita see skript serveri juurkaustas (nt ~/VUTT).

set -e  # Peata skript vea korral

echo "🔄 [1/4] Uuendan koodi Gitist..."
git pull

echo "🐳 [2/4] Ehitan ja taaskäivitan Docker konteinerid (sh. Python serverid)..."
# --no-cache tagab, et Python koodi muutused jõuavad alati konteinerisse
# --remove-orphans eemaldab vanad/üleliigsed konteinerid (nt vana nginx)
docker compose build --no-cache backend
docker compose up -d --remove-orphans

echo "⏳ [3/4] Ootan teenuste käivitumist (5s)..."
sleep 5

echo "🔍 [4/4] Kontrollin staatust..."
docker compose ps

echo "✅ Uuendamine valmis!"
echo "   Kui andmebaas vajab täitmist, käivita: ./scripts/server_seed_data.sh"
echo "   Kui frontend vajab uuendamist, lae 'dist' kaust oma arvutist üles (rsync)."
