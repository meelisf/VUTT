#!/bin/bash
# Konteineris jookseb KAKS protsessi: file server (8002) ja image server (8001).
#
# Varem lõppes CMD `wait`-iga, mis ootab MÕLEMAT. Kui image_server suri,
# jäi bash teist ootama, konteiner jäi „töötab" olekusse ja `restart: always`
# ei käivitunud kunagi — skaneeringud lihtsalt lakkasid, ilma ühegi märgita
# (#388). `wait -n` lõpetab esimese surma peale, konteiner kukub ja Docker
# taastab ta.
#
# NB: see taastab KOGU konteineri, seega ka elus pool saab paarisekundilise
# katkestuse. Puhtam tee (kaks eraldi teenust compose'is) on #388-s alles.

python3 -m uvicorn server.main:app --host 0.0.0.0 --port 8002 &
FILE_SERVER=$!

python3 -m server.image_server &
IMAGE_SERVER=$!

# `docker stop` saadab SIGTERM-i ainult PID 1-le. Ilma edastuseta ootas Docker
# 10 s ja tappis konteineri SIGKILL-iga; nüüd lõpetavad lapsed ise.
lopeta() {
    trap '' TERM INT
    kill -TERM "$FILE_SERVER" "$IMAGE_SERVER" 2>/dev/null
    wait
    exit 0
}
trap lopeta TERM INT

wait -n
rc=$?
echo "vutt-backend: taustaprotsess lõppes (rc=$rc) — sulgen konteineri, et restart: always taastaks" >&2

kill -TERM "$FILE_SERVER" "$IMAGE_SERVER" 2>/dev/null
wait
exit 1
