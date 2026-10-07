/**
 * Teose osade sisukord töölaua „Info ja annotatsioonid" vahekaardil (#464, ADR 0057),
 * teose info all. Kokkuklapitav (olek on vaate mugavus, localStorage); osadeta
 * teosel või lugemistõrke korral paneeli ei ole. Lehevahemikud on lingid lehele;
 * praegust lehte sisaldav osa on märgitud.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, ListOrdered, Pencil } from 'lucide-react';
import { deletePart, getPartsToc, updatePart, type WorkPart } from '../../services/workPartsApi';
import { draftFromPart, PartDatingError, partFromDraft, sharedStems as sharedStemsOf, type PartDraft } from '../../pages/manage/partsModel';
import PartForm from '../../pages/manage/parts/PartForm';
import PartPanel from '../../pages/manage/parts/PartPanel';
import UnsavedChangesDialog from '../UnsavedChangesDialog';
import { usePersonSources } from '../../hooks/usePersonSources';
import { getLangCode } from '../../utils/getLangCode';
import { datingText } from '../../utils/workDating';
import { pageRangeList, partAbstract, partPermalink, sortParts } from '../../pages/manage/partsModel';
import CopyButton from '../CopyButton';
import { KIND_STYLE } from '../../pages/manage/parts/kindStyle';

const OPEN_KEY = 'vutt_parts_toc_open';

function readOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
}

/** Kiri: kellelt → kellele; muu: isikud komaga. */
function whoLine(p: WorkPart): string {
  const named = p.creators.filter(c => c.name);
  const from = named.filter(c => c.role === 'auctor').map(c => c.name);
  const to = named.filter(c => c.role === 'addressee').map(c => c.name);
  if (p.kind === 'letter' && (from.length || to.length)) return [from.join(', '), to.join(', ')].filter(Boolean).join(' → ');
  return named.map(c => c.name).join(', ');
}

interface Props {
  workId?: string;
  token: string | null;
  currentPage: number;
  /** Toimetaja, kes tohib teost muuta: osa andmete juures pliiats → sama vorm mis teose halduses. */
  canEdit?: boolean;
}

