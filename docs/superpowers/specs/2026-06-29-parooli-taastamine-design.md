# Parooli taastamine (admini-algatatud) — disain

**Kuupäev:** 2026-06-29
**Staatus:** disain kinnitatud, ootab implementatsiooniplaani

## Probleem

Praegu pole parooli taastamist. Kui kasutaja kaotab parooli ära, peab ta uuesti
registreeruma. Admin peaks saama genereerida olemasolevale kasutajale parooli
taastamise lingi, kopeerida selle ja saata kasutajale käsitsi.

## Ulatus

- **Ainult admin algatab.** Lõpp-kasutaja iseteenindust ("unustasin parooli") esialgu
  EI tee (kuna automaatset e-kirja pole — see tekitaks adminile nähtamatu järjekorra).
- **Kohaletoimetamine käsitsi:** admin kopeerib lingi ja saadab ise (nt e-postiga),
  sama muster nagu praegune invite-voog.
- **SMTP-valmidus:** token-genereerimine hoitakse lahus kohaletoimetamisest, et hiljem
  saaks lisada automaatse e-kirja kihi (ka registreerimistele) ilma core-loogikat muutmata.

## Valitud lähenemine

**Eraldi reset-token + olemasoleva `SetPassword` lehe taaskasutus.** Peegeldab juba
toimivat ja testitud invite-mustrit (`registration.py`), kuid hoiab kaks semantiliselt
erinevat voogu lahus:
- **Invite** = loo UUS kasutaja (kasutajanime arvutus, kasutaja loomine).
- **Reset** = muuda OLEMASOLEVAT kasutajat (leia kasutaja, vaheta parool, invalideeri
  sessioonid).

Tagasi lükatud:
- **B (laienda `invite_tokens.json` `type` väljaga):** segaks kaks voogu ühte funktsiooni,
  invite- ja reset-loogika põimuksid — riskantsem, raskem testida.
- **C (admin seab parooli otse):** admin näeks parooli (halb tava), kasutaja ei vali ise,
  ei sobi "saadan lingi" mudeliga.

## Komponendid

### 1. Backend — token-moodul (`server/password_reset.py`)

Uus moodul `registration.py` mustri järgi. Tokenid `state/reset_tokens.json` (runtime,
EI ole gitis — nagu `invite_tokens.json`). Luuakse esimesel kasutusel automaatselt.

Token-kirje:
```json
{
  "token": "<uuid4>",
  "username": "<olemasolev kasutaja>",
  "created_at": "...",
  "expires_at": "...",
  "created_by": "<admin username>",
  "used": false,
  "used_at": null,
  "revoked": false,
  "revoked_at": null,
  "revocation_reason": null
}
```

**`used` vs `revoked` eristus:** `used` = kasutaja kasutas lingi ära (parool vahetatud);
`revoked` = token tühistati enne kasutust. `revocation_reason` ∈ `"superseded"` (uus link
loodi sama kasutajale), `"role_changed"` (kasutaja edutati), `"user_deleted"`. Nii on
admin-debug'is ja testides selge, KAS link kasutati või tühistati. Valideerimine hülgab
mõlemad, aga eri veateadetega ("Link on juba kasutatud" vs "Link on tühistatud").

Aegumine: `created_at + 24h` (lühem kui invite 48h — turvalisem).

Funktsioonid:
- `create_reset_token(username, created_by)` — kontrollib, et kasutaja on olemas;
  **passiivne puhastus:** eemaldab failist kirjed, mille `expires_at` on rohkem kui 7 päeva
  minevikus (hoiab faili väikese ilma croonita); **tühistab sama kasutaja varasemad
  kasutamata reset-tokenid** (`revoked=True`, `revocation_reason="superseded"` — üks aktiivne
  korraga); loob uue. Olematu kasutaja → viga.
- `validate_reset_token(token)` → `(token_data, error)` — kehtivuse kontroll (olemas,
  mitte kasutatud, mitte tühistatud, mitte aegunud).
- `revoke_user_reset_tokens(username, reason)` — tühistab kasutaja kõik kasutamata tokenid.
  Kutsutakse `create_reset_token`-ist (`"superseded"`) ning **`update_user_role`-ist
  (edutamisel, `"role_changed"`) ja `delete_user`-ist (`"user_deleted"`)** — vt allpool
  "Rolli muutuse / kustutuse race".
