import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import {
  ArrowLeft, ExternalLink, Edit3, ChevronDown, ChevronRight,
  BookOpen, User, BookMarked, Users, MapPin,
} from 'lucide-react';
import Header from '../../components/Header';
import { getPerson } from '../services/prosopographyService';
import { useUser } from '../../contexts/UserContext';
import type { ProsopoRecord, HistoricalDate } from '../types';

// =========================================================
// Abifunktsioonid
// =========================================================

function formatHistoricalDate(d: HistoricalDate | null | undefined, symbol: string): string {
  if (!d) return '';
  const year = d.date ? d.date.slice(0, 4) : null;
  if (!year) return '';
  const circa = d.is_circa ? '~' : '';
  const bound = d.bound === 'before' ? 'enne ' : d.bound === 'after' ? 'pärast ' : '';
  const place = d.place?.label ? `, ${d.place.label}` : '';
  return `${symbol}${bound}${circa}${year}${place}`;
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
const StructuredInfoCard: React.FC<{ person: ProsopoRecord }> = ({ person }) => {
  const { t } = useTranslation(['common']);
  const [open, setOpen] = useState(false);

  const rows: { label: string; value: React.ReactNode }[] = [];

  if (person.gender) {
    rows.push({
      label: t('prosopography.filterGenderAll', 'Sugu'),
      value: person.gender === 'M'
        ? t('prosopography.filterMale', 'Meessoost')
        : t('prosopography.filterFemale', 'Naissoost'),
    });
  }
  if (person.origin?.city || person.origin?.region) {
    rows.push({
      label: t('prosopography.origin', 'Päritolu'),
      value: [person.origin.city, person.origin.region].filter(Boolean).join(', '),
    });
  }
  if (person.confession) {
    rows.push({ label: t('prosopography.confession', 'Konfessioon'), value: person.confession.label });
  }
  const aliases = person.name.aliases ?? [];
  if (aliases.length > 0) {
    rows.push({ label: t('prosopography.aliases', 'Nimevariandid'), value: aliases.join(', ') });
  }
  if (person.occupations?.length > 0) {
    rows.push({
      label: t('prosopography.occupations', 'Ametid'),
      value: person.occupations.map((o: any) => o.label ?? o).join(', '),
    });
  }
  if (person.education?.length > 0) {
    rows.push({
      label: t('prosopography.education', 'Haridus'),
      value: person.education.map((e: any) => e.institution ?? e.label ?? e).join(', '),
    });
  }
  if (person.relations?.length > 0) {
    rows.push({
      label: t('prosopography.relations', 'Seosed'),
      value: person.relations.map((r: any) => `${r.name ?? r.target_id}${r.type ? ` (${r.type})` : ''}`).join(', '),
    });
  }
  if (person.notes) {
    rows.push({ label: t('prosopography.notes', 'Märkmed'), value: person.notes });
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
        <span className="font-bold">{t('prosopography.structuredInfo', 'Struktureeritud info')}</span>
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
  const { t } = useTranslation(['common']);
  const { user, authToken } = useUser();

  const [person, setPerson] = useState<ProsopoRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const token = authToken ?? '';
  const canEdit = user && (user.role === 'editor' || user.role === 'admin');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getPerson(id, token)
      .then(data => { setPerson(data); setError(null); })
      .catch(() => setError(t('prosopography.loadError', 'Isiku laadimine ebaõnnestus.')))
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
          <p className="text-red-600 text-sm mb-4">{error ?? t('prosopography.notFound', 'Isikut ei leitud.')}</p>
          <button onClick={() => navigate('/persons')} className="text-primary-600 hover:underline text-sm">
            ← {t('prosopography.backToList', 'Tagasi isikute nimekirja')}
          </button>
        </div>
      </div>
    );
  }

  // ── Andmed ───────────────────────────────────────────────
  const birth = formatHistoricalDate(person.birth, '*');
  const death = formatHistoricalDate(person.death, '†');
  const works: { work_id: string; role: string }[] = person.works ?? [];
  const identifiers = (person.identifiers ?? []).filter(i => i.id);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">

        {/* Tagasi */}
        <button
          onClick={() => navigate('/persons')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-primary-600 transition-colors mb-4"
        >
          <ArrowLeft size={15} />
          {t('prosopography.backToList', 'Tagasi isikute nimekirja')}
        </button>

        {/* ── Isiku info ── */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
          <CardHeader
            icon={<User size={18} />}
            title={person.name.label}
            action={canEdit ? (
              <Link
                to={`/persons/${id}/edit`}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded text-gray-500 hover:text-primary-700 hover:bg-primary-50 border border-gray-200 hover:border-primary-200 transition-colors"
              >
                <Edit3 size={12} />
                {t('prosopography.edit', 'Muuda')}
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
                      {t('prosopography.born', 'Sündinud')}
                    </span>
                    <p className="text-gray-900">{birth.replace('*', '')}</p>
                  </div>
                )}
                {death && (
                  <div>
                    <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">
                      {t('prosopography.died', 'Surnud')}
                    </span>
                    <p className="text-gray-900">{death.replace('†', '')}</p>
                  </div>
                )}
              </div>
            )}

            {/* Seisus + konfessioon */}
            {(person.status || person.confession) && (
              <div className="grid grid-cols-2 gap-4">
                {person.status && (
                  <div>
                    <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">
                      {t('prosopography.status', 'Seisus')}
                    </span>
                    <p className="text-gray-900">{person.status.label}</p>
                  </div>
                )}
                {person.confession && (
                  <div>
                    <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">
                      {t('prosopography.confession', 'Konfessioon')}
                    </span>
                    <p className="text-gray-900">{person.confession.label}</p>
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
            <CardHeader icon={<BookMarked size={18} />} title={t('prosopography.biography', 'Elulugu')} />
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
              title={t('prosopography.relatedWorks', 'Seotud teosed')}
              count={works.length}
            />
            <div className="space-y-1">
              {works.map(({ work_id, role }) => {
                const roleLabel = t(`workspace:metadata.roles.${role}`, { defaultValue: role });
                return (
                  <Link
                    key={work_id}
                    to={`/work/${work_id}/1`}
                    className="flex items-center justify-between py-2 -mx-1 px-1 rounded hover:bg-gray-50 group transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <BookOpen size={13} className="text-gray-300 shrink-0" />
                      <span className="text-sm text-gray-700 group-hover:text-primary-700 transition-colors truncate">
                        {work_id}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                        {roleLabel}
                      </span>
                      <ExternalLink size={12} className="text-gray-300 group-hover:text-primary-500 transition-colors" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Struktureeritud info (klapitav) ── */}
        <StructuredInfoCard person={person} />

      </div>
    </div>
  );
};

export default PersonDetailPage;