const WorkPartsPanel: React.FC<Props> = ({ workId, token, currentPage, canEdit = false }) => {
  const { t } = useTranslation(['workspace']);
  const [parts, setParts] = useState<WorkPart[]>([]);
  const [nums, setNums] = useState<Map<string, number>>(new Map());
  const [open, setOpen] = useState(readOpen);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleRow = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    if (!workId) return;
    try {
      const r = await getPartsToc(workId, token);
      if (!isCancelled()) { setParts(r.parts); setNums(new Map(Object.entries(r.pageNumbers))); }
    } catch {
      if (!isCancelled()) setParts([]);   // sisukord on lisainfo — tõrge peidab paneeli
    }
  }, [workId, token]);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

  // `?part=` (kirjaotsingu link, #526): ava paneel ja selle osa üksikasjad, kui osa
  // on teoses olemas. Ühekordne avamine — kasutaja võib paneeli pärast sulgeda.
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('part');
  const focusedOnce = useRef<string | null>(null);
  const pendingFocusScroll = useRef(false);
  useEffect(() => {
    if (!focusId || focusedOnce.current === focusId || !parts.some(p => p.id === focusId)) return;
    focusedOnce.current = focusId;
    pendingFocusScroll.current = true;
    setOpen(true);
    setExpanded(prev => new Set(prev).add(focusId));
  }, [focusId, parts]);

  // Osa muutmine töölaualt: vorm (ja isikusoovituste päringud) laetakse alles pliiatsi peale.
  const [editing, setEditing] = useState<WorkPart | null>(null);

  // Järjekord lehenumbri järgi (sama mis halduse sisukorras).
  const sorted = useMemo(
    () => sortParts(parts, [...nums.entries()].sort((a, b) => a[1] - b[1]).map(([s]) => s)),
    [parts, nums],
  );

  // Praegust lehte sisaldav (esimene) osa: avamisel ja uude osasse liikudes keritakse
  // sisukorra kasti sees see keskele. Kerib ainult kasti, mitte lehte/paneeli —
  // teose info jääb paigale ja mobiilis ei hüppa aken.
  const listRef = useRef<HTMLOListElement>(null);
  const pageId = sorted.find(p => p.pages.some(s => nums.get(s) === currentPage))?.id;
  const hereId = focusId && parts.some(p => p.id === focusId) ? focusId : pageId;
  const scrolledOnce = useRef(false);
  useEffect(() => {
    if (!open) { scrolledOnce.current = false; return; }
    const list = listRef.current;
    const row = hereId ? list?.querySelector<HTMLElement>(`[data-part-id="${hereId}"]`) : null;
    if (!list || !row) return;
    // `relative` loend on rea offsetParent → offsetTop on juba loendi suhtes.
    const top = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
    list.scrollTo?.({ top: Math.max(0, top), behavior: scrolledOnce.current ? 'smooth' : 'auto' });
    scrolledOnce.current = true;
  }, [open, hereId]);

  // Sügavlingi (`?part=`) erand ülaltoodud reeglile: teose info on paneeli kohal ja
  // osa jääks muidu nähtavast alast välja. Ühekordselt kerime ka kõrvalpaneeli nii,
  // et osa rida (koos lahtikeeratud üksikasjadega) on üleval. Peab jääma kasti
  // keskendamise efekti JÄRELE, muidu keskendamine kirjutab selle üle.
  useEffect(() => {
    if (!pendingFocusScroll.current || !open || !focusId) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-part-id="${focusId}"]`);
    if (!row) return;
    pendingFocusScroll.current = false;
    row.scrollIntoView?.({ block: 'start' });
  }, [open, focusId, expanded]);

  if (!workId || parts.length === 0) return null;

  const toggle = () => {
    setOpen(o => {
      try { localStorage.setItem(OPEN_KEY, o ? '0' : '1'); } catch { /* mugavus */ }
      return !o;
    });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm mb-6">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-5 py-3 text-left text-gray-800 hover:bg-gray-50 rounded-lg"
      >
        {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        <ListOrdered size={18} className="text-primary-600" />
        <h4 className="font-bold">{t('info.toc')} <span className="font-normal text-gray-500">({parts.length})</span></h4>
      </button>
      {open && (
        <ol ref={listRef} className="relative max-h-[60vh] overflow-y-auto border-t border-gray-100 divide-y divide-gray-100">
          {sorted.map((p, i) => {
            const ranges = pageRangeList(p.pages, nums);
            const here = p.pages.some(s => nums.get(s) === currentPage);
            const who = whoLine(p);
            const year = p.dating?.start?.slice(0, 4);
            const attachments = parts.filter(a => a.attached_to === p.id);
            const isOpen = expanded.has(p.id);
            return (
              <li
                key={p.id}
                data-part-id={p.id}
                aria-current={here ? 'true' : undefined}
                className={`px-5 py-2.5 text-sm ${here ? 'bg-primary-50' : ''}`}
              >
                <div className="flex gap-3">
                {/* Number on lisaks lehenumbritele link osa algusesse — suurem sihtmärk. */}
                {ranges.length > 0 ? (
                  <Link to={`/work/${workId}/${ranges[0].from}`}
                    className={`mt-0.5 h-fit rounded px-1.5 text-[11px] font-semibold hover:ring-2 hover:ring-primary-300 ${KIND_STYLE[p.kind]}`}
                    title={`${t(`manage.parts.kinds.${p.kind}`)} · ${t('info.tocGoToStart', { page: ranges[0].from })}`}>
                    {i + 1}
                  </Link>
                ) : (
                  <span className={`mt-0.5 h-fit rounded px-1.5 text-[11px] font-semibold ${KIND_STYLE[p.kind]}`}
                    title={t(`manage.parts.kinds.${p.kind}`)}>
                    {i + 1}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-gray-900">
                    {p.title || who || t(`manage.parts.kinds.${p.kind}`)}
                    {year && <span className="ml-2 tabular-nums text-gray-500">{year}</span>}
                  </div>
                  {p.title && who && <div className="text-xs text-gray-500">{who}</div>}
                  {p.incipit && <div className="truncate text-xs italic text-gray-400">{p.incipit}</div>}
                </div>
                <div className="shrink-0 text-xs tabular-nums text-gray-500">
                  {t('info.tocPages')}{' '}
                  {ranges.map((r, k) => (
                    <React.Fragment key={r.from}>
                      {k > 0 && ', '}
                      <Link to={`/work/${workId}/${r.from}`} className="text-primary-600 hover:underline">
                        {r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`}
                      </Link>
                    </React.Fragment>
                  ))}
                </div>
                {/* Üksikasjad on alati avatavad: seal on vähemalt osa püsilink. */}
                <button type="button" onClick={() => toggleRow(p.id)} aria-expanded={isOpen}
                  aria-label={t('info.tocDetails')} title={t('info.tocDetails')}
                  className="-mr-2 shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                </div>
                {isOpen && workId && <PartDetails workId={workId} part={p} attachments={attachments} parts={parts} onEdit={canEdit ? () => setEditing(p) : undefined} />}
              </li>
            );
          })}
        </ol>
      )}
      {editing && workId && (
        <PartEditPanel key={editing.id} workId={workId} token={token} part={editing} parts={parts}
          onSaved={() => load()} onClose={() => setEditing(null)} />
      )}
    </div>
  );
};

