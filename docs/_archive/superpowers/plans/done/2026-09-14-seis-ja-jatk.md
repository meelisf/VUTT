# #318 seis 2026-09-14 õhtul — kust homme jätkata

## Tootmises

Kogu etapp 1 ja 2 on juurutatud ja kontrollitud. Server `078693c7`.

| Etapp | Sisu | PR |
|---|---|---|
| 1a | kasutajate lukk, kustutatud nimede register, õiguste delta-endpoint, `PUT access` valvurid | #361 |
| 1b | töökollektsiooni ligipääsupaneel, „Lähtesta valik" Dashboardil | #362 |
| 2A | `PUT /admin/collections/{id}` ei kirjuta enam `allowed_users`; kollektsioonipaneel kahe teljega | #363 |
| — | õiguste paneelide ühine kasutajaotsing, `canManageUser` duplikaat maha | #364 |
| 2B | `/admin/collections` on admin+, seaded superadminile | #365 |

ADR 0043 staatus: „teostus pooleli — 1a, 1b ja 2 tootmises, 3–4 lahtised".

## Lahtine töö

**Etapp 3 — suurim allesjäänud tükk. Plaani EI OLE veel.** Spekk §1.
- `/admin/users` kompaktne otsitav nimekiri: `q`, `role`, `rights_collection`,
  `rights_work_set` URL-is. Admin-filtrid EI kutsu `useCollectionUrlSync`-i
  ega muuda aktiivset kogu (ADR 0038).
- `/admin/users/:username` detail: konto toimingud + kolm õiguste plokki
  (lugemisõigus, kirjutamisulatus, töökollektsioonid).
- `/admin/users/activity` — viimane muudatus git-logist, TTL 300,
  blokeeriv töö threadpoolis. Autor seotakse ainult TÄPSE kasutajanime alusel.
- `Users.tsx` töökollektsioonide osa läheb siis koondsalvestusele (praegu
  salvestab iga rippmenüü valiku peale eraldi päringu).

**Etapp 4** — ühine „Kogud" sisenemiskoht, tüübifilter, vanade URL-ide
suunamine. Spekk §4.

## Kaks lahtist pisiasja

1. **„Rollist tulenev" silt on ähmane.** Kirjas
   [#318 kommentaaris](https://github.com/meelisf/VUTT/issues/318#issuecomment-5665476304).
   Peitmine peab eristama `basis === 'role_based' && !rida.edit` — sildi
   üldine peitmine kaotaks inertse jäänuki koristustee, mida ADR 0043 nõuab.
2. **Sessiooni aegumine paistab andmekaona.** Deploy taaskäivitab konteineri
   ja sessioonid elavad mälus, seega iga backend-juurutus logib kõik välja.
   Väljalogitud kasutaja näeb praegu „Ligipääsu laadimine ebaõnnestus"
   (401 paneelis) ja „Töökollektsioone ei ole" (anonüümne `GET /work-sets`
   tagastab ainult avalikud). `apiClient`-is on `sessionExpiredHandler` just
   selleks — mõlemad vaated peaksid 401-i muust veast eristama. Väike eraldi
   PR, ei kuulu ühessegi etappi.

## Homme kohe alustamiseks

Etapp 3 vajab kõigepealt plaani. Enne plaani kirjutamist tasub vaadata:
`src/pages/admin/Users.tsx` (722 rida, kannab praegu nii loendit kui detaili),
`server/routers/admin.py` kasutaja-endpointid ja spekk §1.

Etapp 3 on suur — kaalu jagamist nagu etapp 2: server + loend eraldi PR-is,
detailvaade teises.

## Väline agent

Tegi etapid 2A ja 2B (PR #363, #365) töökäsu alusel ja mõlemad olid
talutavad: plaani järgiti täpselt, raportid olid ausad (sh enda viga main'ile
committimisega), ja kõik koristusleiud olid PLAANI, mitte teostuse vead.
Töökäsu mudel: `2026-09-14-tookask-etapp-2{a,b}.md`. Ülevaatamisel jooksuta
väravad ise ja loe diff — mitte raporti sõna pealt.
