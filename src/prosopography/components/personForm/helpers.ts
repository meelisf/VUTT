import type { ProsopoRecord } from '../../types';
import type { FormDraft, DateDraft } from './types';

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
    birth: {
      year: p.birth?.date ? p.birth.date.slice(0, 4) : '',
      month: p.birth?.date && p.birth.precision !== 'year' ? String(parseInt(p.birth.date.slice(5, 7))) : '',
      day: p.birth?.date && p.birth.precision === 'day' ? String(parseInt(p.birth.date.slice(8, 10))) : '',
      circa: p.birth?.is_circa ?? false,
      bound: p.birth?.bound ?? '',
      calendar: (p.birth?.calendar ?? '') as DateDraft['calendar'],
      place: p.birth?.place?.label ?? '',
    },
    death: {
      year: p.death?.date ? p.death.date.slice(0, 4) : '',
      month: p.death?.date && p.death.precision !== 'year' ? String(parseInt(p.death.date.slice(5, 7))) : '',
      day: p.death?.date && p.death.precision === 'day' ? String(parseInt(p.death.date.slice(8, 10))) : '',
      circa: p.death?.is_circa ?? false,
      bound: p.death?.bound ?? '',
      calendar: (p.death?.calendar ?? '') as DateDraft['calendar'],
      place: p.death?.place?.label ?? '',
    },
    origin_city: p.origin?.city ? { label: p.origin.city, id: p.origin.city_id ?? null, labels: p.origin.city_labels ?? null, source: 'wikidata' } : null,
    origin_region: p.origin?.region ? { label: p.origin.region, id: p.origin.region_id ?? null, labels: p.origin.region_labels ?? null, source: 'wikidata' } : null,
    floruit_from: p.floruit?.year_from ? String(p.floruit.year_from) : '',
    floruit_to: p.floruit?.year_to ? String(p.floruit.year_to) : '',
    status: p.status ? { label: p.status.label, id: p.status.id, labels: (p.status as any).labels ?? null, source: 'wikidata' } : null,
    confession: p.confession ? { label: p.confession.label, id: p.confession.id, labels: (p.confession as any).labels ?? null, source: 'wikidata' } : null,
    occupations: (p.occupations ?? []).map((o: any) => ({
      label: o.label ?? String(o), id: o.id ?? null, labels: o.labels ?? undefined,
      institution: o.institution ?? '', institution_id: o.institution_id ?? null, institution_labels: o.institution_labels ?? undefined,
      year_from: o.year_from ? String(o.year_from) : (o.year ? String(o.year) : ''),
      year_to: o.year_to ? String(o.year_to) : '',
    })),
    education: (p.education ?? []).map((e: any) => ({
      institution: e.institution ?? e.label ?? String(e),
      institution_id: e.institution_id ?? null, institution_labels: e.institution_labels ?? undefined,
      year_from: e.year_from ? String(e.year_from) : (e.year ? String(e.year) : ''),
      year_to: e.year_to ? String(e.year_to) : '',
    })),
    tags: (p.tags ?? []).map((t: any) => ({ label: t.label ?? String(t), id: t.id ?? null, labels: t.labels ?? undefined })),
    relations: (p.relations ?? []).map((r: any) => ({ name: r.name ?? '', type: r.type ?? '', target_id: r.target_id ?? null })),
    sources: (p.sources ?? []).map((s: any) => ({ text: s.text ?? String(s), note: s.note ?? '' })),
    biography: p.biography ?? '',
    notes: p.notes ?? '',
    wikidata_id: ident('wikidata'),
    gnd_id: ident('gnd'),
    viaf_id: ident('viaf'),
    aa_id: ident('album_academicum'),
  };
}

export function buildDatePayload(d: DateDraft): any {
  if (!d.year) return null;
  const y = d.year.padStart(4, '0');
  const m = d.month ? d.month.padStart(2, '0') : '01';
  const day = d.day ? d.day.padStart(2, '0') : '01';
  const precision = d.day && d.month ? 'day' : d.month ? 'month' : 'year';
  return {
    original_text: null,
    date: `${y}-${m}-${day}`,
    date_to: null,
    bound: d.bound || null,
    precision,
    calendar: d.calendar || null,
    is_circa: d.circa,
    place: d.place ? { id: null, label: d.place } : null,
    notes: null,
  };
}

export function draftToPayload(draft: FormDraft, original?: ProsopoRecord): Partial<ProsopoRecord> {
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
      const val = (draft[key] as string).trim();
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
    birth: buildDatePayload(draft.birth) ?? (original?.birth ?? null as any),
    death: buildDatePayload(draft.death) ?? (original?.death ?? null as any),
    status: draft.status
      ? { id: draft.status.id || draft.status.label, label: draft.status.label, ...(draft.status.labels ? { labels: draft.status.labels } : {}) }
      : null,
    confession: draft.confession
      ? { id: draft.confession.id || draft.confession.label, label: draft.confession.label, ...(draft.confession.labels ? { labels: draft.confession.labels } : {}) }
      : null,
    origin: {
      city: draft.origin_city?.label ?? null,
      city_id: draft.origin_city?.id ?? null,
      city_labels: draft.origin_city?.labels ?? null,
      region: draft.origin_region?.label ?? null,
      region_id: draft.origin_region?.id ?? null,
      region_labels: draft.origin_region?.labels ?? null,
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
      ...(o.year_from?.trim() ? { year_from: parseInt(o.year_from) } : {}),
      ...(o.year_to?.trim() ? { year_to: parseInt(o.year_to) } : {}),
    })),
    education: draft.education.filter(e => e.institution.trim()).map(e => ({
      institution: e.institution.trim(),
      ...(e.institution_id ? { institution_id: e.institution_id } : {}),
      ...(e.institution_labels ? { institution_labels: e.institution_labels } : {}),
      ...(e.year_from?.trim() ? { year_from: parseInt(e.year_from) } : {}),
      ...(e.year_to?.trim() ? { year_to: parseInt(e.year_to) } : {}),
    })),
    tags: draft.tags.filter(t => t.label.trim()).map(t => ({
      label: t.label.trim(),
      ...(t.id ? { id: t.id } : {}),
      ...(t.labels ? { labels: t.labels } : {}),
    })) as any,
    relations: draft.relations.filter(r => r.name.trim() || r.target_id).map(r => ({
      name: r.name.trim(),
      ...(r.type.trim() ? { type: r.type.trim() } : {}),
      ...(r.target_id ? { target_id: r.target_id } : {}),
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