/** Osa vorm töölaual — sama PartForm/PartPanel mis teose halduses; salvestamata kaitse ühtse dialoogiga. */
const PartEditPanel: React.FC<{ workId: string; token: string | null; part: WorkPart; parts: WorkPart[];
  onSaved: () => Promise<void>; onClose: () => void }> = ({ workId, token, part, parts, onSaved, onClose }) => {
  const { t, i18n } = useTranslation(['workspace']);
  const { authors, peopleRegister } = usePersonSources(token, getLangCode(i18n.language));
  const [current, setCurrent] = useState(part);
  const [draft, setDraft] = useState<PartDraft>(() => draftFromPart(part));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const save = async (): Promise<boolean> => {
    setBusy(true); setError(null);
    try {
      const saved = await updatePart(workId, current.id, partFromDraft(draft, current.pages), token);
      await onSaved();
      setCurrent(saved); setDraft(draftFromPart(saved)); setDirty(false);
      return true;
    } catch (e) {
      setError(e instanceof PartDatingError
        ? t('manage.parts.datingUnparsed', { text: e.message }) : (e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true); setError(null);
    try {
      await deletePart(workId, current.id, token);
      await onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <PartPanel title={draft.title || t(`manage.parts.kinds.${draft.kind}`)} onClose={() => (dirty ? setConfirmClose(true) : onClose())}>
        <PartForm
          isNew={false}
          draft={draft}
          onDraft={d => { setDraft(d); setDirty(true); }}
          otherParts={parts.filter(x => x.id !== current.id && x.kind !== 'attachment')}
          sharedStems={[...sharedStemsOf(current, parts).keys()]}
          error={error}
          busy={busy}
          token={token}
          workId={workId}
          authors={authors}
          peopleRegister={peopleRegister}
          dirty={dirty}
          onSave={() => { void save(); }}
          onDelete={() => { void remove(); }}
          onClose={() => (dirty ? setConfirmClose(true) : onClose())}
        />
      </PartPanel>
      <UnsavedChangesDialog
        open={confirmClose}
        saving={busy}
        saveFailed={saveFailed}
        onDiscard={onClose}
        onStay={() => setConfirmClose(false)}
        onSaveAndContinue={() => { void save().then(ok => (ok ? onClose() : setSaveFailed(true))); }}
      />
    </>
  );
};

/** Osa andmed lahtikeeratuna: liik, dateering, kohad, isikud rollidega, keeled, märkused, lisad. */
const PartDetails: React.FC<{ workId: string; part: WorkPart; attachments: WorkPart[]; parts: WorkPart[]; onEdit?: () => void }> = ({ workId, part: p, attachments, parts, onEdit }) => {
  const { t, i18n } = useTranslation(['workspace']);
  const summary = partAbstract(p, getLangCode(i18n.language));
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex gap-2"><dt className="w-24 shrink-0 text-gray-500">{label}</dt><dd className="min-w-0 flex-1">{value}</dd></div>
  );
  const parent = p.attached_to ? parts.find(x => x.id === p.attached_to) : undefined;
  const places = [p.place?.label, p.place_to?.label].filter(Boolean);
  return (
    <dl className="mt-2 ml-9 space-y-1 rounded border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700">
      {row(t('manage.parts.kind'), t(`manage.parts.kinds.${p.kind}`))}
      {p.dating && row(t('manage.parts.dating'), datingText(p.dating))}
      {places.length > 0 && row(t('manage.parts.place'), p.place_to ? `${p.place?.label ?? '?'} → ${p.place_to.label}` : places[0])}
      {p.creators.length > 0 && row(t('metadata.creators'), (
        <ul className="space-y-0.5">
          {p.creators.map((c, i) => (
            <li key={i}>
              {c.id?.startsWith('vutt:P')
                ? <Link to={`/persons/${c.id}`} className="text-primary-700 hover:underline">{c.name || c.id}</Link>
                : <span>{c.name}</span>}
              <span className="ml-1 text-gray-500">({t(`metadata.roles.${c.role}`, { defaultValue: c.role })})</span>
            </li>
          ))}
        </ul>
      ))}
      {!!p.languages?.length && row(t('metadata.languages'), p.languages.join(', '))}
      {parent && row(t('manage.parts.attachedTo'), parent.title || t(`manage.parts.kinds.${parent.kind}`))}
      {attachments.length > 0 && row(t('info.tocAttachments'), attachments.map(a => a.title || t(`manage.parts.kinds.${a.kind}`)).join('; '))}
      {summary && row(t('manage.parts.abstract'), (
        <span className="whitespace-pre-wrap">
          {summary.text}
          {summary.otherLang && <span className="ml-1 text-gray-400">({t(`manage.parts.${summary.otherLang === 'et' ? 'abstractInEt' : 'abstractInEn'}`)})</span>}
        </span>
      ))}
      {/* Toimetaja märkus: ainult toimetajale (avalik vaade ei näita, ADR 0063). */}
      {onEdit && p.notes && row(t('manage.parts.notes'), <span className="whitespace-pre-wrap text-gray-500">{p.notes}</span>)}
      <div className="flex flex-wrap gap-2 pt-1">
        {/* Püsilink ilma lehenumbrita (#526) — jagamiseks; lahendub esimesele lehele. */}
        <CopyButton text={`${window.location.origin}${partPermalink(workId, p.id)}`}
          label={t('info.tocCopyLink')} copiedLabel={t('info.tocLinkCopied')}
          className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-700 hover:border-primary-400 hover:text-primary-700" />
        {onEdit && (
          <button type="button" onClick={onEdit}
            className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-700 hover:border-primary-400 hover:text-primary-700">
            <Pencil size={12} /> {t('info.tocEdit')}
          </button>
        )}
      </div>
    </dl>
  );
};

export default WorkPartsPanel;
