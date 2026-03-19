# Review Prioriteedid ja Implementatsiooniplaan

Kuupäev: 2026-03-19

See dokument koondab koodireview leiud prioriteetide kaupa ning visandab soovitusliku paranduste järjekorra.

## P1

- Invite-tokeni redeem flow's on race condition. Sama tokenit saab teoreetiliselt paralleelsete päringutega mitu korda kasutada, sest valideerimine ja `used=true` märkimine ei toimu ühe lukustatud atomaarse operatsioonina. Vaata [registration.py:169](/home/mf/LLM/VUTT/server/registration.py#L169), [registration.py:171](/home/mf/LLM/VUTT/server/registration.py#L171), [registration.py:209](/home/mf/LLM/VUTT/server/registration.py#L209). See on kõige selgem päris bug turva- ja andmekorrektsuse mõttes.

- Auth token liigub query-stringis ja backend toetab seda läbivalt. See tähendab lekkimisriski logidesse, browser history'sse, bookmarkidesse, debug-output'i ja osades voogudes ka URL-jagamise kaudu. Vaata [main.py:74](/home/mf/LLM/VUTT/server/main.py#L74), [main.py:79](/home/mf/LLM/VUTT/server/main.py#L79), [router.py:32](/home/mf/LLM/VUTT/server/prosopography/router.py#L32), [Upload.tsx:402](/home/mf/LLM/VUTT/src/pages/Upload.tsx#L402), [CollectionEditor.tsx:126](/home/mf/LLM/VUTT/src/components/CollectionEditor.tsx#L126). See ei pruugi kohe kompromiteerida süsteemi, aga on halb auth-hügieen ja levib paljudesse kohtadesse.

- Rate limiting/IP tuvastus on habras. `get_client_ip()` fallback kasutab `handler.client_address[0]`, aga FastAPI `Request` puhul see ei tundu korrektne API olevat; see võib vales deploy-kontekstis anda 500 või vale IP. Lisaks usaldatakse proxy päiseid pimesi. Vaata [rate_limit.py:64](/home/mf/LLM/VUTT/server/rate_limit.py#L64), [rate_limit.py:75](/home/mf/LLM/VUTT/server/rate_limit.py#L75), [main.py:111](/home/mf/LLM/VUTT/server/main.py#L111), [main.py:1182](/home/mf/LLM/VUTT/server/main.py#L1182). Praeguse deploy-mudeli juures on see pigem töökindluse + future-hardening probleem, aga auth endpointidel väärib kiiret parandust.

## P2

- Sessioonide dict'i kasutatakse ebajärjekindlalt: cleanup thread lukustab, aga `create_session`, `delete_session`, `require_token` ja `/verify-token` loevad/muudavad seda ilma lukuta. Vaata [auth.py:31](/home/mf/LLM/VUTT/server/auth.py#L31), [auth.py:118](/home/mf/LLM/VUTT/server/auth.py#L118), [auth.py:134](/home/mf/LLM/VUTT/server/auth.py#L134), [auth.py:152](/home/mf/LLM/VUTT/server/auth.py#L152), [main.py:123](/home/mf/LLM/VUTT/server/main.py#L123). See on klassikaline "vahel juhtub" concurrency-bug.

- JSON state/write mustrid on ebaühtlased. Osa kasutab `atomic_write_json`, osa kirjutab otse failile, eriti `collections.json`, `user_chars` ja upload state. Vaata [main.py:998](/home/mf/LLM/VUTT/server/main.py#L998), [main.py:1043](/home/mf/LLM/VUTT/server/main.py#L1043), [main.py:1128](/home/mf/LLM/VUTT/server/main.py#L1128), [main.py:1168](/home/mf/LLM/VUTT/server/main.py#L1168), [upload_ops.py:64](/home/mf/LLM/VUTT/server/upload_ops.py#L64). Kui protsess katkeb või kaks kirjutust satuvad halba ajastusse, võib jääda katki JSON.

- Allalaadimise ZIP ehitatakse täies mahus mällu. Suure teose korral on see tarbetu RAM-kulu ja lihtne koormuspunkt. Vaata [main.py:1245](/home/mf/LLM/VUTT/server/main.py#L1245). See on rohkem töökindlus/optimeerimine kui turvaviga.

## P3

- OCR-SSH host key kontroll puudub, aga praeguse threat model'i järgi on see madalama prioriteediga hardening-item, mitte terav leid. Kui liiklus jääb TÜ sisevõrku ja teenus pole väljast kättesaadav, on risk oluliselt väiksem. Vaata [upload_ops.py:137](/home/mf/LLM/VUTT/server/upload_ops.py#L137) kuni [upload_ops.py:142](/home/mf/LLM/VUTT/server/upload_ops.py#L142).

- Koodibaasis on märkimisväärselt crufti ja vastutuste koondumist. [main.py](/home/mf/LLM/VUTT/server/main.py), [upload_ops.py](/home/mf/LLM/VUTT/server/upload_ops.py), [ops.py](/home/mf/LLM/VUTT/server/prosopography/ops.py), [Dashboard.tsx](/home/mf/LLM/VUTT/src/pages/Dashboard.tsx) ja [TextEditor.tsx](/home/mf/LLM/VUTT/src/components/TextEditor.tsx) on kõik väga suured. `server/archive/` hoiab vana serveriloogika koopiaid, mis teeb grep'i, review ja refaktoreerimise mürarikkaks.

- Testikate paistab sisuliselt puuduvat. See suurendab riski just concurrency- ja failikirjutuse tüüpi vigade puhul.

## Implementatsiooniplaan

1. Invite-tokeni flow atomaarseks.
   Failis [registration.py](/home/mf/LLM/VUTT/server/registration.py) tee üks lukustatud funktsioon, mis ühe kriitilise sektsiooni sees:
   - loeb tokenid,
   - valideerib `exists / not used / not expired`,
   - reserveerib või märgib kasutatuks,
   - alles siis loob kasutaja ja salvestab.
   Kui kasutaja loomine võib pärast ebaõnnestuda, otsusta teadlikult, kas token jääb `used` või lisad eraldi `consumed_by` / `status` oleku.

2. Võta auth token query-stringist välja.
   Backendis lõpeta `token` query-parami lugemine auth jaoks või jäta see ajutiselt deprecated fallbackiks admin GET-endpointidele. Frontendis vii kõik authiga päringud üle `Authorization: Bearer ...` või vähemalt JSON body peale. Alusta failidest, kus query-tokenit kasutatakse kõige rohkem, nt [Upload.tsx](/home/mf/LLM/VUTT/src/pages/Upload.tsx), [WorkManage.tsx](/home/mf/LLM/VUTT/src/pages/WorkManage.tsx), [CollectionEditor.tsx](/home/mf/LLM/VUTT/src/components/CollectionEditor.tsx), [prosopographyService.ts](/home/mf/LLM/VUTT/src/prosopography/services/prosopographyService.ts).

3. Tee IP tuvastus korrektseks ja konservatiivseks.
   Kasuta `request.client.host` fallbackina. Usalda `X-Real-IP`/`X-Forwarded-For` ainult siis, kui päring tuleb teadaolevalt reverse proxy tagant või kui deploy seda garanteerib. Vajadusel lisa väike helper "trusted proxy mode" lülitiga configi.

4. Pane sessioonide ligipääs ühtse lukustuse alla.
   Kõik `sessions` lugemised/muudatused peaksid käima ühe helper-kihi kaudu, mitte otse dict'ile ligi minnes. See puudutab vähemalt [auth.py](/home/mf/LLM/VUTT/server/auth.py) ja `/verify-token` handlerit [main.py:119](/home/mf/LLM/VUTT/server/main.py#L119).

5. Ühtlusta state write'id.
   Asenda otsesed `json.dump(... open(..., 'w'))` mustrid `atomic_write_json` peale seal, kus kirjutatakse püsiolekut. Eriti:
   - `collections.json`,
   - `user_chars`,
   - upload state failid.
   Kui fail on jagatud ressurss, lisa selle ümber ka konkreetne lock, mitte ainult atomic rename.

6. Leevenda download endpointi mälukasutust.
   Kui tahad väiksema muudatusega, kasuta `tempfile.NamedTemporaryFile()` põhist ZIP-i loomist ketta peale. Kui tahad puhtamat lahendust, tee streamiv ZIP-vastus.

7. Hardening ja hooldus.
   Lisa host key kontroll OCR-ühendusele siis, kui jõuate turvakõvastuseni. See ei oleks esimese laine töö. Samas laineis võiks:
   - tõsta `server/archive/` eraldi dokumenteeritud legacy tsooni või repo ajalukku,
   - lõhkuda suured failid väiksemateks mooduliteks,
   - lisada vähemalt mõned smoke-testid auth/register/download/write flow'dele.

## Soovitatud järjekord

1. Invite-tokeni race condition.
2. Token query-stringist välja.
3. IP/rate-limit ja session-locking.
4. Atomic state writes.
5. Download memory fix.
6. SSH host key hardening, cruft cleanup, testikate.
