import type { ProsopoRecord } from '../../types';
import type { FormDraft, DateDraft, EducationDraft } from './types';
import { emptyDateDraft } from './types';
import { isQCode } from '../../../utils/qcodeUtils';
import type { VocabularySeisusItem } from '../../../services/collectionService';
import { normalizeExtId } from '../../utils/externalIds';

function isoStringToDraft(iso: string): DateDraft {
  const [y, m, d] = iso.split('-').map(Number);
  return { ...emptyDateDraft(), year: y ? String(y) : '', month: m ? String(m) : '', day: d ? String(d) : '' };
}

function historicalDateToDraft(h: any): DateDraft {
  // `0000` on jäänuk sellest, et tühja aastat ei saanud salvestada — laeme
  // selle tühjana, et kaardi avamine ja salvestamine välja päriselt puhastaks.
  const aasta = h.date && h.date.slice(0, 4) !== '0000' ? h.date.slice(0, 4) : '';
  return {
    year: aasta,
    month: aasta && h.precision !== 'year' ? String(parseInt(h.date.slice(5, 7))) : '',
    day: aasta && h.precision === 'day' ? String(parseInt(h.date.slice(8, 10))) : '',
    circa: h.is_circa ?? false,
    bound: h.bound ?? '',
    calendar: h.calendar ?? '',
    place: h.place?.label ? { label: h.place.label, id: h.place.id ?? null, labels: h.place.labels ?? null, source: 'wikidata' as const } : null,
  };
}

// Rakendab fetch_and_diff auto_filled väljad olemasolevale draftile
export function applyEnrichmentToDraft(autoFilled: Record<string, any>, draft: FormDraft): FormDraft {
  const patch: Partial<FormDraft> = {};

  if (autoFilled['gender']) patch.gender = autoFilled['gender'];

  // Nimi (ainult GND annab — ärge kirjuta üle kasutaja sisestust)
  if (autoFilled['name.label'] && !draft.name_label.trim()) {
    patch.name_label = autoFilled['name.label'];
  }
  if (autoFilled['name.aliases']?.length) {
    patch.name_aliases = autoFilled['name.aliases'];
  }

  // Sünniaeg
  if (autoFilled['birth.date']) {
    const d: string = autoFilled['birth.date'];
    const precision: string = autoFilled['birth.precision'] ?? 'day';
    const mRaw = parseInt(d.slice(5, 7));
    const dayRaw = parseInt(d.slice(8, 10));
    patch.birth = {
      ...draft.birth,
      year: d.slice(0, 4),
      month: precision !== 'year' && !isNaN(mRaw) ? String(mRaw) : '',
      day: precision === 'day' && !isNaN(dayRaw) ? String(dayRaw) : '',
    };
  }
  // Sünnikoht — rakenda sõltumata sellest kas kuupäev on olemas
  if (autoFilled['birth.place']?.label && !draft.birth.place) {
    const bp = autoFilled['birth.place'];
    patch.birth = { ...(patch.birth ?? draft.birth), place: { label: bp.label, id: bp.id ?? null, labels: bp.labels ?? null, source: 'wikidata' as const } };
  }

  // Surmaaeg
  if (autoFilled['death.date']) {
    const d: string = autoFilled['death.date'];
    const precision: string = autoFilled['death.precision'] ?? 'day';
    const mRaw = parseInt(d.slice(5, 7));
    const dayRaw = parseInt(d.slice(8, 10));
    patch.death = {
      ...draft.death,
      year: d.slice(0, 4),
      month: precision !== 'year' && !isNaN(mRaw) ? String(mRaw) : '',
      day: precision === 'day' && !isNaN(dayRaw) ? String(dayRaw) : '',
    };
  }
  // Surmakoht — rakenda sõltumata sellest kas kuupäev on olemas
  if (autoFilled['death.place']?.label && !draft.death.place) {
    const dp = autoFilled['death.place'];
    patch.death = { ...(patch.death ?? draft.death), place: { label: dp.label, id: dp.id ?? null, labels: dp.labels ?? null, source: 'wikidata' as const } };
  }

  // Konfessioon — lisa auto-täidetud Q-kood massiivi kui veel puudub
  if (autoFilled['confession']?.id && !(draft.confessions ?? []).includes(autoFilled['confession'].id)) {
    patch.confessions = [...(draft.confessions ?? []), autoFilled['confession'].id];
  }

  // Seisus
  if (autoFilled['status']?.id && !(draft.statuses ?? []).includes(autoFilled['status'].id)) {
    patch.statuses = [...(draft.statuses ?? []), autoFilled['status'].id];
  }

  // Ametid — uus vorming (_occupations massiiv), GND tagasiühilduvus (_occupation_label)
  if (autoFilled['_occupations']?.length && draft.occupations.length === 0) {
    patch.occupations = autoFilled['_occupations'].map((o: any) => ({
      label: o.label,
      id: o.id ?? null,
      labels: o.labels ?? undefined,
    }));
  } else if (autoFilled['_occupation_label'] && draft.occupations.length === 0) {
    patch.occupations = [{ label: autoFilled['_occupation_label'] }];
  }

  // Biograafia (AA raw_text) — ainult kui tühi
  if (autoFilled['biography'] && !draft.biography.trim()) {
    patch.biography = autoFilled['biography'];
  }

  // Päritolukoht AA-st
  if (autoFilled['_aa_origin'] && !draft.origin_place) {
    patch.origin_place = autoFilled['_aa_origin'];
  }

  // Haridustee AA-st: lisa puuduvad kirjed (institution järgi dedup)
  if (autoFilled['_aa_education']?.length) {
    const existingInst = new Set(draft.education.map((e: any) => (e.institution || '').toLowerCase()));
    const newEntries: EducationDraft[] = (autoFilled['_aa_education'] as any[])
      .filter(e => !existingInst.has((e.institution || '').toLowerCase()))
      .map(e => ({
        institution: e.institution,
        institution_id: null,
        edu_type: e.edu_type ?? '',
        source: e.source ?? 'album_academicum',
        date_from: e.date_from ? {
          year: e.date_from.date?.slice(0, 4) ?? '',
          month: e.date_from.precision !== 'year' ? String(parseInt(e.date_from.date?.slice(5, 7) ?? '0')) : '',
          day: e.date_from.precision === 'day' ? String(parseInt(e.date_from.date?.slice(8, 10) ?? '0')) : '',
          circa: false,
          bound: '',
          calendar: '' as any,
          place: null,
        } : undefined,
      }));
    if (newEntries.length > 0) {
      patch.education = [...draft.education, ...newEntries];
    }
  }

  return { ...draft, ...patch };
}

