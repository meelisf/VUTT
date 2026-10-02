# HTR-mudelite võrdlus käsikirjal (2026-10-02)

**Mõõtmine on ÜHE lehe põhjal.** See näitab, millised mudelid on üldse
konkurentsis, aga ei järjesta tippu usaldusväärselt. Otsuse jaoks on vaja
10–20 kontrollitud lehte eri käekirjadest; skriptid on selleks valmis.

Toorandmed, skriptid ja kõigi mudelite väljundid:
[`2026-10-02-htr-mudelite-vordlus/`](2026-10-02-htr-mudelite-vordlus/).

## Kokkuvõte

- **Tootmise Gemini mudelit (`gemini-3.8-flash`, `thinking_level=low`) ei ole
  põhjust vahetada.** Ta on tipus 0,003 $/lk hinnaga. Selgelt parem on ainult
  `claude-fable-5.1` (~32× kallim).
- **Meie peenhäälestatud Qwen 3.5 9B (`kurrent-20260829`, LOSS) on tähetasemel
  Gemini Flashiga samal tasemel** ja toores CER on kõigist parim (5,3 %).
  Sõnatasemel jääb ta maha, sest korduvad nimevead (`Oesel → Osel` ×4,
  `Ekesparre → Eresparre` ×3) lähevad iga esinemisega uuesti arvesse.
- Teise rühma mudelid (grok, kimi, qwen-max/flash, mistral, glm, mimo, gemma,
  deepseek) on Kurrenti jaoks kasutuskõlbmatud (CER 13–55 %).

## Testleht

