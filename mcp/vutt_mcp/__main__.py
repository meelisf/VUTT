"""stdio-käivitus. stdout on reserveeritud MCP protokollile — logi ainult stderr'i."""
import logging
import sys

from .server import build_server


def main() -> None:
    # KRIITILINE: stdout kuulub MCP protokollile. Üksainus print() rikub voo
    # ja klient kaotab serveri. Kogu diagnostika läheb stderr'i.
    logging.basicConfig(
        stream=sys.stderr,
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    build_server().run(transport="stdio")


if __name__ == "__main__":
    main()