export function recordToDraft(p: ProsopoRecord): FormDraft {
  const ident = (scheme: string) =>
    p.identifiers?.find(i => i.scheme === scheme)?.id ?? '';
  return {
    name_label: p.name.label ?? '',
    name_family: p.name.family_name ?? '',
    name_first: p.name.first_name ?? '',
    name_qualifier: p.name.qualifier ?? '',
    name_aliases: p.name.aliases ?? [],
    gender: p.gender ?? '',
    // Sama teisendus mis haridus-/ametikuupäevadel — sh `0000` tühjaks (#240)
    birth: p.birth ? historicalDateToDraft(p.birth) : emptyDateDraft(),
    death: p.death ? historicalDateToDraft(p.death) : emptyDateDraft(),
    floruit_from: p.floruit?.year_from ? String(p.floruit.year_from) : '',
    floruit_to: p.floruit?.year_to ? String(p.floruit.year_to) : '',
    statuses: (p.statuses ?? []).map(s => s.id).filter(Boolean) as string[],
    confessions: (p.confessions ?? []).map(c => c.id).filter(Boolean) as string[],
    occupations: (p.occupations ?? []).map((o: any) => ({
      label: o.label ?? String(o), id: o.id ?? null, labels: o.labels ?? undefined,
      institution: o.institution ?? '', institution_id: o.institution_id ?? null, institution_labels: o.institution_labels ?? undefined,
      date_from: o.date_from ? historicalDateToDraft(o.date_from)
        : (o.year_from ? { ...emptyDateDraft(), year: String(o.year_from) }
        : (o.year ? { ...emptyDateDraft(), year: String(o.year) } : emptyDateDraft())),
      date_to: o.date_to ? historicalDateToDraft(o.date_to)
        : (o.year_to ? { ...emptyDateDraft(), year: String(o.year_to) } : emptyDateDraft()),
    })),
    education: (p.education ?? []).map((e: any) => ({
      institution: e.institution ?? e.label ?? String(e),
      institution_id: e.institution_id ?? null, institution_labels: e.institution_labels ?? undefined,
      date_from: e.date_from ? historicalDateToDraft(e.date_from)
        : (e.date_start ? isoStringToDraft(e.date_start)
        : (e.year_from ? { ...emptyDateDraft(), year: String(e.year_from) }
        : (e.year ? { ...emptyDateDraft(), year: String(e.year) } : emptyDateDraft()))),
      date_to: e.date_to ? historicalDateToDraft(e.date_to)
        : (e.date_end ? isoStringToDraft(e.date_end)
        : (e.year_to ? { ...emptyDateDraft(), year: String(e.year_to) } : emptyDateDraft())),
      edu_type: e.type ?? undefined,
      source: e.source ?? undefined,
    })),
    tags: (p.tags ?? []).map((t: any) => ({ label: t.label ?? String(t), id: t.id ?? null, labels: t.labels ?? undefined })),
    relations: (p.relations ?? []).map((r: any) => ({
      name: r.name ?? '',
      type: r.type ?? '',
      type_id: r.type_id ?? null,
      type_labels: r.type_labels ?? null,
      target_id: r.target_id ?? null,
      reciprocal_auto: r.reciprocal_auto ?? undefined,
    })),
    sources: (p.sources ?? []).map((s: any) => ({ text: s.text ?? String(s), note: s.note ?? '' })),
    biography: p.biography ?? '',
    notes: p.notes ?? '',
    wikidata_id: ident('wikidata'),
    gnd_id: ident('gnd'),
    viaf_id: ident('viaf'),
    aa_id: ident('album_academicum'),
    origin_place: p.origin?.place ?? '',
  };
}

