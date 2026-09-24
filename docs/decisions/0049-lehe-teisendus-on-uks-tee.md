# ADR 0049 — Lehe teisendus on üks tee; upload'is pööre → kärbe → poolitus

**Kuupäev:** 2026-09-24
**Staatus:** vastu võetud
**Issue:** #431

## Kontekst

Lehepildi ettevalmistus oli kahes kohas kahe eri loogikaga. Teose halduse
pildiredaktor (`PageImageEditorModal`) oskas kärpida, kallet parandada ja
perspektiivi sirgestada, aga poolitas ainult ühe lehe kaupa. Upload'i ülevaatus
(samm 3) oskas hulgi poolitada ja pöörata, aga mitte kärpida. Ühtlust hoiti
käsitsi kopeeritud koodiga („karkass 1:1", „järgib TAHTLIKULT sama kuju").

## Otsus

- **Üks teisendus serveris:** `server/image_transform.py` (`apply_transform`,
  `normalize_adjust`, `apply_adjust`). Kasutavad nii
  `admin_page_ops.transform_page_image` kui upload'i `prepress_apply` ja
  eelvaade. Parameetrid on mõlemal sama leping `{angle, crop | quad}`,
  koordinaadid 0..1, seega 100 DPI eelvaade ja 300 DPI väljund annavad sama lõike.
- **Üks kasutajaliides:** `src/components/pagePrep/` (`useCropBox` +
  `CropOverlay`, `useSplitDrag` + `SplitLine`, `RotateButtons`,
  `FloatingActionBar`). Sildid `common:pagePrep.*`.
- **Upload'i plaani lehekirjel on valikuline `adjust`.** Apply järjekord:
  **pööre → adjust → poolitus.** `adjust` on pööratud lehe raamis, `split_x`
  kohandatud lehe laiuses.
- **Pööre eemaldab `adjust`-i** (`withRotation`): koordinaadid kuuluvad eelmisse
  raami. Sama nagu pildiredaktoris, kus jäme pööre lähtestab kärpekasti.
- **Eelvaade saab `adjust`-i URL-ist (`?adj=`), mitte plaanist.** URL on
  deterministlik; salvestamata muudatus ei saa brauseri vahemällu valet pilti
  jätta. Serveri vahemälu võti on normaliseeritud `adjust`-i räsi.
- **Puuduv `adjust` võti salvestuses = ära puutu.** Ainult selgesõnaline `null`
  eemaldab. Vana klient (vahemälus JS deploy ajal) ei tohi kärbet pühkida.
- `adjust`-iga leht ei ole baitkoopia (`can_copy_source_bytes`), nagu pööratud leht.

## Tagajärjed

- Uus teisendusliik (nt heledus) lisatakse `image_transform`-i ja jõuab mõlemale teele.
- Teose halduse hulgitoimingud ootel plaanina on eraldi etapp (#431 etapp 3) ja
  vajavad oma ADR-i — seal on lehel juba tekst ja git-ajalugu.
- Valvurid: `tests/test_prepress_adjust.py`,
  `src/pages/upload/components/__tests__/SplitPageDetail.crop.test.tsx`.
