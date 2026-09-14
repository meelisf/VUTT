/**
 * Töökollektsiooni ligipääsupaneel kogu juures (#318, ADR 0043).
 *
 * Mustand + „Salvesta muudatused": iga valiku peale päringut EI tehta.
 * `PUT access` on täisasendus, seega mustand algab serverilt laetud TERVEST
 * kaardist — otsing ja filtrid muudavad ainult seda, mida näidatakse.
 * Lukustatud ja puutumata kirjed lähevad salvestusel muutmatult kaasa.
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Trash2, UserPlus } from 'lucide-react';
import { WorkSetSummary, getWorkSet, setWorkSetAccess } from '../../services/workSetService';
import { applyUserRole, SetRole } from './workSetAccess';
import {
  addableUsers, classifyEntries, draftChanged, searchUsers, KnownUser,
} from './workSetAccessDraft';

interface WorkSetAccessPanelProps {
  ws: WorkSetSummary;
  /** Admini üldloend. Halduri režiimis TÜHI — tal ei ole üldloendit. */
  users: KnownUser[];
  /**
   * Kas `users` on AUTORITEETNE loend? Väär halduril (tal ei ole üldloendit)
   * ja siis, kui admini loendi laadimine ebaõnnestus. Tühja loendi
   * tõlgendamine „kõik kirjed on kustutatud kasutajad" oleks vale vastus.
   */
  usersKnown: boolean;
  actor: { username: string; role: string };
  /** Kas kutsuja tohib muuta (admin+)? Väär = lugemisvaade. */
  canEdit: boolean;
  /** Kutsutakse pärast edukat salvestust; kutsuja kirjutab oma rea üle. */
  onSaved: (ws: WorkSetSummary) => void;
}

const kaart = (ws: WorkSetSummary): Record<string, SetRole> =>
  ({ ...((ws.access as Record<string, SetRole>) || {}) });

