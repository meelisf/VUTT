#!/bin/bash

# ============================================
# VUTT TEENUSTE KÄIVITAJA
# ============================================

# 0. Peata vanad teenused, et vältida pordikonflikte
echo "Peatan vanad teenused..."
pkill -f "meilisearch" 2>/dev/null
pkill -f "image_server.py" 2>/dev/null
pkill -f "file_server.py" 2>/dev/null
sleep 1

# 1. Logide kaust
mkdir -p logs

# 2. Meilisearch
# Eeldab, et meilisearch binaarfail on samas kaustas. 
# Kui on installitud globaalselt, kasuta lihtsalt käsku 'meilisearch'
echo "Käivitan Meilisearchi (Port 7700)..."
if [ -f "./meilisearch" ]; then
    nohup ./meilisearch --http-addr '0.0.0.0:7700' > logs/meilisearch.log 2>&1 &
else
    nohup meilisearch --http-addr '0.0.0.0:7700' > logs/meilisearch.log 2>&1 &
fi
echo "Meilisearch PID: $!"

# 3. Pythoni serverid
# Aktiveeri venv, kui see eksisteerib
if [ -d "venv" ]; then
    source venv/bin/activate
fi

echo "Käivitan Pildiserveri (Port 8001)..."
nohup python3 image_server.py > logs/pildiserver.log 2>&1 &
echo "Pildiserver PID: $!"

echo "Käivitan Failisalvestuse API (Port 8002)..."
nohup python3 file_server.py > logs/apiserver.log 2>&1 &
echo "API Server PID: $!"