`1745-berichte-von-der-insel-oesel-…-m3do2t`, lk 3: Herrnhuti aruanne
(„Historischer Bericht von dem Werk des HErrn auf der Insel Oesel seit 1753"),
saksa Kurrent, 18. sajandi teine pool. Pilt on telefonifoto (2268×4032), mitte
skaneering. Võrdlustekst on inimese kontrollitud transkriptsioon
([`inimese_transkriptsioon_lk003.txt`](2026-10-02-htr-mudelite-vordlus/inimese_transkriptsioon_lk003.txt)).

## Meetod

- **Üldmudelid** jooksid OpenRouteri kaudu (`bench.py`) sama juhisega, mida
  kasutab tootmise Gemini-tee (`GEMINI_HAND_INSTRUCTION`, `server/ocr_prompts.py`).
  Pilt skaleeriti nagu tootmises (pikem külg ≤ 4000 px, JPEG q90), mõtlemine oli
  kõigil `low`. Iga mudelit jooksutati vähemalt 2 korda, Gemini Flashi 6 korda.
- **Qwen 3.5 9B** jooksis LOSSi llama.cpp serveri (`:8081`) vastu täpselt
  valvuri seadetega: `fit_to_grid`, PNG, `KURRENT_INSTRUCTION`,
  `temperature 0`, mõtlemine väljas. Tulemus on deterministlik, seega piisab
  ühest jooksust.
- **Mõõdikud** (`score.py`):
  - *CER toores*: tühikud ühtlustatud, muu nagu on.
  - *CER norm*: ſ = s, poolitusmärgid (`⸗ ¬ = _`) ühtseks, reavahetus = tühik,
    arhiivitempel (`R.19.G.aa.M.20.`) välja.
  - *WER*: normaliseeritud tekstil.
- **Hind** on OpenRouteri tegelik `usage.cost` (mediaan), ilma batch-allahindluseta.

## Tulemused

Mediaanid üle kehtivate jooksude; sulgudes jooksude vahemik.

| Mudel | Jookse | CER norm | CER toores | WER | $/lk | s/lk |
|---|---|---|---|---|---|---|
| anthropic/claude-fable-5.1 | 2 | **1,5 %** (1,5–1,5) | 5,9 % | **7,8 %** | 0,095 | 24 |
| google/gemini-3.8-flash (low) — **tootmine** | 6 | 2,5 % (2,3–3,3) | 5,3 % | 9,4 % | **0,003** | 21 |
| **Qwen 3.5 9B kurrent-20260829 (LOSS)** | 1 | 2,6 % | **5,3 %** | 13,3 % | 0 (oma GPU) | **7** |
| openai/gpt-6-astra | 2 | 2,7 % (2,4–3,0) | 5,6 % | 11,4 % | 0,10–0,16 | 46 |
| google/gemini-3.8-flash (medium) | 2 | 3,0 % (1,7–4,2) | 6,2 % | 10,0 % | 0,014 | 43 |
| anthropic/claude-opus-5.5 | 2 | 3,6 % (2,9–4,3) | 8,0 % | 10,6 % | 0,038 | 20 |
| google/gemini-pro-latest | 3 | 4,2 % (3,3–4,4) | 8,3 % | 14,1 % | 0,009–0,024 | 33 |
| anthropic/claude-sonnet-5.5 | 2 | 5,0 % (4,9–5,2) | 7,3 % | 16,1 % | 0,019 | 18 |
| openai/gpt-6.1-sol | 2 | 6,6 % (6,2–6,9) | 9,2 % | 21,9 % | 0,019–0,033 | 69 |
| x-ai/grok-4.7 | 2 | 13,3 % | 16,4 % | 29,3 % | 0,058 | 92 |
| google/gemini-3.5-flash-lite | 2 | 13,6 % | 16,5 % | 38,8 % | 0,002 | 45 |
| qwen/qwen3.8-max-0902 | 2 | 15,2 % | 16,7 % | 34,5 % | 0,010 | 38 |
| meta/muse-spark-1.3 | 2 | 24,9 % | 28,1 % | 47,0 % | 0,013 | 35 |
| moonshotai/kimi-k3 | 2 | 34,3 % | 36,0 % | 58,2 % | 0,048 | 39 |
| qwen/qwen3.8-flash | 2 | 35,4 % | 38,6 % | 69,1 % | 0,002 | 54 |
| google/gemma-4-31b-it | 2 | 45,0 % | 47,0 % | 84,5 % | 0,002 | 293 |
| deepseek/deepseek-v4-flash-vision-exp | 2 | 48,0 % (27,9–68,1) | 50,1 % | 72,1 % | 0,005 | 58 |
| mistralai/mistral-medium-3-5 (mõtlemiseta) | 2 | 49,7 % | 52,4 % | 82,7 % | 0,009 | 25 |
| z-ai/glm-5v-turbo | 2 | 50,3 % | 52,4 % | 83,7 % | 0,022 | 53 |
| xiaomi/mimo-v2.6-pro | 2 | 55,5 % | 56,7 % | 85,3 % | 0,012 | 302 |
| openai/gpt-6-luna | 2 | — (jäi kordama) | | | 0,005 | 102 |

Kogu katse maksis umbes 2,50 $.

## Vigade iseloom

Sõnatasemel erinevused normaliseeritud tekstis:

- **Fable**: valdavalt normaliseerimine, mitte lugemisviga:
  `BurgeMeister → BürgerMeister`, `stat → statt`, `v. → v`, `voller → voll-`.
- **Gemini Flash**: rohkem sisulisi lugemisvigu, eriti nimedes:
  `Röicks → Körcks`, `Glanström → Glaeström`, `Ersterer → Letztrer`,
  `l. H. → C. D.`.
- **Qwen 3.5 9B**: üks valesti õpitud tähekuju kordub iga esinemisega
  (`Oesel → Osel`, `Ekesparre → Eresparre`, `Blauberg → Blanberg`). Lisaks
  üksikvead: `übers Eiß → überschiz`, `Lebens → Lebnus`, `nach → noch`.
  Poolitusmärk on `_`, mitte juhises nõutud `¬`.

## Mõõtmise lõksud — loe enne kordamist

1. **Gemini OpenRouteri kaudu on ebastabiilne.** Umbes 3 vastust 10-st tuli 0
   sisendtokeniga (vastus „Hi" või tühi) ja need korrati. `high` põletas kõik
   16 000 tokenit mõtlemisele ega andnud teksti; `medium` töötas. OpenRouteri
   Gemini kasutas ainult ~1500 sisendtokenit, mis tähendab madalat
   pildiresolutsiooni. Tootmise otsetee (Interactions API) võib käituda
   teisiti, nii et tootmise baastase võib olla parem kui siin.
2. **Võrdlustekstis on tõenäoliselt vigu.** Kõik neli parimat mudelit loevad
   pealkirjas „Insul" (pildil on selgelt u) ja põhitekstis „1753" (võrdlustekstis
   „1763"; pildil kahemõtteline). Fable'i „U. Ä. C." (Unitäts-Ältesten-Conferenz)
   on tõenäoliselt õigem kui „U. A. C.". Tipu tegelik CER on seega veidi
   madalam, kui tabel näitab.
3. **Poolituskokkulepe on lahknev.** `GEMINI_HAND_INSTRUCTION` ja
   `KURRENT_INSTRUCTION` nõuavad `¬`-d, inimese transkriptsioon kasutab `⸗`-d
   ja Qwen kirjutab `_`. Suurem osa toore ja normaliseeritud CER-i vahest tuleb
   sellest ja ſ/s kõikumisest. Kokkulepe tasub ühtlustada.
4. **Mõtlemiseelarve.** Mistral põletas `low` juures 16 000 tokenit mõtlemisele
   ja tagastas tühja vastuse, seega jooksis ta mõtlemiseta. `qwen3.8-max`
   tagastas ühel jooksul tühja vastuse, mida ei loetud.

## Treeningandmed: mis on uut (kontrollitud 2026-10-02)

Taust: `kurrent-20260829` treeniti 16 971 lehega (LOSS
`docs/kurrent-andmestikud.md`, `docs/SEIS.md`). Allikad laaditi alla
2026-06-01…03. LOSSi `kurrent-strateegia.md` järgi on teadaolev auk
**18. sajandi saksa Kurrent**, ehk just selle testlehe tüüp.

**Kasutatud andmestikes ei ole pärast allalaadimist uut sisu.** dh-unibe
andmestike viimane muudatus on 2026-04 ja Riksarkiveti oma 2024-08.
`fgho/hanse-kurrent-xvi-rawxml` muutus 2026-09-02, aga ainult README.

**Uued või seni kasutamata kandidaadid:**

| Andmestik | Maht | Periood / sisu | Hinnang |
|---|---|---|---|
| [fgho/hanse-kurrent-xvii-rawxml](https://huggingface.co/datasets/fgho/hanse-kurrent-xvii-rawxml) (uus, 2026-07-09) | 1 298 lk, 10,8 GB — **LOSSi alla laaditud** | 1600–1669, alamsaksa linnapäevade retsessid; PAGE XML, poolitus `¬`, ladina sõnad antiikvas (sama code-switching nagu VUTT-is) | **Parim kandidaat** — saksa XVII saj Kurrent, kõige lähemal aukule |
| [Zenodo 15303398](https://zenodo.org/records/15303398) Dresdner Hofdiarium 1653–56 | 12 lk, CC BY 4.0 | XVII saj Saksi Kanzleikurrent | Väike, aga sama sari kui kasutusel olevad 1665/1673; `build_dresdner_dataset.py` |
| [dh-unibe/image-text_kurrent-xix](https://huggingface.co/datasets/dh-unibe/image-text_kurrent-xix) | **144 533 lk / 321 projekti** (meil kasutusel 8 000) | XIX–XX saj | **Meie 8 000 lehte on KÕIK Zürichi valitsusprotokollid** (`MM_1_001…033`): build-skript voogedastab shard'ide järjekorras ja lõpetab enne, kui jõuab mujale. 121 muud projekti (~78 GB, READ/CITlab GT: kirjad, päevikud, protokollid, eri käed) on kasutamata. Pisteliselt: osa on XX saj (Arnoldi päevik 1940ndad, Eestimaa rüütelkond 1900–1915), `parthey` ja `nn_msgermqu2124_1827` valdavalt transkribeerimata, palju duplikaate. Vt allpool |
| [fgho/hanse-kurrent-xv](https://huggingface.co/datasets/fgho/hanse-kurrent-xv) | 429 lk | XV saj | Meie ajast liiga vara |
| dh-unibe `rats-und-richtebuecher_xv-xvi`, `koenigsfelden-charters-post-1500`, `aaeb-xiv-xvii-part-2` (121 lk, XV saj) | 3–13 tuh lk | XIV–XVI saj | Liiga vara; kesk-ülemsaksa |
| Zenodo [21257417](https://zenodo.org/records/21257417), [21360877](https://zenodo.org/records/21360877) Gottfried Semper | väike (66 + 87 MB) | XIX saj keskpaik | XIX saj, ei aita augule |
| Riksarkivet `goteborgs_poliskammare_fore_1900`, `frihetstidens_utskottshandlingar` (mitte-`_seg`) | ? | XVIII–XIX saj rootsi | Laadimisskriptiga andmestikud, mahtu ei saanud API-st; `_seg` variant oli varem tühjade transkriptsioonidega — tasub kontrollida, kas mitte-`_seg` kannab teksti |

**Järeldus:** 18. sajandi saksa Kurrenti avalikke lehetasemel GT-andmeid ei ole
endiselt. Lähim samm on `hanse-kurrent-xvii` (+1 298 lk, ~+8 %).

**Mitmekesisus, mitte maht.** 47 % treeningkorpusest on üks Zürichi
kantseleisari (puhtand). See sobib kokku tähelepanekuga, et mudel loeb selget
kätt hästi, aga isiklikke ja õpetlaste käsi (Morgenstern, XIX saj algus)
kehvalt, samal ajal kui Gemini on seal palju parem. Järgmisel treeningul tasub
Zürichi osakaalu vähendada ja võtta kurrent-xix-i mitte-Zürichi projektid
(pärast dateerimist ja dedup'i) ning hanse-xvii. Detailid ja pisteliste
kontrollide tabel: LOSS `docs/kurrent-andmestikud.md`, jaotis „Ülevaatus
2026-10-02". Tuntavam
paranemine 18. sajandi materjalil tuleb tõenäoliselt **oma andmetest**: VUTT-i
„Valmis" käsikirjalehed (Herrnhuti diaariumid, aruanded) on täpselt see
domeen, mida avalikult ei ole. Transkribuse avalik mudel
„German Kurrent 17th–18th century" (Greifswaldi ülikooli protokollid, Wismari
ülemkohus) näitab, et selline GT on olemas, aga see ei ole avalik.
