# Arhitektuuriotsuste logi (ADR)

Lühikesed kirjed otsustest, mille rikkumine on varem põhjustanud (või
põhjustaks) rikkeid, ja mille põhjendus ei ole koodist ilmne. Eesmärk:
projekti teadmus ei tohi elada ainult ühe inimese (või ühe tööriista mälu)
peas — vt issue #137, bus-factor = 1.

## Formaat

Üks fail otsuse kohta: `NNNN-luhike-slug.md`. Kolm osa:

- **Kontekst** — mis olukord/probleem otsuse tingis
- **Otsus** — mida otsustati (ja mida teadlikult EI tehtud)
- **Tagajärjed** — mida see tähendab edaspidistele muudatustele; mida EI TOHI teha

Uus otsus → uus fail, järgmine number. Otsuse muutumisel ära kustuta vana:
lisa uus kirje, mis viitab vanale („asendab 000X").

## Register

| # | Otsus | Staatus |
|---|-------|---------|
| [0001](0001-andmed-failisusteemis-git.md) | Andmed failisüsteemis + git, mitte andmebaasis | kehtib |
| [0002](0002-async-endpointid-ei-blokeeri.md) | `async def` endpoint ei tohi kutsuda blokeerivat I/O-d | kehtib |
| [0003](0003-marginaalia-normaliseerimine-salvestamisel.md) | Marginaalia normaliseerimine ainult salvestamisel | kehtib |
| [0004](0004-auth-aegumine-loginmodal-invariant.md) | Auth-aegumise käsitlus: LoginModal ja init-gate invariandid | kehtib |
| [0005](0005-meilisearch-prefixsearch-keepwarm.md) | Meilisearch: prefixSearch jääb sisse, cold-start lahendab keep-warm | kehtib |
| [0006](0006-meili-legacy-valjanimed-uhine-meili-doc.md) | Meili eestikeelsed legacy-väljanimed + ühine `meili_doc.py` | kehtib |
| [0007](0007-tuletatud-indeksid-read-modelid.md) | Tuletatud indeksid on nullist taastatavad read-modelid | kehtib |
| [0008](0008-markdown-allowlist-xss.md) | Vabateksti markdown: allow-list, mitte kunagi toores HTML | kehtib |
| [0009](0009-marginaalia-iga-fuusiline-rida-eraldi.md) | Iga füüsiline marginaaliarida on eraldi `<m>` plokk | kehtib |
| [0010](0010-lehe-vahetus-ei-monteeri-editorit-maha.md) | Lehe vahetus ei monteeri editorit maha; sisuvahetus on märgistatud | kehtib |
| [0011](0011-i18n-keelepakid-laisalt-ilma-fallbackita.md) | i18n laeb ühe keele korraga; `fallbackLng` väljas + kaks tõlkevalvurit | kehtib |
| [0012](0012-muutusteta-salvestus-on-no-op.md) | Muutusteta salvestus ei kirjuta, ei commiti ega indekseeri | kehtib |
| [0013](0013-meili-sunk-koondatakse-teose-kaupa.md) | Meili sünk koondatakse teose kaupa; dirty-lipp elab vea üle | kehtib |
| [0014](0014-inline-sildid-vs-labels-register.md) | Inline sildid on kuvatav tõde; register täidab augud, ei kirjuta ajaloolisi kohanimesid üle | kehtib |
| [0015](0015-reocr-hulgi-vastuvott.md) | Batch re-OCR tulemused võetakse vastu hulgi, ühe git-commiti ja ühe Meili sünkina | kehtib |
| [0016](0016-rikastuse-allikatel-on-varuteed.md) | Igal välisel rikastusallikal on varutee ja lühike timeout | kehtib |
| [0017](0017-poolitamine-enne-ocr.md) | Topeltlehtede poolitamine enne OCR-i: VUTT rasteriseerib ise, prepress on opt-in | kehtib |
| [0018](0018-reocr-katkestamine.md) | Re-OCR töö katkestamine | kehtib |
| [0019](0019-keelemargend-grc-sisaldab-osa.md) | Keelemärgend tähendab „sisaldab olulist osa selles keeles", mitte „on selles keeles" | kehtib |
