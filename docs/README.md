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
| [ocr-ssh-key.md](ocr-ssh-key.md) | Eraldi OCR-võti, piirangud ja tagasipööramine | OCR-ühenduse või võtme muutmisel |
| [monitoring-bot-traffic.md](monitoring-bot-traffic.md) | Bot/scraper-liikluse jälgimise plaan (D1–D4, **veel rakendamata**) | Kui pildikraapimine muutub probleemiks |
| [reviews/](reviews/) | Ülevaated, millele mujal viidatakse (skaleerimine 2026-07-09 ← ADR 0006) | Skaleerimisküsimuste taustaks |
| [reviews/2026-10-31-eksemplari-kiht-jarelkontroll.md](reviews/2026-10-31-eksemplari-kiht-jarelkontroll.md) | Järelkontroll: vana `archive_refs` kirjutustee pühiks eksemplari väljad, kirje ≠ eksemplar, `replace-image` ja poolitus vs vaatlused, „leht 0" ei aita, avaliku teose privaatne vaatlus | Enne eksemplari kihi ADR-i |
| [reviews/2026-10-31-eksemplari-kiht-koodi-ulevaade.md](reviews/2026-10-31-eksemplari-kiht-koodi-ulevaade.md) | Eksemplari kihi arutelu (#696) vastu koodi: `archive_refs`, lehe aadress ainult käsikirjal, lehtedeta teos, pildiserver, lehetüved, vaatluste salvestuskoht | Enne eksemplari kihi ADR-i |
| [reviews/2026-10-28-dubleerimise-jarelkontroll.md](reviews/2026-10-28-dubleerimise-jarelkontroll.md) | Paralleelteostused: HTTP-kiht, tagasiside, viewer-token, ajalugu, isikufiltrid, agendikoodid, taustatööd (#670–#675) | Enne nende alade puutumist või uue ettepanekuliigi/pika toimingu lisamist |
| [reviews/2026-10-02-htr-mudelite-vordlus.md](reviews/2026-10-02-htr-mudelite-vordlus.md) | Käsikirja-OCR: 20 üldmudelit + meie Qwen 3.5 9B ühel Kurrendi lehel (CER/WER/hind); uued treeningandmestikud | OCR-mudeli vahetuse või järgmise Kurrendi treeningu eel |
| [reviews/2026-09-27-turva-ja-andmelekke-ulevaade.md](reviews/2026-09-27-turva-ja-andmelekke-ulevaade.md) | Andmelekkeriskid: kood, tootmise saladuste ja failide õigused, teenuste eraldatus | Turvaparanduste planeerimisel ja tootmise järelkontrollil |
| [reviews/2026-09-15-koodibaasi-ulevaade.md](reviews/2026-09-15-koodibaasi-ulevaade.md) | Koodibaasi ülevaatus: saladuste kontroll, turva, hallatavus, pikaealisus (P0–P2) | Enne suuremat refaktorit või uue töö planeerimist |
| [superpowers/specs/2026-10-19-eksemplari-kiht-ja-paber-arutelu.md](superpowers/specs/2026-10-19-eksemplari-kiht-ja-paber-arutelu.md) | Arutelu (mitte otsus): eksemplari kiht, üks tekstitunnistaja, paber.ut.ee vesimärkide arhiiv + import (#696) | Enne eksemplari-, leidumuse- või paberiandmete tööd |
| [superpowers/specs/](superpowers/specs/) | **Lahtised** disainid: teose osad (PR 4 CMIF, #464/#526), isiku lisamise voog (ülevaatusjärjekord), contributor-ulatuse B osa, Gemini re-OCR superadmin | Enne selle töö jätkamist |
| [superpowers/plans/](superpowers/plans/) | **Teostamata** plaanid — praegu tühi (2026-10-01) | Enne selle töö alustamist |

## Arhiiv

`_archive/` — valminud plaanid ja disainid (`superpowers/plans/done/`,
`superpowers/specs/done/`), tehtud refaktoreeringud (nt `main.py` routeriteks),
aegunud arhitektuurikirjeldused ja vanad koodiülevaated (`vana/`).
