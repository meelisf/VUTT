# Kasutajahalduse laiendamise plaan

## Ülevaade

Eesmärk: võimaldada kodanikuteaduse raames laiemat kasutajate ringi, säilitades kvaliteedikontrolli akadeemiliste tekstide toimetamisel.

## 1. Rollisüsteemi muudatused

### Praegune süsteem
| Roll | Tase | Õigused |
|------|------|---------|
| viewer | 0 | Ainult vaatamine |
| editor | 1 | Muutmine, salvestamine |
| admin | 2 | Kõik + kasutajahaldus |

### Uus süsteem
| Roll | Tase | Õigused |
|------|------|---------|
| kaastööline | 0 | Muutmine → pending-muudatused (vajavad ülevaatust) |
| toimetaja | 1 | Muutmine (kohe rakendub), pending-muudatuste kinnitamine |
| admin | 2 | Kõik + kasutajahaldus + taotluste kinnitamine |

### Migratsiooni sammud
1. Uuenda `users.json` struktuur (`role`: `contributor` | `editor` | `admin`)
2. Uuenda `UserContext.tsx` rollide käsitlus
3. Uuenda `file_server.py` õiguste kontroll
4. Lisa i18n tõlked rollide kuvamiseks UI-s

---

## 2. Registreerimissüsteem

### 2.1 Taotluse esitamine (avalik)

**Uus komponent:** `RegistrationForm.tsx`
**Uus leht:** `/register`

Väljad:
- Nimi (kohustuslik)
- Email (kohustuslik)
- Asutus/kuuluvus (valikuline)
- Motivatsioon / miks soovid liituda (textarea, kohustuslik)

**Salvestuskoht:** `pending_registrations.json`

```json
{
  "registrations": [
    {
      "id": "uuid-1234",
      "name": "Mari Maasikas",
      "email": "mari@example.com",
      "affiliation": "Tartu Ülikool",
      "motivation": "Olen huvitatud vanade tekstide...",
      "submitted_at": "2025-01-16T14:30:00Z",
      "status": "pending",
      "reviewed_by": null,
      "reviewed_at": null
    }
  ]
}
```

### 2.2 Taotluste ülevaatus (admin)

**Uus leht:** `/admin`

Admin näeb:
- Ootel taotluste nimekiri
- Iga taotluse detailid
- Nupud: "Kinnita" / "Lükka tagasi"

Kinnitamisel:
1. Genereeritakse unikaalne UUID token
2. Token salvestatakse `invite_tokens.json` koos aegumisajaga (48h)
3. Genereeritakse link: `https://vutt.utlib.ut.ee/set-password?token=UUID`
4. **Esialgu:** Link kuvatakse adminile, kes saadab selle käsitsi emailiga
5. **Tulevikus:** SMTP integratsioon saadab automaatselt

```json
// invite_tokens.json
{
  "tokens": [
    {
      "token": "uuid-5678",
      "email": "mari@example.com",
      "name": "Mari Maasikas",
      "created_at": "2025-01-16T15:00:00Z",
      "expires_at": "2025-01-18T15:00:00Z",
      "used": false
    }
  ]
}
```

### 2.3 Parooli seadmine (uus kasutaja)

**Uus leht:** `/set-password`

Voog:
1. Kasutaja avab lingi tokeniga
2. Süsteem kontrollib tokeni kehtivust
3. Kasutaja sisestab parooli (+ kinnitus)
4. Parool hashitakse (SHA-256) ja salvestatakse `users.json`
5. Token märgitakse kasutatuks
6. Kasutaja suunatakse sisselogimislehele

---

## 3. Pending-muudatuste süsteem

### 3.1 Muudatuse salvestamine (kaastööline)

Kui `kaastööline` salvestab teksti:
1. Muudatus EI lähe otse `page.txt` faili
2. Muudatus salvestatakse `pending_edits.json` (või eraldi failidesse)

```json
{
  "pending_edits": [
    {
      "id": "edit-uuid-1",
      "page_id": "teose_id/lehekylje_number",
      "teose_id": "1632_Disputatio_1",
      "lehekylje_number": 3,
      "user": "mari",
      "role_at_submission": "contributor",
      "submitted_at": "2025-01-16T16:00:00Z",
      "original_text": "vana tekst...",
      "new_text": "uus tekst...",
      "base_text_hash": "sha256-hash-of-original-text",
      "status": "pending",
      "has_conflict": false,
      "conflict_type": null,
      "reviewed_by": null,
      "reviewed_at": null,
      "review_comment": null
    }
  ]
}
```

### 3.2 Ülevaatuse töövoog

**Uus leht:** `/review`

