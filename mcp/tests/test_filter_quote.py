"""#616: Meili filtriväärtuse escape — sama reegel serveris ja frontendis."""
import pytest

from vutt_mcp.queries import _quote


@pytest.mark.parametrize("value, expected", [
    ("Reval", '"Reval"'), ('a"b', '"a\\"b"'), ('a\\"b', '"a\\\\\\"b"'), ("lõpp\\", '"lõpp\\\\"'),
])
def test_quote(value, expected):
    assert _quote(value) == expected
