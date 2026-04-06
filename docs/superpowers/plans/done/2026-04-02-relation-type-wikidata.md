# Seose tüüp Wikidatast — Implementatsiooniplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Asendada `relations[].type` vabatekstiline sisend `EntityPicker`-iga, mis võimaldab linkida seose tüübi Wikidata mõistega (nt Q37226 — teacher), lisades automaatsed tõlked ja standardiseeritud koodid.

**Architecture:** Ainult frontend muudatused. `RelationDraft` tüüp laiendatakse kahe valikulise väljaga (`type_id`, `type_labels`). `helpers.ts` loeb ja kirjutab neid välju. `PersonEditPage`-l asendatakse `<input type="text">` `EntityPicker`-iga (type="topic"). `PersonDetailPage` kasutab tõlgitud nimetust kui olemas. Backend on schemavaba — muudatusi ei vaja.

**Tech Stack:** React 19 + TypeScript, Tailwind, lucide-react, olemasolev `EntityPicker` komponent, `isQCode` utiliit (`src/utils/qcodeUtils.ts`)

---

## Failide kaart

| Fail | Muudatus |
|------|----------|
| `src/prosopography/components/personForm/types.ts` | `RelationDraft` + `type_id`, `type_labels` |
| `src/prosopography/components/personForm/helpers.ts` | `recordToDraft` rida 140, `draftToPayload` rida 249 |
| `src/prosopography/pages/PersonEditPage.tsx` | `<input>` → `EntityPicker` ridadel 645–651 |
| `src/prosopography/pages/PersonDetailPage.tsx` | `StructuredInfoCard` relations rida ~122 |

---

## Task 1: Laienda RelationDraft tüüpi

**Files:**
- Modify: `src/prosopography/components/personForm/types.ts:25`

- [ ] **Samm 1: Asenda RelationDraft definitsioon**

Ava `src/prosopography/components/personForm/types.ts`. Leia rida 25:
```typescript
export interface RelationDraft { name: string; type: string; target_id?: string | null; reciprocal_auto?: boolean }
```

Asenda:
```typescript
export interface RelationDraft {
  name: string;
  type: string;
  type_id?: string | null;
  type_labels?: Record<string, string> | null;
  target_id?: string | null;
  reciprocal_auto?: boolean;
}
```

- [ ] **Samm 2: Commit**

```bash
cd /home/mf/LLM/VUTT
git add src/prosopography/components/personForm/types.ts
git commit -m "feat: lisa type_id ja type_labels RelationDraft tüüpi"
```

---

## Task 2: Uuenda helpers.ts

**Files:**
- Modify: `src/prosopography/components/personForm/helpers.ts`

- [ ] **Samm 1: Lisa isQCode import faili algusesse**

Ava `src/prosopography/components/personForm/helpers.ts`. Lisa rida 3 järele:
```typescript
import { isQCode } from '../../../utils/qcodeUtils';
```

- [ ] **Samm 2: Uuenda recordToDraft — lisa type_id ja type_labels**

Leia rida 140 (`recordToDraft` funktsioonis):
```typescript
    relations: (p.relations ?? []).map((r: any) => ({ name: r.name ?? '', type: r.type ?? '', target_id: r.target_id ?? null })),
```

Asenda:
```typescript
    relations: (p.relations ?? []).map((r: any) => ({
      name: r.name ?? '',
      type: r.type ?? '',
      type_id: r.type_id ?? null,
      type_labels: r.type_labels ?? null,
      target_id: r.target_id ?? null,
      reciprocal_auto: r.reciprocal_auto ?? undefined,
    })),
```

- [ ] **Samm 3: Uuenda draftToPayload — lisa type_id ja type_labels payload-i**

Leia rida 249 (`draftToPayload` funktsioonis):
```typescript
    relations: draft.relations.filter(r => r.name.trim() || r.target_id).map(r => ({
      name: r.name.trim(),
      ...(r.type.trim() ? { type: r.type.trim() } : {}),
      ...(r.target_id ? { target_id: r.target_id } : {}),
    })),
```

Asenda:
```typescript
    relations: draft.relations.filter(r => r.name.trim() || r.target_id).map(r => ({
      name: r.name.trim(),
      ...(r.type.trim() ? { type: r.type.trim() } : {}),
      ...(r.type_id && isQCode(r.type_id) ? { type_id: r.type_id } : {}),
      ...(r.type_labels ? { type_labels: r.type_labels } : {}),
      ...(r.target_id ? { target_id: r.target_id } : {}),
      ...(r.reciprocal_auto !== undefined ? { reciprocal_auto: r.reciprocal_auto } : {}),
    })),
```

- [ ] **Samm 4: Commit**

