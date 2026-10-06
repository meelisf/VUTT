# ADR 0062 — Lühendusmärk on makron, mitte tilde

**Kuupäev:** 2026-10-04
**Staatus:** kehtib (teostus: #533, valmis 2026-10-06; jääk: #558)

## Kontekst

Varauusaegsetes trükistes ja käsikirjades märgib rõhtjoon tähe kohal ärajäetud
nasaali või silpi (`cū` = *cum*, `nō` = *non*, `vn̄` = *und*, `Cam̄erherr`).
VUTT-is on see seni kirjutatud valdavalt **tildena** ja ebasüstemaatiliselt:

- Trükimudeli treeningkomplektis (LOSS `data/lehekyljed`, 1 500 lehte) on
  lühendusmärk 290 lehel: õ 316, ẽ 278, ã 237, ũ 102, ñ 50, q̃ 30 — **makronit 1**.
  Lisaks prügi: kombineeriv tilde rea alguses, kreeka `υ̃`, privaatala märk U+E8BF.
- Kurrendi GT-s on sama asi segamini (`Camm̃erherr` Senatsprotokolle, `Cam̃erh.` Dresdner).
- Tildega ei saa korrektselt kirjutada `m`/`n`/`q` lühendeid (precomposed märki ei
  ole; `ñ` on hispaania täht, mitte `nn`/`nd`). Kasutajad ei oska märke sisestada —
  neid on suunatud Wikipedia makroni-lehele, redaktori erimärkide paneelis
  (`public/special_characters.json`) makroneid ei ole.
- `õ` on eesti täht. Treeningkomplektis on kõik 316 `õ`-d lühendid (ladina `nõ`,
  `cõmuni`, prantsuse `dõner`); eesti `õ` tuli kirjakeelde alles 1816 (Masing), seega
  XVII–XVIII saj tekstides seda ei ole. Risk on XIX saj eestikeelsetes teostes.

## Otsus

1. **Lühendusmärk on makron (U+0304)**, sõltumata tähest. Precomposed, kus olemas
   (`ā ē ī ō ū ȳ` ja suurtähed), muidu kombineeriv (`m̄ n̄ q̄ p̄`). Tekst on NFC.
2. **Teisendus tilde → makron** käib ühe funktsiooni kaudu (üks kaart, üks koht),
   mida kasutavad kõik teed: treeningandmed, OCR-i järeltöötlus, korpuse migratsioon.
3. **Keelevalvur:** tilde on päris täht eesti (`õ`), hispaania (`ñ`) ja portugali
   (`ã`, `õ`) keeles. Lehte, mille teose `languages` sisaldab `est`, `spa` või `por`,
   EI teisendata automaatselt — tildega sõnad lähevad aruandesse käsitsi
   otsustamiseks. Muudes lehtedes on tilde lühend.
4. **Sisestus:** redaktoris on makroni nupp ja kiirklahv, mis lisavad kursori ees
   olevale tähele U+0304 (töötab iga tähega, tulemus NFC). Nupp on kasutaja oma
   märgikomplektist SÕLTUMATU — olemasolevatesse kohandatud komplektidesse uus märk
   ise ei jõua.
5. Reegel kehtib **mõlemale mudelile** (trükk ja Kurrent) ja VUTT-i korpusele.

Järjekord: (a) sisestus, (b) OCR-väljundi järeltöötlus kuni uue mudelini,
(c) treeningandmed LOSSis + prügi parandus, (d) korpuse migratsioon tootmises
(kuivkäivitus + `est`-aruanne enne kirjutamist).

## Tagajärjed

- Korpuse migratsioon on andmemuudatus: üks git-commit teose kohta, autor
  „Automaatne", Meili sünk koondatult (ADR 0013). Muutuseta leht jääb puutumata
  (ADR 0012).
- Vana mudeli väljund (tilde) vs uus GT (makron): mudelite võrdluses normaliseeri
  tilde ja makron samaks, muidu on CER-i erinevus kunstlik.
- Kuni uue trükimudelini teeb tilde OCR-mudel; järeltöötlus (b) hoiab uue sisu
  ühtsena. Ilma selleta tekiks korpusesse kaks kuju.
- Otsing: kontrolli teostuses, kas Meili normaliseerib `ū` ja `ũ` samamoodi
  (`lehekylje_tekst`); lühendeid ei laiendata ka praegu.
- Märk muutub tähenduses ühemõtteliseks: makron = lühend, tilde = päris täht
  (ainult valvuriga keeltes). `languages` loetleb sisuliselt esinevad keeled
  (ADR 0019), seega ühe eestikeelse lehega teos läheb tervikuna aruandesse —
  see on teadlikult ettevaatlik.

## Teostus (2026-10-06)

Kõik viis sammu tootmises: sisestus (PR #534, #536, #537), teisendusfunktsioon
`server/macron.py` (PR #534), OCR-väljundi järeltöötlus (PR #539), treeningandmed
ja trükimudel 20261006 (LOSS), korpuse migratsioon (PR #557,
`scripts/migrate_macron_corpus.py`): 1040 teost, 6467 lehte, üks commit teose kohta.
Meili ignoreerib tildet ja makronit ühtmoodi — otsing ei muutunud (kontrollitud).
Jääk: 0cxkz3 (OCR-kordusloop, uus OCR) ja neli eesti keelega teost käsitsi (#558).