Toimetaja/admin näeb:
- Ootel muudatuste nimekiri (sorteeritav kuupäeva, kasutaja, teose järgi)
- Muudatuse detailvaade:
  - Diff-vaade (vana vs uus)
  - Pildiga kõrvutamine (nagu Workspace)
  - Kasutaja info ja motivatsioon
- Nupud: "Kinnita" / "Lükka tagasi" / "Kinnita kommentaariga"

Kinnitamisel:
1. `new_text` kirjutatakse `page.txt` faili
2. Tehakse Git commit:
   - `--author="Kaastööline <email>"` (kes muudatuse tegi)
   - Committer = kinnitaja (automaatselt git config järgi)
3. Uuendatakse Meilisearch
4. Pending-edit märgitakse kinnitatuks

Tagasilükkamisel:
1. Pending-edit märgitakse tagasilükatuks
2. Salvestatakse kommentaar (miks lükati tagasi)
3. (Tulevikus: teavitus kasutajale)

### 3.3 Kaastöölise vaade oma muudatustele

Workspace'is peaks kaastööline nägema:
- Kui lehel on tema ootel muudatus: teade "Sul on selle lehe kohta muudatus ülevaatusel"
- Kusagil (profiilis? eraldi lehel?) oma muudatuste ajalugu ja staatus

### 3.4 Konfliktide lahendamine

**Põhimõte:** Hoiatused + kasutaja otsustab + ülevaataja lahendab

#### Stsenaarium 1: Sama kasutaja mitu muudatust
- Kui kaastööline salvestab uue muudatuse samale lehele, kus tal juba on pending-muudatus
- **Lahendus:** Uus muudatus kirjutab vana üle (sama kasutaja puhul)

#### Stsenaarium 2: Eri kasutajate muudatused samale lehele
- Mari salvestab pending-muudatuse 14:00
- Jüri üritab salvestada 14:30 (ei tea Mari omast)
- **Lahendus (C):** Hoiatus "Sellel lehel on juba ootel muudatus teiselt kasutajalt. Kas soovid siiski salvestada?"
- Kui Jüri jätkab, tekib kaks pending-muudatust
- Ülevaataja näeb mõlemat ja lahendab konflikti (valib ühe, ühendab, või lükkab tagasi)

#### Stsenaarium 3: Originaaltekst on muutunud
- Mari salvestab pending-muudatuse 14:00 (põhineb tekstil X)
- Toimetaja teeb otsemuudatuse 14:30 (tekst on nüüd Y)
- Mari pending-muudatus põhineb vananenud tekstil
- **Lahendus (D):** Pending-muudatuse juurde salvestatakse `base_text_hash`
- Ülevaatamisel kontrollitakse, kas praegune tekst ühtib `base_text_hash`-iga
- Kui ei ühti → hoiatus ülevaatajale "Tekst on vahepeal muutunud, kontrolli hoolikalt"

#### Implementatsioon

Pending-edit struktuuri lisandub:
```json
{
  "base_text_hash": "sha256-of-original-text",
  "has_conflict": false,
  "conflict_type": null
}
```

Konfliktitüübid:
- `other_pending` - teine kasutaja on samale lehele muudatuse teinud
- `base_changed` - originaaltekst on vahepeal muutunud
- `both` - mõlemad

---

## 4. Uued API endpointid (file_server.py)

### Registreerimine
- `POST /register` - taotluse esitamine (avalik)
- `GET /admin/registrations` - taotluste nimekiri (admin)
- `POST /admin/registrations/{id}/approve` - kinnitamine (admin)
- `POST /admin/registrations/{id}/reject` - tagasilükkamine (admin)

### Parooli seadmine
- `GET /invite/{token}` - tokeni kehtivuse kontroll (avalik)
- `POST /invite/{token}/set-password` - parooli seadmine (avalik)

### Pending-muudatused
- `POST /save-pending` - kaastöölise muudatuse salvestamine
- `GET /pending-edits` - ootel muudatuste nimekiri (toimetaja+)
- `GET /pending-edits/{id}` - muudatuse detailid (toimetaja+)
- `POST /pending-edits/{id}/approve` - kinnitamine (toimetaja+)
- `POST /pending-edits/{id}/reject` - tagasilükkamine (toimetaja+)

### Kasutajahaldus
- `GET /admin/users` - kasutajate nimekiri (admin)
- `POST /admin/users/{username}/role` - rolli muutmine (admin)

---

## 5. Uued komponendid ja lehed