- `_validate_and_consume_token(token)` — atomaarne consume (lukuga, `used=True` +
  `used_at`) + `_unconsume_token(token)` rollback (peegeldab invite'i).

**Konkurentsus / faililukud:** moodul kasutab oma `reset_tokens_lock` (`threading.RLock`)
ja `atomic_write_json` (write-to-temp-and-rename) — sama muster nagu `registration.py`.
Server jookseb single-worker uvicorniga, seega threading-lukk on piisav; portalocker'i
(mitme protsessi lukk) pole vaja. `complete_password_reset` puudutab kahte faili kahe
eri lukuga: KÕIGEPEALT consume `reset_tokens.json` (`reset_tokens_lock`), SEEJÄREL
`save_users` (`users_lock`); kui kasutaja salvestus ebaõnnestub → `_unconsume_token`
rollback (nagu invite'is).
- `complete_password_reset(token, new_password)`:
  1. `validate_password_strength(new_password)` (taaskasuta `registration.py`-st).
  2. Atomaarne consume.
  3. Loe vana hash välja (rollbacki jaoks); sea uus bcrypt-hash (`hash_password`)
     olemasolevale kasutajale, `save_users`.
  4. **Invalideeri kasutaja kõik aktiivsed sessioonid** (`delete_user_sessions` —
     sunnib uue parooliga uuesti sisse logima).
  5. Veateed (vt allpool).

**Veatee (sessioonide invalideerimine).** Turvainvariant nõuab, et pärast edukat resetit
poleks vanu sessioone alles. Seetõttu loetakse operatsioon edukaks **ainult kui MÕLEMAD**
— hash-vahetus JA sessioonide invalideerimine — õnnestuvad:
- Kui `save_users` (samm 3) ebaõnnestub → `_unconsume_token` rollback, tagasta viga.
- Kui `delete_user_sessions` (samm 4) ebaõnnestub → **taasta vana hash** (`save_users`
  vana hashiga), `_unconsume_token` rollback, tagasta viga. **Mitte kunagi vaikset
  `success`-i**, kui sessioonid võivad alles olla.
- (`delete_user_sessions` on puhtalt mälusisene lukuga operatsioon — praktikas ei kuku,
  aga invariant peab koodis eksplitsiitne olema, mitte eeldusel.)

**Turvainvariant:** lingi genereerimisel vana parool EI muutu ja sessioonid jäävad alles
— parool vahetub alles siis, kui kasutaja lingi kaudu uue seab. Nii ei lukusta admin
kogemata kasutajat välja.

**Rolli muutuse / kustutuse race (peidetud servajuhtum).** Privileegikontroll toimub
tokeni LOOMISEL, kuid sihtkasutaja roll võib muutuda enne tokeni kasutamist. Näide: admin
loob editorile reset-tokeni, editor edutatakse vahepeal adminiks → token jääks aktiivseks
ja rikuks invariandi "admin ei saa teise admini parooli lähtestada". **Lahendus tühistada
token sihtmärgi poolelt** (mitte `created_by`-põhise taaskontrolliga, mis on hapram —
looja võib vahepeal kustutuda/alaneda):
- `update_user_role(username, …)` (olemasolev — invalideerib juba sessioone) kutsub LISAKS
  `revoke_user_reset_tokens(username, "role_changed")`. (Lihtsuse mõttes igal rollimuutusel,
  mitte ainult edutamisel — kasutamata reset-token pole pärast rollimuutust niikuinii enam
  usaldatav.)
- `delete_user(username, …)` kutsub `revoke_user_reset_tokens(username, "user_deleted")`.

### 2. Backend — endpointid

`server/routers/admin.py` (admin-õigus, `require_role("admin")`):
- `POST /admin/users/reset-password` — body `{username}`.

  **Privileegide kontroll (kaitse eskaleerumise eest):** admin EI tohi lähtestada endast
  kõrgema VÕI võrdse privileegiga kasutajat, v.a iseendale. Rolli-hierarhia
  `{contributor:0, editor:1, admin:2}`:
  - admin saab lähtestada iseennast (sh enda parooli);
  - admin saab lähtestada madalama rolli (editor, contributor);
  - admin EI saa lähtestada teist admini (võrdne) → 403.

  Seetõttu jääb `meelis` (samuti `admin`-roll) kaitstuks üldreegli kaudu — teine admin ei
  saa tema parooli lähtestada, ainult ta ise. Eraldi `meelis`-hardcode'i pole vaja
  (erinevalt `update_user_role`/`delete_user`-ist). Tagastab:
  ```json
  { "status": "success",
    "reset_url": "/set-password?token=<uuid>&reset=1",
    "expires_at": "...",
    "username": "...", "name": "..." }
  ```

`server/routers/auth.py` (avalik, rate-limited):
- `POST /reset/validate` — body `{token}` (MITTE `GET /reset/{token}`). Tagastab
  `{status, valid, username, name, expires_at}`. Töötab ainult kehtiva tokeniga; ei lekita
  rohkem kui vaja. **Põhjus POST + body:** reset-token on tundlikum kui invite (olemasoleva
  konto ülevõtt) — URL-tee (`GET /reset/{token}`) paljundaks tokeni API access-logidesse,
  reverse-proxy-logidesse ja brauseri ajalukku. POST body hoiab tokeni logidest väljas.
  (Erineb teadlikult invite-mustrist, kus `GET /invite/{token}`.)
- `POST /reset/set-password` — body `{token, password}`, kutsub `complete_password_reset`.

**Rate-limit MÕLEMAL endpointil** (`get_client_ip` + `check_rate_limit`, sama muster nagu
`/invite/set-password`). **Võti = IP + endpoint, MITTE KUNAGI token** — vastasel juhul
saaks ründaja iga uue juhutokeniga limiidist mööda. Väldib tokenite brute-force'imist ja
kasutajanime lekkimist.

Aegunud tokenite eraldi koristust pole vaja (passiivne puhastus toimub `create_reset_token`-is,
vt eespool — valideerimisel hüljatakse niikuinii).

**Infra-märkus:** kaaluda tokenite redigeerimist nginx/uvicorn access-logidest. Lingi enda
sees on token paratamatu, kuid POST-body valideerimine hoiab selle vähemalt API-logi
päringuteedest väljas.

### 3. Frontend

**`src/pages/admin/Users.tsx` — tegevuste tulba ümberkujundus (kebab-menüü).**

Praegune probleem: tabelis on 7 tulpa (`min-w-[640px]` + `overflow-x-auto`), reaalne sisu
on laiem kui `max-w-5xl` konteiner → parempoolseim "Tegevused" tulp jääb akna serva taha.
Teise tegevusnupu lisamine süvendaks seda.

**Lahendus:** asenda inline tegevusnupud ühe kompaktse kebab-ikooniga (`MoreVertical`
lucide'ist), mis avab rípsmenüü:
- **Taasta parool** (`KeyRound`) — nähtav ainult lubatud sihtmärkidele (vt allpool).
- **Kustuta** (`Trash2`) — senine kustutus + kinnitusaste kolib menüüsse.

See koondab kõik rea-tegevused ühte kitsasse tulpa (skaleerub, kui tegevusi lisandub) ja
vabastab horisontaalruumi. Kebab-menüü vajab klikk-väljaspool-sulgemist ja
positsioneerimist (üks `openMenu: username | null` state; klikk mujale sulgeb).

**Ligipääsetavus (märkida implementatsiooniplaani):** kebab-nupul `aria-haspopup="menu"`
ja `aria-expanded`; menüü avatav klaviatuurilt (Enter/Space) ja suletav `Esc`-iga; fookus
liigub menüü esimesele kirjele avamisel. Ei pea disaini raskeks ajama, aga baas-a11y peab
olema.

**"Taasta parool" nähtavus** (peegeldab backend-i privileegikontrolli — backend on
autoriteet, UI ainult peidab): nähtav madalama rolliga kasutajale (editor/contributor)
VÕI iseenda real; teiste adminite real mitte. (Iseenda real "Kustuta" jääb peidetuks nagu
praegu; seega iseenda real on menüüs ainult "Taasta parool".)

**"Taasta parool" voog:**
- Klikk → `POST /admin/users/reset-password` → modaal näitab täislinki
  (`window.location.origin + reset_url`) + "Kopeeri link" nupp (sama muster nagu
  `Registrations.tsx` invite-lingi puhul, `linkCopied` state).
- Näitab aegumisaega ("Link kehtib 24h"). Eraldi kinnitusastet pole vaja (ohutu).

**`src/pages/SetPassword.tsx`** — taaskasutame. Reset-režiim tuvastatakse
`searchParams.get('reset') === '1'` järgi:
- Reset: `POST /reset/validate` (body `{token}`) valideerimiseks, `POST /reset/set-password`
  submitiks.
- Invite (senine): `GET /invite/{token}` + `POST /invite/set-password`.
- Tekstid kohanduvad: invite = "Tere tulemast!", reset = "Sea uus parool".
- Uued i18n võtmed `et`/`en` (`register.json`, kus SetPassword tekstid praegu elavad —
  kinnitada implementeerimisel).

**Teenusekiht** — endpointid olemasoleva `apiPost`/`fetchWithTimeout` kaudu, uut teenust
pole vaja.

## Turvalisus

- Reset-token = UUID4 (sama entroopia kui invite/sessioon).
- Token ühekordne (`used` + atomaarne consume + rollback); eristatud `revoked`-ist.
- Parooli vahetusel invalideeritakse kasutaja sessioonid (vt veatee — success ainult kui
  mõlemad õnnestuvad).
- Varasem token sama kasutaja kohta tühistatakse uue genereerimisel (`superseded`).
- Sihtkasutaja rolli muutus / kustutus tühistab tema kasutamata reset-tokenid (race-kaitse).
- **Privileegide eskaleerumise kaitse:** admin ei saa lähtestada võrdse/kõrgema privileegiga
  kasutajat (sh teist admini ega `meelis`-t) — ainult madalamaid ja iseennast.
- **Rate-limit MÕLEMAL avalikul endpointil** (`POST /reset/validate`, `POST /reset/set-password`),
  võti IP + endpoint, mitte token.
- Token ei satu API access-logi päringuteedesse (POST-body, mitte URL-tee).

## Aktsepteeritud piirangud

- **Admini self-lockout (Variant A):** range reegel kehtib — ükski admin ei saa teist
  admini lähtestada. Seega parooli unustanud ja sisse logida mittesaav admin vajab **otsest
  serveri-ligipääsu / käsitsi reset'i** `state/users.json`-is (nt `hash_password` käsitsi
  genereeritud hash). Teadlik piirang.
- **Tuleviku-suund (Variant B, EI implementeerita praegu):** korrektsem lahendus oleks eraldi
  **owner/superadmin roll** (kõrgeim, asendaks `meelis`-hardcode'i), kes ainsana saaks
  adminitele reset-linke luua. See on suurem tükk (uus roll rolli-hierarhiasse, migratsioon,
  UI, testid) ja jääb eraldi tööks. Kuni siis kehtib Variant A.

## SMTP-valmidus

`create_reset_token` ja `create_invite_token` jäävad puhtalt token-genereerivateks
(tagastavad token-andmed). Kohaletoimetamine on kutsuja vastutus. Hiljem lisandub eraldi
`send_reset_email(token_data)` kiht endpointi sisse, ilma core-loogikat muutmata.

## Testid

`tests/test_password_reset.py` (`.venv/bin/python -m pytest`):
- Token loomine kehtivale kasutajale.
- Olematu kasutaja → viga.
- `validate_reset_token`: kehtiv, aegunud, kasutatud, olematu.
- Atomaarne consume (üks edukas, teine "juba kasutatud").
- Varasema tokeni tühistamine uue loomisel (`revoked`, `revocation_reason="superseded"`).
- Passiivne puhastus: > 7 päeva minevikus aegunud kirjed eemaldatakse uue tokeni loomisel.
- `complete_password_reset`: muudab bcrypt-hashi + invalideerib sessioonid.
- Parooli-tugevuse keeldumine (lühike / liiga lihtne).
- Salvestamise rollback (`_unconsume_token`).
- **Privileegide kontroll** (endpoint-tasandil): admin → editor/contributor OK; admin →
  teine admin 403; admin → iseennast OK.
- **Rate-limit** `POST /reset/validate` ja `POST /reset/set-password` (vajadusel testitav,
  kui rate-limit on testikeskkonnas aktiivne).
- **Race: sihtmärgi roll muutub pärast tokeni loomist** — `update_user_role` tühistab
  kasutaja kasutamata tokenid (`role_changed`); seejärel `validate`/`complete` annab
  "tühistatud" vea.
- **Race: tokeni loonud admin kustutatakse/alandatakse enne kasutust** — token jääb kehtima
  (invariant on sihtmärgi-, mitte looja-põhine); reset õnnestub.
- **`delete_user` tühistab sihtmärgi tokenid** (`user_deleted`).
- **`delete_user_sessions` ebaõnnestub pärast hash-vahetust** → vana hash taastatakse,
  token unconsume'itakse, tagastatakse viga (mitte success).
- **Kaks järjestikust reset-linki:** esimene muutub kehtetuks (`superseded`) ja annab õige
  veateate; teine töötab.

Olemasolevat invite-voogu need ei puuduta (eraldi moodul + hoidla).

## Deploy

- Backend: `git pull && docker compose build --no-cache backend && docker compose up -d backend`.
- Frontend: `npm run typecheck` → `npm run build` → `rsync -avz dist/ vutt:~/VUTT/dist/`.
- `state/reset_tokens.json` luuakse esimesel kasutusel automaatselt.
