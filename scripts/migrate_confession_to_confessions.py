"""Ühekordselt jooksev skript: konverteerib confession→confessions kõigis prosopograafia kaartides."""
import json
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

_DEFAULT_PROSOPO_DIR = os.path.join(
    os.getenv("VUTT_STATE_DIR", str(PROJECT_ROOT / "state")),
    "prosopography",
)


def migrate(prosopo_dir: str | None = None) -> int:
    """Konverteerib failid; tagastab muudetud failide arvu."""
    target = Path(prosopo_dir or _DEFAULT_PROSOPO_DIR)
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

        if "confessions" in data:
            # Eemalda vana confession väli kui see on jäänud
            if "confession" in data:
                del data["confession"]
                fpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                changed += 1
            continue

        # Konverteeri
        old = data.pop("confession", None)
        if old and isinstance(old, dict) and old.get("id"):
            data["confessions"] = [{"id": old["id"], "label": old.get("label", "")}]
        else:
            data["confessions"] = []

        fpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        changed += 1

    print(f"Migreerisin {changed} faili.")
    return changed


if __name__ == "__main__":
    migrate()