### Lehed
| Leht | Fail | Ligipääs |
|------|------|----------|
| `/register` | `pages/Register.tsx` | Avalik |
| `/set-password` | `pages/SetPassword.tsx` | Avalik (tokeniga) |
| `/admin` | `pages/Admin.tsx` | Admin |
| `/review` | `pages/Review.tsx` | Toimetaja+ |

### Komponendid
- `RegistrationForm.tsx` - taotlusvorm
- `SetPasswordForm.tsx` - parooli seadmise vorm
- `PendingRegistrationsList.tsx` - taotluste tabel
- `PendingEditsList.tsx` - muudatuste tabel
- `EditDiffView.tsx` - muudatuse diff-vaade
- `UserManagement.tsx` - kasutajate haldus

---

## 6. SMTP-valmidus

### Esimene faas (manuaalne)
- Admin näeb genereeritud linki
- Admin kopeerib ja saadab emailiga käsitsi

### Teine faas (automaatne)
Konfiguratsioon `config.ts` või `.env`:
```
SMTP_ENABLED=true
SMTP_HOST=mail.ut.ee
SMTP_PORT=587
SMTP_USER=vutt@ut.ee
SMTP_FROM=VUTT <vutt@ut.ee>
```

Email-mallid:
- `invite.txt` - kutse link
- `edit_approved.txt` - muudatus kinnitatud
- `edit_rejected.txt` - muudatus tagasi lükatud

**NB:** Email-saatmine peaks toimuma backend'is (Python), mitte frontendis.

---

## 7. Andmefailid

Uued failid (sama kaustas kui `users.json`):
- `pending_registrations.json` - ootel taotlused
- `invite_tokens.json` - aktiivsed kutsed
- `pending_edits.json` - ootel muudatused

Alternatiiv pending-edits jaoks: eraldi failid iga muudatuse kohta `pending/` kaustas.

---

## 8. Implementeerimise järjekord

### Faas 1: Rollisüsteem
1. [ ] Uuenda rollid koodis (contributor/editor/admin)
2. [ ] Uuenda `file_server.py` õiguste kontroll
3. [ ] Uuenda UI rollide kuvamine
4. [ ] Testi olemasolevate kasutajatega

### Faas 2: Registreerimine
1. [ ] Loo `pending_registrations.json` struktuur
2. [ ] Loo `/register` leht ja vorm
3. [ ] Loo `POST /register` endpoint
4. [ ] Loo `/admin` leht taotluste vaatamiseks
5. [ ] Loo kinnitamise/tagasilükkamise endpointid
6. [ ] Loo `invite_tokens.json` struktuur
7. [ ] Loo `/set-password` leht
8. [ ] Testi kogu registreerimisvoog

### Faas 3: Pending-muudatused
1. [ ] Loo `pending_edits.json` struktuur
2. [ ] Muuda salvestamisloogika (contributor → pending)
3. [ ] Loo `/review` leht
4. [ ] Loo diff-vaate komponent
5. [ ] Loo kinnitamise loogika (fail + git + meilisearch)
6. [ ] Lisa Workspace'i pending-staatuse näitamine
7. [ ] Testi kogu muudatuste voog

### Faas 4: SMTP (tulevikus)
1. [ ] Lisa SMTP konfiguratsioon
2. [ ] Loo email-saatmise moodul Pythonis
3. [ ] Loo email-mallid
4. [ ] Integreeri kinnitamisvoogu

---

## 9. Otsustatud küsimused

1. **Rollide nimetused koodis:** ✅ Inglise keeles (`contributor`/`editor`/`admin`), UI-s tõlgitud

2. **Mitu pending-muudatust tohib ühel lehel olla?**
   - ✅ Sama kasutaja: üks (uus kirjutab vana üle)
   - ✅ Eri kasutajad: mitu lubatud, hoiatusega + ülevaataja lahendab konflikti

3. **Kas kaastööline näeb teiste kaastööliste pending-muudatusi?**
   - ✅ Ei näe, aga saab hoiatuse salvestamisel kui teine on juba muudatuse teinud

4. **Git commit'i autorsus pending-muudatuse kinnitamisel:**
   - ✅ Autor = kaastööline, Committer = kinnitaja

---

## 10. Turvalisus

- Invite tokenid aeguvad (48h)
- Kasutatud tokenid märgitakse ja ei tööta uuesti
- Pending-edits on seotud kasutaja ja esitamishetke rolliga
- Admin-endpointid nõuavad admin-rolli
- Review-endpointid nõuavad vähemalt toimetaja-rolli
- Rate-limiting registreerimisel (vältida spämmi)

---

*Plaan koostatud: 2025-01-16*
*Viimati uuendatud: 2025-01-16*
*Otsused kinnitatud: rollid, konfliktid, git autorsus*