```bash
git add src/prosopography/components/personForm/helpers.ts
git commit -m "feat: uuenda recordToDraft ja draftToPayload — type_id, type_labels"
```

---

## Task 3: Asenda type sisend EntityPicker-iga PersonEditPage-l

**Files:**
- Modify: `src/prosopography/pages/PersonEditPage.tsx:645–651`

- [ ] **Samm 1: Asenda `<input type="text">` EntityPicker-iga**

`EntityPicker` on juba imporditud faili rida 6-l. Leia relations `renderItem` (rida ~642) ning asenda `<input type="text">` plokk:

```tsx
                <input
                  type="text"
                  value={item.type}
                  onChange={e => onChange({ ...item, type: e.target.value })}
                  placeholder={t('form.relationPlaceholder')}
                  className={`w-36 ${inputCls} shrink-0`}
                />
```

Asenduseks:
```tsx
                <div className="w-44 shrink-0">
                  <EntityPicker
                    type="topic"
                    value={item.type_id
                      ? { id: item.type_id, label: item.type, labels: item.type_labels ?? {}, source: 'wikidata' as const }
                      : item.type || null
                    }
                    onChange={entity => onChange({
                      ...item,
                      type: entity?.label ?? '',
                      type_id: (entity?.id && entity.id !== entity.label) ? entity.id : null,
                      type_labels: entity?.labels ?? null,
                    })}
                    placeholder={t('form.relationPlaceholder')}
                  />
                </div>
```

- [ ] **Samm 2: Kontrolli TypeScript kompileerimist**

```bash
cd /home/mf/LLM/VUTT && npm run build 2>&1 | tail -20
```

Oodatav: `✓ built in` — no TypeScript errors.

- [ ] **Samm 3: Commit**

```bash
git add src/prosopography/pages/PersonEditPage.tsx
git commit -m "feat: asenda seose tüübi tekstisisend EntityPicker-iga"
```

---

## Task 4: Kuva tõlgitud tüüp PersonDetailPage-l

**Files:**
- Modify: `src/prosopography/pages/PersonDetailPage.tsx:122–127`

- [ ] **Samm 1: Uuenda relations kuvamine StructuredInfoCard-is**

Leia `StructuredInfoCard` komponendi sees (rida ~83):
```typescript
const StructuredInfoCard: React.FC<{ person: ProsopoRecord }> = ({ person }) => {
  const { t } = useTranslation(['prosopography', 'common']);
  const getLabel = useEntityLabel();
```

Lisa `i18n` ja `lang` muutuja:
```typescript
const StructuredInfoCard: React.FC<{ person: ProsopoRecord }> = ({ person }) => {
  const { t, i18n } = useTranslation(['prosopography', 'common']);
  const lang = i18n.language?.slice(0, 2) ?? 'et';
  const getLabel = useEntityLabel();
```

Seejärel leia `person.relations?.length > 0` plokk (~rida 122):
```typescript
  if (person.relations?.length > 0) {
    rows.push({
      label: t('relations', 'Seosed'),
      value: person.relations.map((r: any) => `${r.name ?? r.target_id}${r.type ? ` (${r.type})` : ''}`).join(', '),
    });
  }
```

Asenda:
```typescript
  if (person.relations?.length > 0) {
    rows.push({
      label: t('relations', 'Seosed'),
      value: person.relations.map((r: any) => {
        const typeLabel = r.type_labels?.[lang] ?? r.type_labels?.en ?? r.type ?? '';
        return `${r.name ?? r.target_id}${typeLabel ? ` (${typeLabel})` : ''}`;
      }).join(', '),
    });
  }
```

- [ ] **Samm 2: Kontrolli TypeScript kompileerimist**

```bash
cd /home/mf/LLM/VUTT && npm run build 2>&1 | tail -20
```

Oodatav: `✓ built in` — no TypeScript errors.

- [ ] **Samm 3: Commit**

```bash
git add src/prosopography/pages/PersonDetailPage.tsx
git commit -m "feat: kuva seose tüübi tõlge PersonDetailPage-l"
```

---

## Lõplik kontroll

- [ ] Käivita build: `npm run build`
- [ ] **Lisamine:** ava isiku edit leht, ava "Seosed ja märkmed" sektsioon, klõpsa seose tüübi väljale → EntityPicker dropdown avab Wikidata otsingu; otsi "teacher" → vali Q37226 → `type` täitub "teacher", `type_id` = "Q37226"
- [ ] **Salvestamine:** salvesta → ava isiku detail leht → StructuredInfoCard "Seosed" reas kuvatakse tõlgitud tüüp aktiivses keeles
- [ ] **Tagasiühilduvus:** olemasolevad seosed vabatekstilise tüübiga kuvatakse edasi korrektselt (ilma type_id-ta)
