import React, { useState, useEffect } from 'react';
import { isAtLeast } from '../../utils/roleUtils';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MarkdownView from '../../components/MarkdownView';
import {
  ArrowLeft, ExternalLink, Edit3, ChevronDown, ChevronRight,
  BookOpen, User, BookMarked, Users, StickyNote, Map, History, RotateCcw, Lock,
} from 'lucide-react';
import { isQCode } from '../../utils/qcodeUtils';
import { formatYearDisplay, parseYearDisplayRange } from '../../utils/yearDisplayUtils';
import Header from '../../components/Header';
import { getPerson, updatePerson, fetchPersonHistory, fetchPersonDiff, restorePerson, getWorkTitles } from '../services/prosopographyService';
import EntityPicker from '../../components/EntityPicker';
import { useUser } from '../../contexts/UserContext';
import { useCollection } from '../../contexts/CollectionContext';
import { useMeiliIndex } from '../../contexts/MeilisearchContext';
import { getCollectionColorClasses } from '../../services/collectionService';
import type { ProsopoRecord, HistoricalDate } from '../types';
import WorkRelationsCard from '../components/WorkRelationsCard';

// =========================================================
// Abifunktsioonid
// =========================================================

function formatHistoricalDate(
  d: HistoricalDate | null | undefined,
  symbol: string,
  boundLabels: { before: string; after: string },
  lang: string = 'et',
): string {
  if (!d) return '';
  const year = d.date ? d.date.slice(0, 4) : null;
  if (!year) return '';
  const circa = d.is_circa ? '~' : '';
  const bound = d.bound === 'before' ? `${boundLabels.before} ` : d.bound === 'after' ? `${boundLabels.after} ` : '';
  const historical = d.place?.label || '';
  const modern = d.place?.labels
    ? (d.place.labels[lang] ?? d.place.labels['et'] ?? d.place.labels['en'] ?? Object.values(d.place.labels)[0] ?? '')
    : '';
  const placeStr = historical
    ? (modern && modern !== historical ? `${historical} (${modern})` : historical)
    : '';
  const place = placeStr ? `, ${placeStr}` : '';
  return `${symbol}${bound}${circa}${year}${place}`;
}

function formatImmDate(dateStr: string | null | undefined, lang: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y) return '';
  if (!m) return String(y);
  try {
    const date = new Date(y, m - 1, d || 1);
    const opts: Intl.DateTimeFormatOptions = d
      ? { day: 'numeric', month: 'long', year: 'numeric' }
      : { month: 'long', year: 'numeric' };
    return date.toLocaleDateString(lang === 'et' ? 'et-EE' : 'en-GB', opts);
  } catch {
    return dateStr;
  }
}

function getEducationDate(education: any): string {
  return education?.date_from?.date ?? education?.date_start ?? '';
}

function earliestDatedEducation(entries: any[]): any | null {
  return entries
    .filter(e => getEducationDate(e).slice(0, 4).match(/^\d{4}$/))
    .sort((a, b) => getEducationDate(a).localeCompare(getEducationDate(b)))[0] ?? null;
}

function getExternalUrl(scheme: string, id: string): string | null {
  if (scheme === 'wikidata')        return `https://www.wikidata.org/wiki/${id}`;
  if (scheme === 'gnd')             return `https://d-nb.info/gnd/${id}`;
  if (scheme === 'viaf')            return `https://viaf.org/viaf/${id}`;
  if (scheme === 'album_academicum') return null;
  return null;
}

function getExternalLabel(scheme: string): string {
  const m: Record<string, string> = { wikidata: 'Wikidata', gnd: 'GND', viaf: 'VIAF', album_academicum: 'AA' };
  return m[scheme] ?? scheme.toUpperCase();
}

// =========================================================
// Kaardi päis — identne AnnotationsTab stiiliga
// =========================================================
const CardHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  count?: number;
  action?: React.ReactNode;
}> = ({ icon, title, count, action }) => (
  <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
    <span className="text-primary-600">{icon}</span>
    <h4 className="font-bold">{title}</h4>
    {count !== undefined && (
      <span className="text-xs text-gray-400 font-normal">({count})</span>
    )}
    {action && <div className="ml-auto">{action}</div>}
  </div>
);

