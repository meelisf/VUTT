# Topeltlehe lõikur — disainispekifikatsioon

**Kuupäev:** 2026-06-08  
**Staatus:** Kinnitatud

## Ülevaade

Utiliit topeltlehekülje kaheks jagamiseks WorkManage lehel. Kasutaja lohistab vertikaalset lõikejoont pildi peal, kinnitab ja server loob kaks uut lehekülge originaali asemele.

## UI — SplitPageModal

### Päästik

WorkManage lehe pisipiltide alumisele nupuribale (koos alla-laadimise ja asendamise nuppudega) lisatakse uus nupp `Scissors` ikooniga. Nupp on nähtav ainult administraatoritele (sama roll mis ülejäänud manage-lehe funktsioonid).

### Modaal

- **Pealkirjaga** "Lõika leht kaheks"
- **Pildi eelvaade:** täislaiuse pildipreview. Laetakse `viewer-token` mehhanismiga (sama mis `PageThumb` retry) — töötab ka piiratud kollektsioonide teostel.
- **Lõikejoon:** lohistatav vertikaalne punane joon üle pildi koos visuaalse käepidemega (drag handle). Algasend: pildi keskel (50%).
- **Asukoha indikaator:** näitab praegust protsenti, nt `47%`.
- **"Lõika leht" nupp:** avab kinnitusdialoogi: *"Originaalleht asendatakse kahe uue lehega. Originaali tekst ja metaandmed kopeeritakse mõlemale. Kas jätkata?"*
- **Pärast edu:** lühike eduteade modaalis, seejärel sulgeb modaali ja kutsub `loadPages()`.
- **Vea korral:** kuvab veateate modaalis (ei sulge).

## Backend — uus endpoint

```
POST /admin/work/{work_id}/page/{page_num}/split
Authorization: Bearer <token>
Body: { "split_x": 0.47 }   // 0.0–1.0, laiuse fraktsioon
```

### Sammud serveris

1. Autentimine: `require_role("admin")`
2. Leia originaalleht `get_sorted_images(path)` järgi (1-indekseeritud `page_num`)
3. Loe originaali sequence (`.json`-ist, fallback `page_num * 100`)
4. Ava Pillowiga, arvuta `split_pixel = int(width * split_x)`
5. Loo kaks Pillow Image objekti:
   - **Vasakpoolne:** `image.crop((0, 0, split_pixel, height))`
   - **Parempoolne:** `image.crop((split_pixel, 0, width, height))`
6. Genereeri kaks unikaalset failinime (nanoid, sama muster mis `add-page` endpoint)
7. **Sequence:** vasakpoolne = originaali sequence, parempoolne = originaali sequence + 50
8. Salvesta mõlemad `.jpg` failid (JPEG quality=95)
9. **Teksti kopeerimine (`<pb/>` lõikamine):**
   - Loe originaali `.txt`
   - Kui tekst sisaldab `<pb/>`: vasakule tekst enne `<pb/>`, paremale tekst pärast
   - Kui `<pb/>` puudub: mõlemad saavad kogu originaalteksti
10. **Metaandmete kopeerimine:** kopeeri originaali `.json` mõlemale, uuenda `sequence` väli
11. **Originaali eemaldamine:** kustuta originaali `.jpg`, `.txt`, `.json` gitist (`delete_page_from_git` analoogselt)
12. **Git commit:** kõik muudatused ühes commitiga, sõnum nt `"Lõika leht {page_num}: {slug} [{work_id}]"`
13. **Meilisearch sync:** `sync_work_to_meilisearch(folder_name)`
14. **Tagastab:** `{ "status": "success", "new_page_count": N }`

### Veakäsitlus

- `split_x` väljaspool vahemikku [0.05, 0.95]: 400 Bad Request
- Lehekülg ei leita: 404
- Pillow viga (rikutud fail vms): 500

## `<pb/>` teksti lõikamine

```
"Vasakpoolne tekst.\n<pb/>\nParempoolne tekst."
  → vasakule: "Vasakpoolne tekst."
  → paremale: "Parempoolne tekst."
```

Lõigatakse ainult **esimese** `<pb/>` juures (kui neid on mitu). Tühikud/reavahetused alguses/lõpus triimitakse.

## Failinimede muster

Uued failid järgivad sama mustrit mis `admin_add_page`:  
`{nanoid(size=8)}.jpg` — unikaalne, pole konflikti olemasolevate failidega.

## Seosed olemasoleva koodiga

| Komponent | Seos |
|-----------|------|
| `WorkManage.tsx` | Lisatakse `SplitPageModal` import ja Scissors nupp pisipiltide ribale |
| `server/main.py` | Uus endpoint `POST /admin/work/{work_id}/page/{page_num}/split` |
| Pillow | Juba paigaldatud (`upload_ops.py`, `admin_replace_page_image`) |
| `delete_page_from_git` | Olemasolev funktsioon originaali eemaldamiseks |
| `sync_work_to_meilisearch` | Olemasolev funktsioon indeksi uuendamiseks |
| `viewer-token` | Olemasolev mehhanism pildi laadimiseks piiratud teostel |

## Väljaspool skoobi

- Horisontaalne lõikamine (ainult vertikaalne)
- Reaalajas kaheks jaotatud pildi eelvaade lohistamisel (lõikejoon on piisav)
- OCR uuele lehele (kasutaja teeb vajadusel käsitsi)
