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
| [0011](0011-i18n-keelepakid-laisalt-ilma-fallbackita.md) | i18n laeb ühe keele korraga; `fallbackLng` väljas + pariteeditest | kehtib |
| [0012](0012-muutusteta-salvestus-on-no-op.md) | Muutusteta salvestus ei kirjuta, ei commiti ega indekseeri | kehtib |
