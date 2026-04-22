"""Ühekordselt jooksev skript: konverteerib status→statuses kõigis prosopograafia kaartides."""
import json
import os
import sys
from pathlib import Path
from typing import Optional

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

_DEFAULT_STATE_DIR = os.path.join(
    os.getenv("VUTT_STATE_DIR", str(PROJECT_ROOT / "state")),
    "prosopography",
)


def migrate(prosopo_dir: Optional[str] = None) -> int:
    """Konverteerib failid; tagastab muudetud failide arvu."""
    target = Path(prosopo_dir or _DEFAULT_STATE_DIR)
    if not target.exists():
        print(f"Kaust puudub: {target}", file=sys.stderr)
        return 0

    changed = 0
    for fpath in target.glob("*.json"):
        try:
            data = json.loads(fpath.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"SKIP {fpath.name}: {e}", file=sys.stderr)
            continue

        if "statuses" in data:
            # Eemalda vana status väli kui see on jäänud
            if "status" in data:
                del data["status"]
                fpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                changed += 1
            continue

        # Konverteeri
        old = data.pop("status", None)
        if old and isinstance(old, dict) and old.get("id"):
            data["statuses"] = [{"id": old["id"], "label": old.get("label", "")}]
        else:
            data["statuses"] = []

        fpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        changed += 1

    print(f"Migreerisin {changed} faili.")
    return changed


if __name__ == "__main__":
    migrate()
