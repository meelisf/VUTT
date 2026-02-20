#!/bin/bash
# scripts/server_update.sh
# See skript uuendab VUTT rakendust serveris (kood + docker).
# Käivita see skript serveri juurkaustas (nt ~/VUTT).

set -e  # Peata skript vea korral

echo "🔄 [1/4] Uuendan koodi Gitist..."
git pull

echo "🐳 [2/4] Ehitan ja taaskäivitan Docker teenused..."
# --remove-orphans eemaldab vanad/üleliigsed konteinerid (nt vana nginx)
docker compose up -d --build --remove-orphans

echo "🐍 [3/4] Taaskäivitan Python serverid (file_server + image_server)..."
pkill -f "file_server.py" 2>/dev/null || true
pkill -f "image_server.py" 2>/dev/null || true
sleep 1
mkdir -p logs
export PYTHONPATH="$(pwd)"
VENV_PYTHON=".venv/bin/python3"
[ -f "$VENV_PYTHON" ] || VENV_PYTHON="python3"
nohup $VENV_PYTHON server/image_server.py > logs/pildiserver.log 2>&1 &
echo "   Pildiserver PID: $!"
nohup $VENV_PYTHON server/file_server.py > logs/apiserver.log 2>&1 &
echo "   API Server PID: $!"

echo "⏳ Ootan teenuste käivitumist (5s)..."
sleep 5

echo "🔍 [4/4] Kontrollin staatust..."
docker compose ps
pgrep -a -f "file_server.py" || echo "   ⚠️  file_server.py ei jookse!"

echo "✅ Uuendamine valmis!"
echo "   Kui andmebaas vajab täitmist, käivita: ./scripts/server_seed_data.sh"
echo "   Kui frontend vajab uuendamist, lae 'dist' kaust oma arvutist üles (rsync)."
