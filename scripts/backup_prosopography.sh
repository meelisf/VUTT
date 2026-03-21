#!/bin/bash
# scripts/backup_prosopography.sh
#
# Kopeerib prosopograafia kaardid state/prosopography/ → data/prosopography/
# ja commitib muudatused. Öine cron (kell 2:00) pushib data/ repo GitHubi.
#
# Käivitamine: cd ~/VUTT && bash scripts/backup_prosopography.sh
# Cron (1:50 enne puschi): 50 1 * * * cd ~/VUTT && bash scripts/backup_prosopography.sh 2>&1 | logger -t vutt-prosopo-backup

set -e

VUTT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$VUTT_DIR/state/prosopography"
DEST="$VUTT_DIR/data/prosopography"

if [ ! -d "$SRC" ]; then
    echo "VIGA: $SRC ei leitud" >&2
    exit 1
fi

mkdir -p "$DEST"
rsync -a --delete "$SRC/" "$DEST/"

cd "$VUTT_DIR/data"

git add prosopography/

if git diff --cached --quiet; then
    echo "Prosopograafia muudatusi pole, commit jäetakse vahele."
    exit 0
fi

CARD_COUNT=$(find "$DEST" -name "*.json" | wc -l | tr -d ' ')
git commit -m "Prosopograafia backup $(date +%Y-%m-%d) (${CARD_COUNT} kaarti)"
echo "Commit tehtud."
