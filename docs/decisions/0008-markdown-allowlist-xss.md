# 0008 — Vabateksti markdown: allow-list, mitte kunagi toores HTML

**Staatus:** kehtib (PR #75, 2026-06-29)

## Kontekst

Vabateksti väljad (prosopograafia Märkmed/Elulugu, lehekülje kommentaarid)
vajavad vormindust. Kasutajasisend renderdatakse teistele kasutajatele —
XSS-pind.

## Otsus

- Renderdus AINULT läbi `MarkdownView.tsx`: `react-markdown` + `remark-gfm`,
  **allow-list** (`allowedElements` + `unwrapDisallowed`). Lubatud DOM:
  `p, strong, em, del, a, ul, ol, li, h1-h3, blockquote, code, br`.
- **EI kasutata `rehype-raw`-i** — toores HTML jääb escape'ituks. See on
  disainiotsus, mitte puuduv feature.
- Lingid: `_blank`/`noopener`; `urlTransform` lubab ainult kindlaid
  protokolle (`javascript:` blokeeritud).
- Transkriptsiooni XML-märgistus (`VuttMarkupExtension`) on ERALDI süsteem
  oma renderdajaga — need kaks ei tohi seguneda.

## Tagajärjed

- Uus vabateksti väli → kasuta `MarkdownEditor` + `MarkdownView` paari;
  ÄRA lisa `dangerouslySetInnerHTML`-i (guard-test olemas, issue #62).
- Kui kasutaja soovib tabeleid/muud GFM-i struktuuri: teadlik laiendus
  allow-listi kaudu, mitte `rehype-raw`.
- GFM on sees AINULT autolinkimiseks — tabelid/footnote'd ei renderdu
  struktuurina (tekst säilib `unwrapDisallowed` kaudu).
