# Kasutajahalduse laiendamise plaan

**Staatus: LÕPETATUD** ✅

*Viimati uuendatud: 2026-01-19*

## Ülevaade

Eesmärk: võimaldada laiemat kasutajate ringi, säilitades kvaliteedikontrolli akadeemiliste tekstide toimetamisel.

**Tulemus:** Kaheastmeline rollisüsteem (editor → admin) koos registreerimissüsteemiga on implementeeritud.

> **Märkus:** Algselt planeeritud kolmeastmeline süsteem (contributor → editor → admin) koos pending-muudatuste ülevaatusega osutus praktikas üleliigseks. Kood toetab endiselt contributor rolli, kuid seda ei kasutata – uued kasutajad saavad editor rolli.

## 1. Rollisüsteem ✅

### Praegune süsteem
| Roll | Koodis | Õigused |
|------|--------|---------|
| toimetaja | `editor` | Teksti muutmine, annotatsioonid, staatuse muutmine |
| admin | `admin` | Kõik + kasutajahaldus + taotluste kinnitamine + versioonide taastamine |

### Implementatsioon
- `server/auth.py`: `require_token(data, min_role)` kontrollib rollide hierarhiat
- `server/registration.py`: Uued kasutajad saavad `editor` rolli
- `src/contexts/UserContext.tsx`: Rollide käsitlus frontendis
- `src/locales/*/common.json`: Rollide tõlked UI-s

---

## 2. Registreerimissüsteem ✅

### 2.1 Taotluse esitamine

**Leht:** `/register` → `src/pages/Register.tsx`

Väljad:
- Nimi (kohustuslik)
- Email (kohustuslik)
- Asutus/kuuluvus (valikuline)
- Motivatsioon (kohustuslik)

**Backend:** `POST /register` → `server/registration.py`
**Salvestuskoht:** `state/pending_registrations.json`

### 2.2 Taotluste ülevaatus

**Leht:** `/admin` → `src/pages/Admin.tsx`

Admin näeb:
- Ootel taotluste nimekiri koos detailidega
- "Kinnita" / "Lükka tagasi" nupud

Kinnitamisel:
1. Genereeritakse UUID token (kehtib 48h)
2. Token salvestatakse `state/invite_tokens.json`
3. Genereeritakse link, mille admin saadab kasutajale

### 2.3 Parooli seadmine

**Leht:** `/set-password?token=UUID` → `src/pages/SetPassword.tsx`

Voog:
1. Token valideerimine (`GET /invite/{token}`)
2. Parooli sisestamine + kinnitus
3. Kasutaja loomine (`POST /invite/{token}/set-password`)
4. Token märgitakse kasutatuks
5. Suunamine sisselogimislehele

---

## 3. Pending-muudatuste süsteem (EI KASUTATA)

> **Märkus:** See funktsioon on koodis olemas, kuid praktikas ei kasutata. Kõik registreeritud kasutajad saavad editor rolli ja nende muudatused rakenduvad kohe.

Algselt planeeritud süsteem:
- Contributor salvestab → pending-edit
- Editor/admin kinnitab → rakendub

Kood asub: `server/pending_edits.py`, `src/pages/Review.tsx`

---

## 4. Implementeeritud komponendid ja lehed ✅

### Lehed
| Leht | Fail | Ligipääs |
|------|------|----------|
| `/register` | `src/pages/Register.tsx` | Avalik |
| `/set-password` | `src/pages/SetPassword.tsx` | Avalik (tokeniga) |
| `/admin` | `src/pages/Admin.tsx` | Admin |
| `/review` | `src/pages/Review.tsx` | Editor+ (viimased muudatused) |

### Backend moodulid
| Moodul | Kirjeldus |
|--------|-----------|
| `server/auth.py` | Autentimine, sessioonid, rollide kontroll |
| `server/registration.py` | Registreerimistaotlused, invite tokenid |
| `server/git_ops.py` | Git versioonihaldus |
| `server/config.py` | Seadistused (teed, pordid, CORS, rate limits) |
| `server/rate_limit.py` | Rate limiting brute-force kaitseks |
| `server/pending_edits.py` | *(ei kasutata)* |

### Andmefailid (`state/` kaustas)
- `users.json` - Kasutajad
- `pending_registrations.json` - Ootel taotlused
- `invite_tokens.json` - Aktiivsed kutsed (kehtivad 48h)

---

## 5. SMTP (tulevikus)

Praegu admin saadab invite-lingi kasutajale käsitsi e-postiga.

Tulevikus võimalik automatiseerida:
- SMTP konfiguratsioon `.env` failis
- Email-saatmise moodul Pythonis

---

## 6. Turvalisus ✅

Implementeeritud turvameetmed:
- **Invite tokenid aeguvad** (48h)
- **Kasutatud tokenid** märgitakse ja ei tööta uuesti
- **Admin-endpointid** nõuavad admin-rolli
- **Rate-limiting** registreerimisel ja sisselogimisel (vt `server/config.py`)
- **CORS piiratud** lubatud domeenidega

---

## 7. Kokkuvõte

**Plaan lõpetatud: 2026-01-19**

Implementeeritud:
- ✅ Kaheastmeline rollisüsteem (editor → admin)
- ✅ Avalik registreerimisvõimalus koos admin-kinnitusega
- ✅ Git versioonihaldus koos autorsusega
- ✅ Rate limiting ja turvameetmed

Planeeritud, kuid praktikas ei kasutata:
- Pending-muudatuste süsteem (kood olemas, contributor rolli ei anta)

**Jäänud tulevikuks:**
- SMTP automatiseerimine (praegu manuaalne)
