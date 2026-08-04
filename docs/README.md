# docs/ — mis on kus

**Elavad dokumendid on selles kataloogis. Kõik valminud plaanid, aegunud ülevaated ja
ajalooline materjal on `_archive/` all** — sealt võib lugeda, aga sealsed väited ei pruugi
enam koodiga kokku käia.

Reegel: kui plaan on teostatud või ülevaate leiud lahendatud, **tõsta fail `_archive/`-sse**
(plaanid → `_archive/superpowers/plans/done/`, disainid → `_archive/superpowers/specs/done/`).
Veel lahtiseks jäänud read tõsta enne `tegemata_tood.md`-sse, et need ei kaoks.

## Elav

| Fail | Mis see on | Loe siis kui |
|---|---|---|
| [decisions/](decisions/) | **ADR-register** — invariandid, mille rikkumine on rikke põhjustanud | ENNE nende alade muutmist (kohustuslik) |
| [tegemata_tood.md](tegemata_tood.md) | Teadaolev tehniline võlg, koodi vastu kontrollitud | Enne „lihtsa parandusena" ettepaneku tegemist |
| [DATA_ARCHITECTURE.md](DATA_ARCHITECTURE.md) | Kolm andmekihti: `_metadata.json` → Meili → frontend, väljade kaardistus | Meili päringute või väljade muutmisel |
| [marginalia-editor-harness-ja-servajuhud.md](marginalia-editor-harness-ja-servajuhud.md) | Marginaalia-editori servajuhud + Playwright-harness | Enne `MarginaliaExtension.ts` puutumist |
| [html-rendering-policy.md](html-rendering-policy.md) | `SafeHtml` allow-list; `dangerouslySetInnerHTML` guard-test | Uue HTML-renderdusjuhtumi lisamisel |
| [deployment_guide.md](deployment_guide.md) | Serveri nullist püstipanek / kolimine | Katastroofitaastel (igapäevane deploy on CLAUDE.md-s) |
| [vutt-backup.md](vutt-backup.md) | `scripts/vutt_backup.py` — `data/` + `state/` snapshot'id | Varunduse seadistamisel (issue #131) |
| [monitoring-bot-traffic.md](monitoring-bot-traffic.md) | Bot/scraper-liikluse jälgimise plaan (D1–D4, **veel rakendamata**) | Kui pildikraapimine muutub probleemiks |
| [reviews/](reviews/) | Ülevaated, millele mujal viidatakse (skaleerimine 2026-07-09 ← ADR 0006) | Skaleerimisküsimuste taustaks |
| [superpowers/plans/](superpowers/plans/) | **Teostamata** plaanid — praegu ainult GlitchTip-deploy (#133) | Enne selle töö alustamist |

## Arhiiv

`_archive/` — valminud plaanid ja disainid (`superpowers/plans/done/`,
`superpowers/specs/done/`), tehtud refaktoreeringud (nt `main.py` routeriteks),
aegunud arhitektuurikirjeldused ja vanad koodiülevaated (`vana/`).