// =========================================================
// Struktureeritud info (klapitav kaart)
// =========================================================
// Tagastab LinkedEntity labeli aktiivses keeles
const useEntityLabel = () => {
  const { i18n } = useTranslation();
  return (entity: any): string => {
    if (!entity) return '';
    const lang = i18n.language?.slice(0, 2) ?? 'et';
    return entity.labels?.[lang] || entity.labels?.en || entity.label || '';
  };
};

const StructuredInfoCard: React.FC<{ person: ProsopoRecord }> = ({ person }) => {
  const { t, i18n } = useTranslation(['prosopography', 'common']);
  const lang = i18n.language?.slice(0, 2) ?? 'et';
  const getLabel = useEntityLabel();
  const [open, setOpen] = useState(true);

  const rows: { label: string; value: React.ReactNode }[] = [];

  if (person.gender) {
    rows.push({
      label: t('filterGenderAll', 'Sugu'),
      value: person.gender === 'M'
        ? t('filterMale', 'Meessoost')
        : t('filterFemale', 'Naissoost'),
    });
  }
  if (person.origin?.place) {
    const modernOrigin = person.origin.place_labels
      ? (person.origin.place_labels[lang] ?? person.origin.place_labels['et'] ?? person.origin.place_labels['en'] ?? Object.values(person.origin.place_labels)[0] ?? '')
      : '';
    rows.push({
      label: t('origin', 'Päritolu'),
      value: modernOrigin && modernOrigin !== person.origin.place
        ? `${person.origin.place} (${modernOrigin})`
        : person.origin.place,
    });
  }
  if ((person.confessions?.length ?? 0) > 0) {
    rows.push({
      label: t('confession', 'Konfessioon'),
      value: (person.confessions ?? []).map(c => getLabel(c) || c.label).filter(Boolean).join(', '),
    });
  }
  const aliases = person.name.aliases ?? [];
  if (aliases.length > 0) {
    rows.push({ label: t('aliases', 'Nimevariandid'), value: aliases.join(', ') });
  }
  if (person.occupations?.length > 0) {
    rows.push({
      label: t('occupations', 'Ametid'),
      value: person.occupations.map((o: any) => getLabel(o) || o).join(', '),
    });
  }
  if (person.education?.length > 0) {
    rows.push({
      label: t('education', 'Haridus'),
      value: person.education.map((e: any) => {
        const loc = e.institution_labels
          ? (e.institution_labels[lang] ?? e.institution_labels['en'] ?? e.institution_labels['et'])
          : null;
        return loc || e.institution || getLabel(e) || e;
      }).join(', '),
    });
  }
  if (person.relations?.length > 0) {
    rows.push({
      label: t('relations', 'Seosed'),
      value: (
        <span>
          {person.relations.map((r: any, i: number) => {
            const typeLabel = r.type_labels?.[lang] ?? r.type_labels?.en ?? r.type ?? '';
            const displayName = r.name ?? r.target_id;
            return (
              <span key={i}>
                {i > 0 && ', '}
                {r.target_id
                  ? <Link to={`/persons/${r.target_id}`} className="underline hover:text-gray-700">{displayName}</Link>
                  : displayName
                }
                {typeLabel ? ` (${typeLabel})` : ''}
              </span>
            );
          })}
        </span>
      ),
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 mb-0 text-gray-800 hover:text-primary-700 transition-colors"
      >
        <span className="text-primary-600">
          <Users size={18} />
        </span>
        <span className="font-bold">{t('structuredInfo', 'Struktureeritud info')}</span>
        <span className="ml-auto text-gray-400">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </button>

      {open && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            {rows.map(({ label, value }) => (
              <div key={label} className={typeof value === 'string' && value.length > 40 ? 'col-span-2' : ''}>
                <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{label}</span>
                <p className="text-gray-900">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// =========================================================
// PersonDetailPage
// =========================================================
const PersonDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const backTo: string = (location.state as any)?.from ?? '/persons';
  const { t, i18n } = useTranslation(['prosopography', 'common']);
  const getLabel = useEntityLabel();
  const lang = i18n.language?.slice(0, 2) ?? 'et';
  const { user, authToken } = useUser();
  const { selectedCollection, collections } = useCollection();
  const index = useMeiliIndex();

  const [person, setPerson] = useState<ProsopoRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workTitles, setWorkTitles] = useState<Record<string, { title: string; year: number | null; year_display: string | null; collections: string[]; restricted?: boolean }>>({});
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(30);
  const [tagsSaving, setTagsSaving] = useState(false);

  const token = authToken ?? '';
  const canEdit = isAtLeast(user?.role, 'editor');
  const isAdmin = isAtLeast(user?.role, 'admin');

  const [history, setHistory] = useState<{ hash: string; full_hash: string; author: string; formatted_date: string; message: string; is_original: boolean }[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [diffCache, setDiffCache] = useState<Record<string, { field: string; old: unknown; new: unknown }[] | 'error'>>({});
  const [restoring, setRestoring] = useState<string | null>(null);

  const loadHistory = async () => {
    if (!id || !token || historyLoading) return;
    setHistoryLoading(true);
    try {
      const h = await fetchPersonHistory(id, token);
      setHistory(h);
      setHistoryOpen(true);
    } catch (e) {
      console.error('Ajaloo laadimine ebaõnnestus:', e);
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadDiff = async (commitHash: string) => {
    if (!id || !token || diffCache[commitHash]) return;
    try {
      const changes = await fetchPersonDiff(id, commitHash, token);
      setDiffCache(prev => ({ ...prev, [commitHash]: changes }));
    } catch (e) {
      console.error('Diff laadimine ebaõnnestus:', e);
      setDiffCache(prev => ({ ...prev, [commitHash]: 'error' }));
    }
  };

  const handleRestore = async (commitHash: string) => {
    if (!id || !token) return;
    if (!window.confirm('Kas oled kindel, et soovid taastada selle versiooni?')) return;
    setRestoring(commitHash);
    try {
      await restorePerson(id, commitHash, token);
      window.location.reload();
    } catch (e) {
      console.error('Taastamine ebaõnnestus:', e);
      alert('Taastamine ebaõnnestus');
    } finally {
      setRestoring(null);
    }
  };

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getPerson(id, token)
      .then(data => {
        setPerson(data);
        setError(null);
        const uniqueWorkIds = [...new Set((data.works ?? []).map((w: { work_id: string }) => w.work_id).filter(Boolean))];
        if (uniqueWorkIds.length > 0 && index) {
          // Teoste pealkirjad: päri partiidena (max 50 korraga), et vältida Meilisearch IN-filtri piiranguid
          const BATCH = 50;
          const allHits: any[] = [];
          const batches = [];
          for (let i = 0; i < uniqueWorkIds.length; i += BATCH) batches.push(uniqueWorkIds.slice(i, i + BATCH));
          Promise.all(batches.map(batch => {
            const ids = batch.map((wid: string) => `"${wid}"`).join(', ');
            return index.search('', {
              filter: `work_id IN [${ids}] AND lehekylje_number = 1`,
              attributesToRetrieve: ['work_id', 'title', 'year', 'year_display', 'collections_hierarchy'],
              limit: BATCH,
            }).then(res => allHits.push(...res.hits)).catch(() => {});
          })).then(async () => {
            const map: Record<string, { title: string; year: number | null; year_display: string | null; collections: string[]; restricted?: boolean }> = {};
            for (const hit of allHits) {
              if (hit.work_id && !map[hit.work_id]) {
                map[hit.work_id] = { title: hit.title ?? hit.work_id, year: hit.year ?? null, year_display: hit.year_display ?? null, collections: hit.collections_hierarchy ?? [] };
              }
            }
            // Kaitstud kollektsiooni teoseid Meilisearch ei tagasta (anon/õiguseta) —
            // küsi pealkirjad serverist, et neidki kuvada (lingita, märkega "kaitstud").
            const missing = uniqueWorkIds.filter((wid: string) => !map[wid]);
            if (missing.length > 0) {
              const fallback = await getWorkTitles(missing, token);
              for (const [wid, info] of Object.entries(fallback)) {
                map[wid] = { title: info.title || wid, year: info.year, year_display: null, collections: [], restricted: info.restricted };
              }
            }
            setWorkTitles(map);
          });
        }
      })
      .catch(() => setError(t('loadError', 'Isiku laadimine ebaõnnestus.')))
      .finally(() => setLoading(false));
  }, [id, token, index]);

  // ── Loading ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-4">
          <div className="h-5 w-40 bg-gray-200 rounded animate-pulse" />
          <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm space-y-3">
            <div className="h-5 w-32 bg-gray-200 rounded animate-pulse" />
            <div className="border-t border-gray-100 pt-4 space-y-2">
              <div className="h-7 w-2/3 bg-gray-200 rounded animate-pulse" />
              <div className="h-4 w-1/2 bg-gray-100 rounded animate-pulse" />
              <div className="h-4 w-1/3 bg-gray-100 rounded animate-pulse" />
            </div>
          </div>
          <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm space-y-2">
            <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
            <div className="border-t border-gray-100 pt-4 space-y-2">
              {[90, 80, 70, 85, 60].map((w, i) => (
                <div key={i} className="h-3 bg-gray-100 rounded animate-pulse" style={{ width: `${w}%` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────
  if (error || !person) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
          <p className="text-red-600 text-sm mb-4">{error ?? t('notFound', 'Isikut ei leitud.')}</p>
          <button onClick={() => navigate(backTo)} className="text-primary-600 hover:underline text-sm">
            ← {t('backToList', 'Tagasi isikute nimekirja')}
          </button>
        </div>
      </div>
    );
  }

  // ── Andmed ───────────────────────────────────────────────
  const boundLabels = { before: t('dateField.beforeShort'), after: t('dateField.afterShort') };
  const birth = formatHistoricalDate(person.birth, '*', boundLabels, lang);
  const death = formatHistoricalDate(person.death, '†', boundLabels, lang);
  // Sorteerimisaasta: number-väli, muidu year_display vahemiku keskpaik (nt "ca. 1750", "19. saj")
  const sortYear = (workId: string): number => {
    const meta = workTitles[workId];
    if (meta?.year) return meta.year;
    const range = parseYearDisplayRange(null, meta?.year_display);
    return range ? Math.floor((range.start + range.end) / 2) : 9999;
  };
  const works: { work_id: string; role: string }[] = [...(person.works ?? [])].sort(
    (a, b) => sortYear(a.work_id) - sortYear(b.work_id)
  );
  const identifiers = (person.identifiers ?? []).filter(i => i.id);

  const uniqueRoles = [...new Set(works.map(w => w.role))];
  const filteredWorks = selectedRole ? works.filter(w => w.role === selectedRole) : works;
  const displayedWorks = filteredWorks.slice(0, visibleCount);
  const relationMapUrl = `/persons?view=map&related_to=${encodeURIComponent(person.id)}`;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">

        {/* Tagasi */}
        <button
          onClick={() => navigate(backTo)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-primary-600 transition-colors mb-4"
        >
          <ArrowLeft size={15} />
          {t('backToList', 'Tagasi isikute nimekirja')}
        </button>

        {/* ── Isiku info ── */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
          <CardHeader
            icon={<User size={18} />}
            title={person.name.label}
            action={(
              <div className="flex items-center gap-2">
                <Link
                  to={relationMapUrl}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded text-gray-500 hover:text-primary-700 hover:bg-primary-50 border border-gray-200 hover:border-primary-200 transition-colors"
                >
                  <Map size={12} />
                  {t('map.showRelations', 'Seoste kaart')}
                </Link>
                {canEdit && (
                  <Link
                    to={`/persons/${id}/edit`}
                    state={{ from: backTo }}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded text-gray-500 hover:text-primary-700 hover:bg-primary-50 border border-gray-200 hover:border-primary-200 transition-colors"
                  >
                    <Edit3 size={12} />
                    {t('edit', 'Muuda')}
                  </Link>
                )}
              </div>
            )}
          />

          <div className="flex gap-4">
            {/* Portreepilt */}
            {(person as any).image_url && (
              <div className="shrink-0">
                <img
                  src={(person as any).image_url}
                  alt={person.name.label}
                  className="w-20 h-28 object-cover object-top rounded border border-gray-200"
                />
              </div>
            )}

            <div className="flex-1 space-y-3 text-sm">
            {/* Eluaastad */}
            {(birth || death) && (
              <div className="grid grid-cols-2 gap-4">
                {birth && (
                  <div>
                    <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">
                      {t('born', 'Sündinud')}
                    </span>
                    <p className="text-gray-900">{birth.replace('*', '')}</p>
                  </div>
                )}
                {death && (
                  <div>
                    <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">
                      {t('died', 'Surnud')}
                    </span>
                    <p className="text-gray-900">{death.replace('†', '')}</p>
                  </div>
                )}
              </div>
            )}

            {/* Immatrikuleerumine (AG) */}
            {(() => {
              const agNames = new Set(['Academia Gustaviana', 'Academia Gustavo-Carolina']);
              const immEdu =
                earliestDatedEducation((person.education ?? []).filter(e => agNames.has(e.institution))) ??
                earliestDatedEducation((person.education ?? []).filter(e => e.source === 'album_academicum'));
              const aaId = (person.identifiers ?? []).find(i => i.scheme === 'album_academicum')?.id;
              if (!immEdu && !aaId) return null;
              const dateLabel = immEdu ? formatImmDate(getEducationDate(immEdu), lang) : null;
              return (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">
                      {t('immatriculation', 'Immatrikuleerumine')}
                    </span>
                    <p className="text-gray-900">{dateLabel ?? '—'}</p>
                  </div>
                  {aaId && (
                    <div>
                      <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">
                        Album Academicum
                      </span>
                      <p className="text-gray-900 font-mono text-sm">{aaId}</p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Seisus + konfessioon */}
            {((person.statuses?.length ?? 0) > 0 || (person.confessions?.length ?? 0) > 0) && (
              <div className="grid grid-cols-2 gap-4">
                {(person.statuses?.length ?? 0) > 0 && (
                  <div>
                    <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">
                      {t('statuses', 'Seisused')}
                    </span>
                    <p className="text-gray-900">
                      {(person.statuses ?? []).map(s => getLabel(s) || s.label).filter(Boolean).join(', ')}
                    </p>
                  </div>
                )}
                {(person.confessions?.length ?? 0) > 0 && (
                  <div>
                    <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">
                      {t('confession', 'Konfessioon')}
                    </span>
                    <p className="text-gray-900">
                      {(person.confessions ?? []).map(c => getLabel(c) || c.label).filter(Boolean).join(', ')}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Välised ID-d */}
            {identifiers.length > 0 && (
              <div className="pt-2 border-t border-gray-100">
                <div className="flex flex-wrap gap-2">
                  {identifiers.map(({ scheme, id: extId }) => {
                    const url = getExternalUrl(scheme, extId);
                    const label = getExternalLabel(scheme);
                    return url ? (
                      <a
                        key={scheme}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100 transition-colors"
                        title={extId}
                      >
                        {label}
                        <ExternalLink size={10} />
                      </a>
                    ) : (
                      <span
                        key={scheme}
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600 border border-gray-200"
                        title={extId}
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            </div> {/* flex-1 */}
          </div> {/* flex gap-4 */}

          {/* ── Märksõnad ── */}
          {(canEdit || (person.tags ?? []).length > 0) && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <span className="text-gray-500 block text-xs uppercase tracking-wide mb-2">
                {t('tags', 'Märksõnad')}
                {tagsSaving && <span className="ml-2 text-gray-400 normal-case font-normal">…</span>}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {(person.tags ?? []).map((tag: any, i: number) => {
                  const label = tag.labels?.[lang] ?? tag.labels?.en ?? tag.label;
                  const url = tag.id && isQCode(tag.id) ? `https://www.wikidata.org/wiki/${tag.id}` : null;
                  return (
                    <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-gray-100 text-gray-700 border border-gray-200 rounded">
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          className="hover:text-primary-700 transition-colors">
                          {label}
                        </a>
                      ) : label}
                      {canEdit && (
                        <button
                          onClick={async () => {
                            const newTags = (person.tags ?? []).filter((_: any, j: number) => j !== i);
                            setPerson({ ...person, tags: newTags });
                            setTagsSaving(true);
                            try { await updatePerson(person.id, { tags: newTags, updated_at: person.updated_at } as any, token); }
                            catch { setPerson({ ...person }); }
                            finally { setTagsSaving(false); }
                          }}
                          className="text-gray-400 hover:text-red-500 transition-colors ml-0.5"
                        >
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
              {canEdit && (
                <div className="mt-2">
                  <EntityPicker
                    placeholder={t('tagsList.add', 'Lisa märksõna…')}
                    type="topic"
                    value={null}
                    onChange={async v => {
                      if (!v?.label?.trim()) return;
                      const newTag = { label: v.label, ...(v.id ? { id: v.id } : {}), ...(v.labels ? { labels: v.labels } : {}) };
                      const newTags = [...(person.tags ?? []), newTag];
                      setPerson({ ...person, tags: newTags });
                      setTagsSaving(true);
                      try { await updatePerson(person.id, { tags: newTags, updated_at: person.updated_at } as any, token); }
                      catch { setPerson({ ...person }); }
                      finally { setTagsSaving(false); }
                    }}
                    lang={lang}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Elulugu ── */}
        {person.biography && (
          <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
            <CardHeader icon={<BookMarked size={18} />} title={t('biography', 'Elulugu')} />
            <MarkdownView content={person.biography} className="text-sm text-gray-800 leading-relaxed" />
          </div>
        )}

        {/* ── Seotud teosed ── */}
        {works.length > 0 && (
          <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
            <CardHeader
              icon={<BookOpen size={18} />}
              title={t('relatedWorks', 'Seotud teosed')}
              count={selectedRole ? filteredWorks.length : works.length}
            />
            {uniqueRoles.length > 1 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                <button
                  onClick={() => { setSelectedRole(null); setVisibleCount(30); }}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${!selectedRole ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
                >
                  {t('allRoles', 'Kõik')} ({works.length})
                </button>
                {uniqueRoles.map(role => (
                  <button
                    key={role}
                    onClick={() => { setSelectedRole(role === selectedRole ? null : role); setVisibleCount(30); }}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selectedRole === role ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
                  >
                    {t(`workspace:metadata.roles.${role}`, { defaultValue: role })} ({works.filter(w => w.role === role).length})
                  </button>
                ))}
              </div>
            )}
            <div className="space-y-1">
              {displayedWorks.map(({ work_id, role }) => {
                const roleLabel = t(`workspace:metadata.roles.${role}`, { defaultValue: role });
                const meta = workTitles[work_id];
                const title = meta?.title ?? work_id;
                // Eelista kuvatavat aastat (nt "ca. 1750"); muidu number-aasta, kui see pole 0
                const yearLabel = formatYearDisplay(meta?.year_display, meta?.year, t);
                const inCollection = selectedCollection && meta?.collections?.includes(selectedCollection);
                const colorClasses = inCollection ? getCollectionColorClasses(collections[selectedCollection!]) : null;
                // Kaitstud kollektsiooni teos: kuva pealkiri, kuid ilma lingita (ligipääs puudub)
                if (meta?.restricted) {
                  const restrictedLabel = t('protectedCollection', 'Kuulub kaitstud kollektsiooni');
                  return (
                    <div
                      key={`${work_id}-${role}`}
                      title={restrictedLabel}
                      className="flex items-center justify-between py-2 -mx-1 px-1 rounded cursor-default"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Lock size={13} className="shrink-0 text-gray-400" />
                        <span className="text-sm text-gray-500 truncate">{title}</span>
                        {yearLabel && <span className="text-xs shrink-0 text-gray-400">{yearLabel}</span>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        <span className="text-xs px-1.5 py-0.5 rounded text-gray-400 bg-gray-100 truncate max-w-[10rem]" title={restrictedLabel}>
                          {restrictedLabel}
                        </span>
                        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{roleLabel}</span>
                      </div>
                    </div>
                  );
                }
                return (
                  <Link
                    key={`${work_id}-${role}`}
                    to={`/work/${work_id}/1`}
                    className={`flex items-center justify-between py-2 -mx-1 px-1 rounded group transition-colors ${inCollection ? `${colorClasses?.bg} hover:opacity-90` : 'hover:bg-gray-50'}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <BookOpen size={13} className={`shrink-0 ${inCollection ? colorClasses?.text : 'text-gray-300'}`} />
                      <span className={`text-sm transition-colors truncate ${inCollection ? colorClasses?.text : 'text-gray-700 group-hover:text-primary-700'}`}>
                        {title}
                      </span>
                      {yearLabel && <span className={`text-xs shrink-0 ${inCollection ? colorClasses?.text + ' opacity-70' : 'text-gray-400'}`}>{yearLabel}</span>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${inCollection ? `${colorClasses?.text} bg-white/50` : 'text-gray-400 bg-gray-100'}`}>
                        {roleLabel}
                      </span>
                      <ExternalLink size={12} className={`transition-colors ${inCollection ? colorClasses?.text : 'text-gray-300 group-hover:text-primary-500'}`} />
                    </div>
                  </Link>
                );
              })}
            </div>
            {filteredWorks.length > visibleCount && (
              <button
                onClick={() => setVisibleCount(v => v + 30)}
                className="mt-3 w-full text-xs text-gray-500 hover:text-primary-600 py-1.5 border border-gray-200 rounded hover:border-primary-300 transition-colors"
              >
                {t('loadMore', 'Lae veel')} ({filteredWorks.length - visibleCount})
              </button>
            )}
          </div>
        )}

        {/* ── Seosed teoste kaudu ── */}
        {id && <WorkRelationsCard personId={id} />}

        {/* ── Struktureeritud info (klapitav) ── */}
        <StructuredInfoCard person={person} />

        {/* ── Märkmed ── */}
        {person.notes && (
          <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
            <CardHeader icon={<StickyNote size={18} />} title={t('notes', 'Märkmed')} />
            <MarkdownView content={person.notes} className="text-sm text-gray-700" />
          </div>
        )}

        {/* ── Ajalugu (ainult admin) ── */}
        {isAdmin && id && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm mb-6">
            <button
              onClick={() => historyOpen ? setHistoryOpen(false) : loadHistory()}
              className="w-full flex items-center justify-between p-5 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2 text-gray-700 font-medium">
                <History size={18} className="text-gray-400" />
                {t('history', 'Muudatuste ajalugu')}
                {history.length > 0 && (
                  <span className="text-xs text-gray-400 font-normal">({history.length})</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {historyLoading && <span className="text-xs text-gray-400">{t('common:loading')}</span>}
                {historyOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
              </div>
            </button>

            {historyOpen && history.length > 0 && (
              <div className="border-t border-gray-100 divide-y divide-gray-50">
                {history.map((commit) => (
                  <div key={commit.hash} className="overflow-hidden">
                    <div
                      className={`flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${expandedCommit === commit.hash ? 'bg-gray-50' : ''}`}
                      onClick={() => {
                        if (expandedCommit === commit.hash) {
                          setExpandedCommit(null);
                        } else {
                          setExpandedCommit(commit.hash);
                          loadDiff(commit.hash);
                        }
                      }}
                    >
                      <button className="p-1 hover:bg-gray-200 rounded transition-colors flex-shrink-0">
                        {expandedCommit === commit.hash
                          ? <ChevronDown size={16} className="text-gray-600" />
                          : <ChevronRight size={16} className="text-gray-400" />}
                      </button>
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="text-xs text-gray-400 font-mono flex-shrink-0">{commit.formatted_date}</span>
                        <span className="text-xs text-gray-500 flex-shrink-0">{commit.author}</span>
                        <span className="text-sm text-gray-700 truncate">{commit.message}</span>
                        {commit.is_original && (
                          <span className="text-xs text-green-700 bg-green-50 px-1.5 py-0.5 rounded flex-shrink-0">Originaal</span>
                        )}
                      </div>
                      {!commit.is_original && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRestore(commit.full_hash); }}
                          disabled={restoring === commit.full_hash}
                          className="text-xs text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors disabled:opacity-50 flex items-center gap-1 flex-shrink-0"
                          title="Taasta see versioon"
                        >
                          <RotateCcw size={12} />
                          Taasta
                        </button>
                      )}
                    </div>

                    {expandedCommit === commit.hash && (
                      <div className="border-t border-gray-200 bg-gray-50 px-5 py-3">
                        {diffCache[commit.hash] === 'error' ? (
                          <p className="text-xs text-red-400 italic">Diff laadimine ebaõnnestus</p>
                        ) : diffCache[commit.hash] ? (
                          (diffCache[commit.hash] as { field: string; old: unknown; new: unknown }[]).length === 0 ? (
                            <p className="text-xs text-gray-400 italic">Muudatusi ei leitud</p>
                          ) : (
                            <div className="space-y-1">
                              {(diffCache[commit.hash] as { field: string; old: unknown; new: unknown }[]).map((change, i) => (
                                <div key={i} className="text-xs font-mono bg-white rounded border border-gray-100 px-3 py-1.5">
                                  <span className="text-gray-500 font-medium">{change.field}: </span>
                                  <span className="text-red-600">{JSON.stringify(change.old)}</span>
                                  <span className="text-gray-400"> → </span>
                                  <span className="text-green-600">{JSON.stringify(change.new)}</span>
                                </div>
                              ))}
                            </div>
                          )
                        ) : (
                          <p className="text-xs text-gray-400 italic">Laadin…</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {historyOpen && history.length === 0 && !historyLoading && (
              <div className="border-t border-gray-100 px-5 py-4 text-sm text-gray-400 italic">
                Ajalugu puudub
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

export default PersonDetailPage;
