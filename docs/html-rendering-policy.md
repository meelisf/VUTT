# Frontendi HTML renderdamise poliitika

VUTT-is ei kasutata `dangerouslySetInnerHTML` otse lehe- ega komponendifailides. Kõik HTML renderdamise juhud käivad läbi `src/components/SafeHtml.tsx`.

Lubatud `SafeHtml.kind` väärtused:

| kind | Kasutus | Reegel |
|---|---|---|
| `highlight` | Meilisearch `_formatted` väljad | Escape kõik HTML, taasta ainult rakenduse kontrollitud `<em class="bg-yellow-200 font-bold not-italic">` highlight |
| `translation` | i18n stringid, kus on lihtne vormindus | Escape kõik HTML, taasta ainult `<strong>` |
| `generated` | Rakenduse enda parseri genereeritud HTML | Lubatud ainult siis, kui parser escape'ib kasutajasisendi enne HTML-i lisamist |
| `trusted` | Staatilised repo/public HTML failid | Ainult versioonitud staatiline sisu, mitte kasutajasisend ega API vastus |

Uute otsekasutuste vältimiseks on guard-test:

```bash
npm test -- --run src/utils/__tests__/dangerouslySetInnerHTMLGuard.test.ts
```

Kui on vaja uut HTML renderdamise juhtumit, lisa see esmalt siia poliitikasse ja `SafeHtml` komponendi allowlisti; ära lisa `dangerouslySetInnerHTML` otse komponenti.