export function buildDatePayload(d: DateDraft): any {
  const hasData = !!(d.year || d.place || d.circa || d.bound || d.calendar);
  if (!hasData) return null;
  const y = d.year ? d.year.padStart(4, '0') : null;
  const m = d.month ? d.month.padStart(2, '0') : '01';
  const day = d.day ? d.day.padStart(2, '0') : '01';
  const precision = d.day && d.month ? 'day' : d.month ? 'month' : d.year ? 'year' : null;
  return {
    original_text: null,
    date: y ? `${y}-${m}-${day}` : null,
    date_to: null,
    bound: d.bound || null,
    precision,
    calendar: d.calendar || null,
    is_circa: d.circa,
    place: d.place?.label ? { id: d.place.id ?? null, label: d.place.label, labels: d.place.labels ?? null } : null,
    notes: null,
  };
}

export function draftToPayload(
  draft: FormDraft,
  original?: ProsopoRecord,
  seisusedVocab: VocabularySeisusItem[] = [],
  konfessioonidVocab: VocabularySeisusItem[] = [],
): Partial<ProsopoRecord> {
  // Identifikaatorid — säilita olemasolevad, uuenda/lisa muudetud
  const existing = original?.identifiers ?? [];
  const schemes: { scheme: string; key: keyof FormDraft }[] = [
    { scheme: 'wikidata', key: 'wikidata_id' },
    { scheme: 'gnd', key: 'gnd_id' },
    { scheme: 'viaf', key: 'viaf_id' },
    { scheme: 'album_academicum', key: 'aa_id' },
  ];
  const identifiers = schemes
    .map(({ scheme, key }) => {
      // Kanooniline kuju kõigile skeemidele — vt utils/externalIds.ts (#240)
      const val = normalizeExtId(scheme, draft[key] as string);
      if (!val) return null;
      const found = existing.find(i => i.scheme === scheme);
      return { scheme, id: val, checked_at: found?.checked_at ?? null };
    })
    .filter(Boolean) as ProsopoRecord['identifiers'];

  return {
    name: {
      label: draft.name_label.trim(),
      family_name: draft.name_family.trim() || null,
      first_name: draft.name_first.trim() || null,
      qualifier: draft.name_qualifier.trim() || null,
      qualifier_type: original?.name?.qualifier_type ?? null,
      noble_status: original?.name?.noble_status ?? null,
      maiden_name: original?.name?.maiden_name ?? null,
      aliases: draft.name_aliases.filter(Boolean),
      family_name_variants: original?.name?.family_name_variants ?? [],
      first_name_variants: original?.name?.first_name_variants ?? [],
    },
    gender: (draft.gender || null) as 'M' | 'F' | null,
    // EI tohi langeda tagasi `original`-ile: tühi mustand ON kustutamise soov.
    // Varem taastas `?? original.birth` vana väärtuse, nii et ainus viis välja
    // tühjendada oli kirjutada sinna `0000` (#240).
    birth: buildDatePayload(draft.birth),
    death: buildDatePayload(draft.death),
    statuses: (draft.statuses ?? []).map(qId => {
      const vocabItem = seisusedVocab.find(s => s.id === qId);
      // Salvesta mitmekeelne labels-objekt → useEntityLabel kuvab UI-keeles
      return { id: qId, label: vocabItem?.label?.et ?? qId, labels: vocabItem?.label };
    }),
    confessions: (draft.confessions ?? []).map(qId => {
      const vocabItem = konfessioonidVocab.find(k => k.id === qId);
      return { id: qId, label: vocabItem?.label?.et ?? qId, labels: vocabItem?.label };
    }),
    origin: {
      place: draft.origin_place || null,
      geonames_id: original?.origin?.geonames_id ?? null,
      coordinates: original?.origin?.coordinates ?? null,
    },
    floruit: (draft.floruit_from || draft.floruit_to) ? {
      year_from: draft.floruit_from ? parseInt(draft.floruit_from) : null,
      year_to: draft.floruit_to ? parseInt(draft.floruit_to) : null,
    } : null,
    occupations: draft.occupations.filter(o => o.label.trim()).map(o => ({
      label: o.label.trim(),
      ...(o.id ? { id: o.id } : {}),
      ...(o.labels ? { labels: o.labels } : {}),
      ...(o.institution?.trim() ? { institution: o.institution.trim() } : {}),
      ...(o.institution_id ? { institution_id: o.institution_id } : {}),
      ...(o.institution_labels ? { institution_labels: o.institution_labels } : {}),
      ...(o.date_from?.year?.trim() ? { date_from: buildDatePayload(o.date_from) } : {}),
      ...(o.date_to?.year?.trim() ? { date_to: buildDatePayload(o.date_to) } : {}),
    })),
    education: draft.education.filter(e => e.institution.trim()).map(e => ({
      institution: e.institution.trim(),
      ...(e.institution_id ? { institution_id: e.institution_id } : {}),
      ...(e.institution_labels ? { institution_labels: e.institution_labels } : {}),
      ...(e.date_from?.year?.trim() ? { date_from: buildDatePayload(e.date_from) } : {}),
      ...(e.date_to?.year?.trim() ? { date_to: buildDatePayload(e.date_to) } : {}),
      ...(e.edu_type ? { type: e.edu_type } : {}),
      ...(e.source ? { source: e.source } : {}),
    })),
    tags: draft.tags.filter(t => t.label.trim()).map(t => ({
      label: t.label.trim(),
      ...(t.id ? { id: t.id } : {}),
      ...(t.labels ? { labels: t.labels } : {}),
    })) as any,
    relations: draft.relations.filter(r => r.name.trim() || r.target_id).map(r => ({
      name: r.name.trim(),
      ...(r.type.trim() ? { type: r.type.trim() } : {}),
      ...(r.type_id && isQCode(r.type_id) ? { type_id: r.type_id } : {}),
      ...(r.type_labels ? { type_labels: r.type_labels } : {}),
      ...(r.target_id ? { target_id: r.target_id } : {}),
      ...(r.reciprocal_auto !== undefined ? { reciprocal_auto: r.reciprocal_auto } : {}),
    })),
    sources: draft.sources.filter(s => s.text.trim()).map(s => ({
      text: s.text.trim(),
      ...(s.note.trim() ? { note: s.note.trim() } : {}),
    })),
    biography: draft.biography.trim() || null,
    notes: draft.notes.trim() || null,
    identifiers,
    ...(original ? { updated_at: original.updated_at } : {}),
  };
}
