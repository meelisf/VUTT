# 0009 — Iga füüsiline marginaaliarida on eraldi `<m>` plokk

**Staatus:** kehtib

## Kontekst

Editor aktsepteeris ajalooliselt ka mitut rida katvat `<m>…</m>` plokki ning
`marginaliaFromSelection` lõi mitmerealise valiku ümber ühe paari. Avatud
marginaalia sees sama toimingu kordamine võimaldas tekitada pesastatud või
lõpuks tasakaalustamata kuju (`<m><m>…</m>`). See rikub editori parserit ja
OCR-treeningu sisendit.

Järjestikuste marginaaliaridade ühe kaardina näitamine on juba lahendatud
`groupMarginaliaBlocks` abil renderduskihis; selleks ei ole vaja andmeformaadis
mitmerealist `<m>` paari.

## Otsus

Kanoonilises failiformaadis kehtivad invariandid:

1. Iga sisuline füüsiline marginaaliarida on omaette `<m>…</m>` plokk.
2. `<m>` sisu ei sisalda reavahetust ega teist `<m>` tägi.
3. Järjestikused `<m>` read koondatakse üheks kaardiks ainult kuvamisel; editor
   ei kirjuta grupeerimisel alusandmeid ümber.
4. Üle rea ulatuv inline-vormindus suletakse rea lõpus ja avatakse järgmisel
   real uuesti, et `<m>` jääks välimiseks tägiks.
5. Avatud marginaalia sees ei loo Marginalia-nupp uut plokki. Marginaaliasse
   kleebitavast välisest toortekstist eemaldatakse VUTT-tägid.

Legacy-parser võib olemasolevaid mitmerealisi plokke edasi lugeda, kuni andmed
on auditeeritud ja eraldi migratsiooniotsus tehtud. Neid ei parandata elavalt
iga klahvivajutuse järel.

## Tagajärjed

- Uued editoritoimingud peavad tootma rea-põhiseid `<m>` paare.
- Renderduse `groupMarginaliaBlocks` jääb visuaalseks koondamiseks.
- Olemasolevate failide vead kaardistatakse ainult-lugemiseks mõeldud
  `scripts/audit_marginalia_markup.py` abil enne automaatset migratsiooni.
- Konservatiivne `scripts/migrate_marginalia_per_line.py` teisendab ainult
  tasakaalus ja omaette ridadel piirkonnad. Nähtav tekst ning ridade arv peavad
  jääma bititäpselt samaks; ebamäärased juhud jäävad raportisse.
- Salvestusaegse paranduse põhimõte jääb ADR 0003 järgi kehtima; migratsiooni
  dry-run vaadatakse enne `--apply` käivitamist eraldi üle.
