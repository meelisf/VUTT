#!/bin/bash
# scripts/server_update.sh
# See skript uuendab VUTT rakendust serveris (kood + docker).
# Käivita see skript serveri juurkaustas (nt ~/VUTT).

set -e  # Peata skript vea korral

echo "🔄 [1/3] Uuendan koodi Gitist..."
git pull

echo "🐳 [2/3] Ehitan ja taaskäivitan Docker teenused..."
# --remove-orphans eemaldab vanad/üleliigsed konteinerid (nt vana nginx)
docker compose up -d --build --remove-orphans

echo "⏳ Ootan teenuste käivitumist (5s)..."
sleep 5

echo "🔍 [3/3] Kontrollin staatust..."
docker compose ps

echo "✅ Uuendamine valmis!"
echo "   Kui andmebaas vajab täitmist, käivita: ./scripts/server_seed_data.sh"
echo "   Kui frontend vajab uuendamist, lae 'dist' kaust oma arvutist üles (rsync)."
