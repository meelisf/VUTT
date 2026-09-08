"""Commiti metaandmete lugemine tekstist (#337).

Vana tee luges autori, kuupäeva ja sõnumi GitPythoni Commit-objektist LAISALT,
jagatud objektibaasi kaudu. Kaks samaaegset päringut said sama torust
vahetusse: hash jäi õigeks, aga autor ja kuupäev tulid võõralt commitilt.
Siin kontrollitakse, et tekstiparsimine seob väljad ÜHE kirje sees kokku.
"""
from datetime import datetime

from server.git_ops import _COMMIT_FIELD_SEP, _parse_commit_meta

US = _COMMIT_FIELD_SEP


def rec(hexsha, author, iso, message):
    return f"{hexsha}{US}{author}{US}{iso}{US}{message}\0"


def test_valjad_jaavad_uhe_kirje_sisse():
    out = (rec("a" * 40, "meelis", "2026-09-08T14:39:12+03:00", "Muuda: x.txt")
           + rec("b" * 40, "raheltoomik", "2026-09-04T13:33:01+03:00", "Muuda: y.txt"))
    got = _parse_commit_meta(out)
    assert [(r["hexsha"][:1], r["author"]) for r in got] == [("a", "meelis"), ("b", "raheltoomik")]
    assert got[0]["date"] == datetime.fromisoformat("2026-09-08T14:39:12+03:00")
    assert got[0]["message"] == "Muuda: x.txt"


def test_mitmerealine_sonum_ei_lohu_jargmist_kirjet():
    # `%B` võib sisaldada reavahetusi. Reapõhine parsimine oleks siin murdunud
    # ja järgmise commiti autor oleks sattunud eelmise sõnumi sisse.
    msg = "Muuda: x.txt\n\nPikk selgitus\nteisel real"
    out = rec("c" * 40, "annipolding", "2026-09-08T10:00:00+00:00", msg) + \
        rec("d" * 40, "meelis", "2026-09-08T09:00:00+00:00", "Muuda: z.txt")
    got = _parse_commit_meta(out)
    assert len(got) == 2
    assert got[0]["author"] == "annipolding"
    assert got[0]["message"] == msg
    assert got[1]["author"] == "meelis"


def test_jarjestus_sailib():
    out = "".join(rec(str(i) * 40, f"u{i}", f"2026-09-0{i}T10:00:00+00:00", "m") for i in range(1, 5))
    got = _parse_commit_meta(out)
    assert [r["author"] for r in got] == ["u1", "u2", "u3", "u4"]
    assert [r["date"].day for r in got] == [1, 2, 3, 4]


def test_vigane_kirje_jaetakse_vahele_teisi_nihutamata():
    out = (rec("e" * 40, "meelis", "2026-09-08T10:00:00+00:00", "ok")
           + "katkine-kirje-ilma-valjadeta\0"
           + rec("f" * 40, "raheltoomik", "2026-09-08T11:00:00+00:00", "ok2"))
    got = _parse_commit_meta(out)
    assert [r["author"] for r in got] == ["meelis", "raheltoomik"]


def test_vigane_kuupaev_ei_kukuta_lugemist():
    out = (rec("0" * 40, "meelis", "mitte-kuupaev", "x")
           + rec("1" * 40, "meelis", "2026-09-08T10:00:00+00:00", "y"))
    got = _parse_commit_meta(out)
    assert len(got) == 1 and got[0]["message"] == "y"


def test_tuhi_valjund():
    assert _parse_commit_meta("") == []


def test_z_lopuga_kuupaev_utc():
    """Git väljastab UTC-commiti `Z`-lõpuga; Python 3.9 fromisoformat ei võta seda vastu.

    Ilma teisenduseta kukkus IGA kirje vaikselt välja ja nimekiri jäi tühjaks —
    tootmises tähendas see tühja „Viimased muudatused" vaadet.
    """
    from datetime import timezone
    got = _parse_commit_meta(rec("a" * 40, "meelis", "2026-09-08T14:39:33Z", "Muuda: x.txt"))
    assert len(got) == 1
    assert got[0]["date"].utcoffset() == timezone.utc.utcoffset(None)
    assert got[0]["date"].hour == 14


def test_nihkega_kuupaev_sailitab_nihke():
    got = _parse_commit_meta(rec("b" * 40, "meelis", "2026-09-08T14:39:33+03:00", "m"))
    assert got[0]["date"].hour == 14
    assert got[0]["date"].utcoffset().total_seconds() == 3 * 3600
