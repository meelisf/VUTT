#!/bin/bash
# scripts/server_seed_data.sh
# See skript täidab Meilisearchi andmebaasi nullist.
# NB! See võib võtta aega ja kustutab olemasoleva indeksi 'teosed'.
#
# Mitteinteraktiivselt (nt SSH kaudu): echo y | ./scripts/server_seed_data.sh
set -euo pipefail

# `docker exec -it` NÕUAB TTY-d. SSH kaudu (ilma -t) kukkusid varem kõik kolm
# sammu „the input device is not a TTY" veaga, aga skript trükkis ikkagi
# eduteate — väljumiskoode ei kontrollitud. Lisa -t ainult siis, kui TTY on.
TTY_FLAG=()
[ -t 1 ] && TTY_FLAG=(-t)

run_in_backend() {
    docker exec -i "${TTY_FLAG[@]}" vutt-backend "$@"
}

echo "⚠️  HOIATUS: See skript kustutab ja taasloob 'teosed' indeksi."
read -p "Kas oled kindel? (y/n) " -n 1 -r || true
echo
if [[ ! ${REPLY:-} =~ ^[Yy]$ ]]
then
    echo "Katkestatud."
    exit 1
fi

echo "🚀 [1/3] Koondan andmed (consolidate)..."
run_in_backend python3 scripts/1-1_consolidate_data.py

echo "🚀 [2/3] Saadan Meilisearchi (upload)..."
run_in_backend python3 scripts/2-1_upload_to_meili.py

echo "🚀 [3/3] Taastan prosopograafia indeksid..."
run_in_backend python3 -c "from server.prosopography.ops import rebuild_indices; rebuild_indices()"

# set -e katkestab ülal vea korral, seega siia jõuab ainult õnnestumisel
echo "✅ Andmed laetud ja prosopograafia indeksid uuendatud!"
