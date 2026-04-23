import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import {
  ArrowLeft, ExternalLink, Edit3, ChevronDown, ChevronRight,
  BookOpen, User, BookMarked, Users,
} from 'lucide-react';
import Header from '../../components/Header';
import { getPerson } from '../services/prosopographyService';
import { useUser } from '../../contexts/UserContext';
import { useCollection } from '../../contexts/CollectionContext';
import { getCollectionColorClasses } from '../../services/collectionService';
import { index } from '../../services/meiliService';
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
  const [open, setOpen] = useState(false);

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
  if (person.confession) {
    rows.push({ label: t('confession', 'Konfessioon'), value: getLabel(person.confession) });
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
      value: person.education.map((e: any) => (e.institution ?? getLabel(e)) || e).join(', '),
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
                  ? <Link to={`/persons/${encodeURIComponent(r.target_id)}`} className="underline hover:text-gray-700">{displayName}</Link>
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
  if (person.notes) {
    rows.push({ label: t('notes', 'Märkmed'), value: person.notes });
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

  const [person, setPerson] = useState<ProsopoRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workTitles, setWorkTitles] = useState<Record<string, { title: string; year: number | null; collections: string[] }>>({});
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(30);

  const token = authToken ?? '';
  const canEdit = user && (user.role === 'editor' || user.role === 'admin');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getPerson(id, token)
      .then(data => {
        setPerson(data);
        setError(null);
        const uniqueWorkIds = [...new Set((data.works ?? []).map((w: { work_id: string }) => w.work_id).filter(Boolean))];
        if (uniqueWorkIds.length > 0) {
          // Teoste pealkirjad: päri partiidena (max 50 korraga), et vältida Meilisearch IN-filtri piiranguid
          const BATCH = 50;
          const allHits: any[] = [];
          const batches = [];
          for (let i = 0; i < uniqueWorkIds.length; i += BATCH) batches.push(uniqueWorkIds.slice(i, i + BATCH));
          Promise.all(batches.map(batch => {
            const ids = batch.map((wid: string) => `"${wid}"`).join(', ');
            return index.search('', {
              filter: `work_id IN [${ids}] AND lehekylje_number = 1`,
              attributesToRetrieve: ['work_id', 'title', 'year', 'collections_hierarchy'],
              limit: BATCH,
            }).then(res => allHits.push(...res.hits)).catch(() => {});
          })).then(() => {
            const map: Record<string, { title: string; year: number | null; collections: string[] }> = {};
            for (const hit of allHits) {
              if (hit.work_id && !map[hit.work_id]) {
                map[hit.work_id] = { title: hit.title ?? hit.work_id, year: hit.year ?? null, collections: hit.collections_hierarchy ?? [] };
              }
            }
            setWorkTitles(map);
          });
        }
      })
      .catch(() => setError(t('loadError', 'Isiku laadimine ebaõnnestus.')))
      .finally(() => setLoading(false));
  }, [id, token]);

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
  const works: { work_id: string; role: string }[] = [...(person.works ?? [])].sort((a, b) => {
    const ya = workTitles[a.work_id]?.year ?? 9999;
    const yb = workTitles[b.work_id]?.year ?? 9999;
    return ya - yb;
  });
  const identifiers = (person.identifiers ?? []).filter(i => i.id);

  const uniqueRoles = [...new Set(works.map(w => w.role))];
  const filteredWorks = selectedRole ? works.filter(w => w.role === selectedRole) : works;
  const displayedWorks = filteredWorks.slice(0, visibleCount);

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
            action={canEdit ? (
              <Link
                to={`/persons/${id}/edit`}
                state={{ from: backTo }}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded text-gray-500 hover:text-primary-700 hover:bg-primary-50 border border-gray-200 hover:border-primary-200 transition-colors"
              >
                <Edit3 size={12} />
                {t('edit', 'Muuda')}
              </Link>
            ) : undefined}
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
                (person.education ?? []).find(e => agNames.has(e.institution)) ??
                (person.education ?? []).find(e => e.source === 'album_academicum' && (e.date_from || e.date_start));
              const aaId = (person.identifiers ?? []).find(i => i.scheme === 'album_academicum')?.id;
              if (!immEdu && !aaId) return null;
              const dateLabel = immEdu?.date_from?.date
                ? formatImmDate(immEdu.date_from.date, lang)
                : (immEdu?.date_start ? formatImmDate(immEdu.date_start, lang) : null);
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
            {((person.statuses?.length ?? 0) > 0 || person.confession) && (
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
                {person.confession && (
                  <div>
                    <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">
                      {t('confession', 'Konfessioon')}
                    </span>
                    <p className="text-gray-900">{getLabel(person.confession)}</p>
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
        </div>

        {/* ── Elulugu ── */}
        {person.biography && (
          <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
            <CardHeader icon={<BookMarked size={18} />} title={t('biography', 'Elulugu')} />
            <div className="markdown-preview text-sm text-gray-800 leading-relaxed">
              <ReactMarkdown>{person.biography}</ReactMarkdown>
            </div>
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
                const year = meta?.year;
                const inCollection = selectedCollection && meta?.collections?.includes(selectedCollection);
                const colorClasses = inCollection ? getCollectionColorClasses(collections[selectedCollection!]) : null;
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
                      {year && <span className={`text-xs shrink-0 ${inCollection ? colorClasses?.text + ' opacity-70' : 'text-gray-400'}`}>{year}</span>}
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

      </div>
    </div>
  );
};

export default PersonDetailPage;
