# 0023: vutt_mcp tohib hoida lokaalset olekut, kui see on valikuline

Kuupäev: 2026-08-19
Seis: kinnitatud

## Kontekst

`vutt_mcp` on seni olnud õhuke klient VUTT-i avaliku HTTPS-API otsas: oma
andmeid ei hoia, oma olekut ei oma (`mcp/README.md`). Sekundaarkirjanduse kogu
(spekk `2026-08-19-kirjanduse-kogu-mcp-design.md`) nõuab lokaalset SQLite
indeksit, mis seda invarianti rikub.

## Otsus

`vutt_mcp` tohib hoida lokaalset olekut järgmistel tingimustel:

1. Olek elab **eraldi alampaketis** (`vutt_mcp/library/`), mitte olemasolevate
   moodulite sees.
2. Tööriistad **registreeritakse ainult siis, kui andmefail on olemas**.
   Ilma failita ei eksisteeri neid ega vihjet nende olemasolule.
3. MCP-pool jääb **read-only**; kirjutamine käib eraldi konsoolikäsuga.
4. Lokaalne olek on **tuletatud read-model** — nullist taastatav (vrd ADR 0007).

## Tagajärjed

- `vutt-mcp` jääb avalikult jagatavaks: teisel paigaldajal ei teki
  kirjanduskogu tööriistu.
- MCP-server avab indeksi **ühenduse tööriistakutse kohta**, sest indeksi
  ümberehitus kasutab `rename`-i ja pikaajaline deskriptor hoiaks vana inode'i.
- Uus lokaalse olekuga moodul nõuab uut ADR-i — see otsus ei ole blankett.
