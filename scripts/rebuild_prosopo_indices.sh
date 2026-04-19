#!/bin/bash
# Taastab prosopograafia indeksid (prosopography_index.json jm).
# Kasuta pärast isikukaartide, places.json või origin_groups.json muutmist.

set -e
cd "$(dirname "$0")/.."

echo "🔄 Taastan prosopograafia indeksid..."
docker exec vutt-backend python3 -c "
from server.prosopography.ops import rebuild_indices
rebuild_indices()
print('✅ Valmis')
"