const WorkSetAccessPanel: React.FC<WorkSetAccessPanelProps> = ({
  ws, users, usersKnown, actor, canEdit, onSaved,
}) => {
  const { t } = useTranslation(['admin', 'common']);

  // Laetud kaart = viimane serverilt kinnitatud olek. Mustand algab sellest.
  const [laetud, setLaetud] = useState<Record<string, SetRole>>(() => kaart(ws));
  const [mustand, setMustand] = useState<Record<string, SetRole>>(() => kaart(ws));
  const [revision, setRevision] = useState(ws.revision);
  const [otsing, setOtsing] = useState('');
  const [salvestan, setSalvestan] = useState(false);
  const [viga, setViga] = useState<string | null>(null);
  // Konflikti korral näidatakse SERVERI olekut kõrvuti kasutaja mustandiga.
  // Automaatset ühendamist ega kordussaatmist ei tehta (ADR 0043 p6).
  const [serveriOlek, setServeriOlek] = useState<Record<string, SetRole> | null>(null);

  const read = useMemo(
    () => classifyEntries(mustand, users, actor, { usersKnown }),
    [mustand, users, actor, usersKnown]);
  const lisatavad = useMemo(
    () => searchUsers(addableUsers(users, mustand, actor), otsing),
    [users, mustand, actor, otsing]);
  const muutunud = draftChanged(laetud, mustand);

  const muudaRolli = (username: string, role: SetRole | null) => {
    setMustand(prev => applyUserRole(prev, username, role));
  };

  const loobu = () => {
    setMustand({ ...laetud });
    setViga(null);
    setServeriOlek(null);
    setOtsing('');
  };

  const salvesta = async () => {
    setSalvestan(true);
    setViga(null);
    try {
      const uus = await setWorkSetAccess(ws.id, mustand, revision);
      const kinnitatud = kaart(uus);
      // Kinnitatud olek tuleb serverilt, mitte optimistlikust oletusest.
      setLaetud(kinnitatud);
      setMustand(kinnitatud);
      setRevision(uus.revision);
      setServeriOlek(null);
      onSaved(uus);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 409) {
        // Lae uus olek VÕRDLEMISEKS, aga jäta mustand kasutaja kavatsuseks:
        // tema otsustab, kas saata uuesti. Automaatne kordussaatmine
        // kirjutaks teise inimese töö vaikselt üle.
        setViga(t('workSets.accessPanel.conflictReload'));
        try {
          const varske = await getWorkSet(ws.id);
          setLaetud(kaart(varske));
          setRevision(varske.revision);
          setServeriOlek(kaart(varske));
        } catch {
          // Värske oleku laadimine ebaõnnestus — konflikti teade jääb,
          // salvestamine annab uue 409 ja seda saab korrata.
        }
      } else {
        setViga((status === 403 && (e as { message?: string }).message)
          || t('workSets.saveFailed'));
      }
    } finally {
      setSalvestan(false);
    }
  };

  const olekuTekst = (m: Record<string, SetRole>) =>
    Object.entries(m).map(([k, v]) => `${k}=${v}`).sort().join(', ') || '—';

  return (
    <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-4">
      <h4 className="font-semibold text-gray-800">{t('workSets.accessPanel.title')}</h4>
      <p className="mt-1 text-sm text-gray-600">{t('workSets.accessPanel.explain')}</p>
      <p className="mt-1 text-xs text-gray-500">{t('workSets.accessPanel.noRightsGranted')}</p>
      <p className="mt-1 text-xs text-gray-500">{t('workSets.accessPanel.adminsExplain')}</p>
      {ws.visibility === 'public' && (
        <p className="mt-1 text-xs text-gray-500">{t('workSets.accessPanel.publicExplain')}</p>
      )}
      {ws.status === 'archived' && (
        <p className="mt-1 text-xs text-gray-500">{t('workSets.accessPanel.archivedExplain')}</p>
      )}
      {!canEdit && (
        <p className="mt-2 text-xs text-gray-500">{t('workSets.accessPanel.readOnlyHint')}</p>
      )}

      <ul className="mt-3 divide-y divide-gray-200">
        {read.length === 0 && (
          <li className="py-2 text-sm text-gray-500">{t('workSets.accessPanel.noEntries')}</li>
        )}
        {read.map(rida => {
          const inimene = users.find(u => u.username === rida.username);
          return (
            <li key={rida.username} className="flex flex-wrap items-center gap-2 py-2">
              <span className="text-sm text-gray-800">
                {rida.kind === 'deleted_user'
                  ? t('workSets.accessPanel.deletedUser', { username: rida.username })
                  : (inimene ? `${inimene.name} (${rida.username})` : rida.username)}
              </span>
              {rida.kind === 'role_based' && (
                <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700">
                  {t('workSets.accessPanel.roleBased')}
                </span>
              )}
              {canEdit && rida.canChange ? (
                <select
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                  value={rida.role}
                  disabled={salvestan}
                  onChange={e => muudaRolli(rida.username, e.target.value as SetRole)}
                >
                  <option value="viewer">{t('workSets.viewer')}</option>
                  <option value="manager">{t('workSets.manager')}</option>
                </select>
              ) : (
                <span className="text-sm text-gray-600">
                  {rida.role === 'manager' ? t('workSets.manager') : t('workSets.viewer')}
                </span>
              )}
              {canEdit && rida.canRemove && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-sm text-red-700 hover:underline"
                  disabled={salvestan}
                  onClick={() => muudaRolli(rida.username, null)}
                >
                  <Trash2 size={14} /> {t('workSets.accessPanel.remove')}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {canEdit && (
        <div className="mt-3">
          <input
            type="text"
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            placeholder={t('workSets.accessPanel.searchPlaceholder')}
            value={otsing}
            onChange={e => setOtsing(e.target.value)}
          />
          {otsing.trim() !== '' && (
            <ul className="mt-2 max-h-48 overflow-y-auto rounded border border-gray-200 bg-white">
              {lisatavad.length === 0 && (
                <li className="px-2 py-1 text-sm text-gray-500">
                  {t('workSets.accessPanel.noMatches')}
                </li>
              )}
              {lisatavad.map(u => (
                <li key={u.username} className="flex items-center justify-between px-2 py-1">
                  <span className="text-sm text-gray-800">{u.name} ({u.username})</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-sm text-indigo-700 hover:underline"
                    onClick={() => { muudaRolli(u.username, 'viewer'); setOtsing(''); }}
                  >
                    <UserPlus size={14} /> {t('workSets.accessPanel.addPerson')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {viga && <p className="mt-3 text-sm text-red-700">{viga}</p>}
      {serveriOlek && (
        <p className="mt-1 text-xs text-gray-600">
          {t('workSets.accessPanel.serverState')} {olekuTekst(serveriOlek)}
        </p>
      )}

      {canEdit && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            disabled={!muutunud || salvestan}
            onClick={salvesta}
          >
            {salvestan
              ? <span className="inline-flex items-center gap-1">
                  <Loader2 className="animate-spin" size={14} />
                  {t('workSets.accessPanel.saving')}
                </span>
              : t('workSets.accessPanel.save')}
          </button>
          <button
            type="button"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={!muutunud || salvestan}
            onClick={loobu}
          >
            {t('workSets.accessPanel.cancel')}
          </button>
        </div>
      )}
    </div>
  );
};

export default WorkSetAccessPanel;
