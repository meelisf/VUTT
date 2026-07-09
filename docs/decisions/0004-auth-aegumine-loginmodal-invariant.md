# 0004 — Auth-aegumise käsitlus: LoginModal ja init-gate invariandid

**Staatus:** kehtib (PR #124/#125, 2026-07-02)

## Kontekst

Sessioonitoken aegub 24h pärast. Kaks korduvalt katki läinud kohta:
(1) aegunud sessiooniga kasutaja pidi saama uuesti sisse logida ilma tööd
kaotamata; (2) värskes tabis jooksis Workspace'i andmelaadimine võidu
auth-initsialiseerimisega ja päring läks välja vale/puuduva tokeniga.

## Otsus

Kaks invarianti:

1. **LoginModali `isOpen` EI TOHI olla seotud `sessionExpired` olekuga.**
   Modaal peab olema monteeritud ka varajase veatagastuse harus — muidu
   tekib olek, kus sessioon on aegunud, aga modaal ei saa kunagi avaneda.
2. **`Workspace.tsx` andmelaadimise useEffect PEAB gate'ima
   `if (authInitializing) return;`** (ja `authInitializing` peab olema
   deps-listis) — enne kui auth-kontekst on initsialiseeritud, ei tohi
   ühtegi autenditud päringut teha.

Lisaks: `localStorage.vutt_token` on tõeallikas (mitte React-olek), et
mitu tabi näeksid sama sessiooni.

## Tagajärjed

- Uus leht/komponent, mis teeb autenditud päringuid mount'imisel, PEAB
  sama init-gate'i lisama.
- LoginModali monteerimisloogikat refaktoreerides kontrolli mõlemat haru
  (õnnestunud laadimine JA varajane veatagastus).
- Review-lehe välislinkidena avatavad OCR-lingid on `<Link>`, mitte
  `target="_blank"` — uus tab tähendaks uut auth-init võidujooksu.
