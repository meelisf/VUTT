# ADR 0061 — Teose halduse pööre ja kärbe on ootel toiming, nagu poolitus

**Kuupäev:** 2026-10-04
**Staatus:** vastu võetud
**Asendab osaliselt:** ADR 0050 („Kärbe/kalle/pööre redaktoris jäävad kohe kehtivaks")

## Kontekst

ADR 0050 tegi teose halduse hulgipöörde ja poolituse ootel plaaniks, aga
pildiredaktori „Pööra & kärbi" vahekaart kirjutas faili endiselt kohe kettale.
Kasutajad on upload'is ja poolitamisel harjunud mustriga „märgi → vaata →
Rakenda kõik korraga" ja kohene kärbe käitus teisiti. Lisaks ei leidnud mitu
kasutajat kärpimist üldse: kaardil oli redaktori avamiseks ainult käärid-ikoon,
mida loeti poolitamiseks, ja lehti poolitati seal, kus oleks tulnud kärpida.

## Otsus

- **Ootel kirjel on valikuline `adjust`** (`{angle, crop | quad}`, sama leping mis
  upload'i plaanis, ADR 0049): **pööratud lehe raamis**. Järjekord lehe sees:
  pööre → adjust → poolitus (joon kohandatud lehe laiuses).
- Redaktori „Pööra & kärbi" vahekaardi nupp on **„Märgi"**: kirjutab plaani
  pöörde ja kärpe korraga (`setPendingEdit`) ning liigub järgmisele lehele.
  Jäme pööre algab ootel pöördest. Ainult pööre ilma kastita eemaldab kärpe.
- **Pöörde muutus eemaldab kärpe** (`withRotation`, nagu upload'is): kärbe
  kuulus eelmisse raami. Ka „Taasta originaal" ja pildi asendus eemaldavad ootel
  kärpe — pilt, mille raamis see joonistati, on muutunud.
- Serveris on pööre + adjust **üks teisendus ja üks JPEG-kodeering**
  (`_transform_locked` nurgaga `rotate + adjust.angle`): 90° kordne pööre
  `expand`-iga annab telgjoondatud ristküliku, seega tulemus on sama.
- **Eelvaade on serveri renderdus** (`GET /admin/work/{id}/page-image/{fn}/preview
  ?rot=&adj=&size=thumb|view`, `render_page_preview`), mitte CSS: kalle/perspektiiv
  CSS-iga ei kattuks täpselt apply lõikega. Teisendus käib URL-is (deterministlik,
  vahemälu ei saa valet pilti hoida). Kaart kasutab seda ainult kärpega lehel;
  poolitusvahekaart samuti — joon käib siis eelvaate laiuse järgi igal pöördel.
- Kaardil on **kaks eraldi nuppu**: kärbi/sirgesta/pööra (`Crop`) ja poolita
  (`Columns2`), kumbki avab redaktori oma vahekaardil.

## Tagajärjed

- `POST /admin/work/{id}/page-image/{fn}/transform` jääb alles (nagu ADR 0050 järel
  poolituse endpoint), aga UI seda enam ei kasuta.
- Redaktor ei näita uuesti avamisel ootel kärpekasti (hook ei taasta kasti
  plaanist) — rida „Ootel kärbe" + „Eemalda kärbe"; uus kast asendab vana. Sama
  nagu upload'i detailvaates.
- Valvurid: `tests/test_page_ops_batch.py` (järjekord, üks kodeering, eelvaade),
  `src/pages/manage/__tests__/pageOpsPlan.test.ts`, `PageCard.pending.test.tsx`,
  `src/components/__tests__/PageImageEditorModal.split.test.tsx`.
