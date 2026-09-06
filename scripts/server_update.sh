#!/bin/bash
# scripts/server_update.sh
# See skript uuendab VUTT rakendust serveris (kood + docker).
# Käivita see skript serveri juurkaustas (nt ~/VUTT).

set -e  # Peata skript vea korral

NO_CACHE=""
FORCE=""
for arg in "$@"; do
  if [ "$arg" = "--no-cache" ]; then
    NO_CACHE="--no-cache"
  fi
  if [ "$arg" = "--force" ] || [ "$arg" = "--anyway" ]; then
    FORCE="1"
  fi
done

# Deploy-valve (#257): restart tapab apply-lõime ja kaotab kasutaja töö.
# Kontroll loeb FAILE, mitte API-t — peab töötama ka siis, kui backend on maas.
# `set -e` ei tohi seda vaikselt läbi lasta, seega väljumiskood käsitsi.
echo "🛡️  [0/5] Kontrollin, kas mõni töö on lennus..."
if [ ! -f scripts/check_inflight.py ]; then
  # Puuduv valve EI TOHI tähendada rohelist tuld.
  echo "❌ scripts/check_inflight.py puudub — kas git pull jäi tegemata?"
  echo "   Kontrolli käsitsi või kasuta --force."
  [ -z "$FORCE" ] && exit 1
fi
INFLIGHT_RC=0
python3 scripts/check_inflight.py "$(pwd)" || INFLIGHT_RC=$?
if [ "$INFLIGHT_RC" -ne 0 ]; then
  if [ -n "$FORCE" ]; then
    echo "⚠️  --force: jätkan HOOLIMATA sellest, et töö on lennus."
    echo "   Pooleliolev upload jääb 'applying' olekusse; taaste viib ta"
    echo "   käivitusel tagasi (#256), aga kasutaja peab 'Rakenda' uuesti vajutama."
  else
    exit 1
  fi
fi

echo "🔄 [1/4] Uuendan koodi Gitist..."
git pull

echo "🐳 [2/4] Ehitan ja taaskäivitan Docker konteinerid (sh. Python serverid)..."
if [ -n "$NO_CACHE" ]; then
  echo "   (--no-cache: ehitab nullist, ignoreerib vahemälu)"
fi
docker compose build $NO_CACHE backend
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
