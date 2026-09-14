/**
 * Kollektsiooni ligipääsupaneel (#318, ADR 0043 p2).
 *
 * Kaks telge (ADR 0031): lugemisõigus piiratud kogule ja contributori
 * kirjutamisulatus. Üks EI anna teist — seepärast on siin kaks eraldi
 * märkeruutu, mitte üks „ligipääs".
 *
 * Mustand + „Salvesta muudatused": saadetakse DELTA, mitte tervet loendit.
 * Vana täisasendus võis avalikuks muutunud kogu ID sanitiseerimisel vaikselt
 * maha võtta; delta puudutab ainult nimetatud kolmikuid.
 *
 * Erinevalt töökollektsiooni paneelist INVALIDEERIB salvestus mõjutatud
 * kasutajate sessioonid — hoiatus on nupu juures, enne vajutust.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Trash2, UserPlus } from 'lucide-react';
import {
  applyCollectionRights, getCollectionRights,
} from '../services/collectionRightsService';
import { searchUsers } from '../utils/userSearch';
import {
  affectedUsernames, canAddAllowed, canAddEdit, rightsDelta, rightsRows,
  RightsBasis, RightsState, RightsUser,
} from '../pages/admin/collectionRightsDraft';

interface CollectionAccessPanelProps {
  collectionId: string;
  users: RightsUser[];
  usersKnown: boolean;
  actor: { username: string; role: string };
  /** Kutsutakse pärast edukat salvestust (nt kogude värskenduseks). */
  onSaved?: () => void;
}

const klooni = (s: RightsState): RightsState =>
  ({ ...s, allowed: new Set(s.allowed), edit: new Set(s.edit) });

const CollectionAccessPanel: React.FC<CollectionAccessPanelProps> = ({
  collectionId, users, usersKnown, actor, onSaved,
}) => {
  const { t } = useTranslation(['admin', 'common']);

  const [laetud, setLaetud] = useState<RightsState | null>(null);
  const [mustand, setMustand] = useState<RightsState | null>(null);
  const [laadin, setLaadin] = useState(true);
  const [salvestan, setSalvestan] = useState(false);
  const [viga, setViga] = useState<string | null>(null);
  const [otsing, setOtsing] = useState('');

  const lae = useCallback(async () => {
    setLaadin(true);
    setViga(null);
    try {
      const d = await getCollectionRights(collectionId);
      const olek: RightsState = {
        visibility: d.visibility,
        isVirtual: d.is_virtual,
        allowed: new Set(d.allowed_users),
        edit: new Set(d.edit_users),
      };
      setLaetud(olek);
      setMustand(klooni(olek));
    } catch {
      // Laadimisviga EI tohi muutuda tühjaks õiguste kaardiks: tühi kaart
      // näeks välja nagu „õigusi ei ole" ja selle salvestamine kustutaks kõik.
      setLaetud(null);
      setMustand(null);
      setViga(t('collections.accessPanel.loadFailed'));
    } finally {
      setLaadin(false);
    }
  }, [collectionId, t]);

  useEffect(() => { lae(); }, [lae]);

  const read = useMemo(
    () => (mustand ? rightsRows(mustand, users, actor, { usersKnown }) : []),
    [mustand, users, actor, usersKnown]);

  const delta = useMemo(
    () => (laetud && mustand ? rightsDelta(laetud, mustand, collectionId) : []),
    [laetud, mustand, collectionId]);

  const mojutatud = useMemo(() => affectedUsernames(delta), [delta]);

  const lisatavad = useMemo(() => {
    if (!mustand) return [];
    if (!otsing.trim()) return [];
    const lubatud = users.filter(u => {
      if (mustand.allowed.has(u.username) || mustand.edit.has(u.username)) return false;
      // Kui kumbki telg ei ole lubatud (nt virtuaalne rühm), ei pakuta teda
      // üldse: muidu saaks mustandisse määrang, mille server 400-ga tagasi lükkab.
      return canAddAllowed(mustand) || canAddEdit(mustand, u.role);
    });
    // Diakriitikatundetu otsing on JAGATUD töökollektsiooni paneeliga: „jogi"
    // peab leidma „Jõgi" mõlemas paneelis ühtemoodi (#318 koristus).
    return searchUsers(lubatud, otsing);
  }, [users, mustand, otsing]);

  const lyliti = (username: string, field: 'allowed' | 'edit', peal: boolean) => {
    setMustand(prev => {
      if (!prev) return prev;
      const next = klooni(prev);
      if (peal) next[field].add(username);
      else next[field].delete(username);
      return next;
    });
  };

  const eemaldaRida = (username: string) => {
    setMustand(prev => {
      if (!prev) return prev;
      const next = klooni(prev);
      next.allowed.delete(username);
      next.edit.delete(username);
      return next;
    });
  };

  const salvesta = async () => {
    if (!mustand || delta.length === 0) return;
    setSalvestan(true);
    setViga(null);
    try {
      const tulemus = await applyCollectionRights(delta);
      // Kinnitatud olek tuleb serverilt: arvuta uus kaart sellest, mitte
      // optimistlikust oletusest.
      const uus = klooni(mustand);
      for (const [username, olek] of Object.entries(tulemus.users || {})) {
        if (olek.allowed_collections.includes(collectionId)) uus.allowed.add(username);
        else uus.allowed.delete(username);
        if (olek.edit_collections.includes(collectionId)) uus.edit.add(username);
        else uus.edit.delete(username);
      }
      setLaetud(klooni(uus));
      setMustand(uus);
      setOtsing('');
      onSaved?.();
    } catch (e) {
      setViga((e as { message?: string }).message
        || t('collections.accessPanel.saveFailed'));
    } finally {
      setSalvestan(false);
    }
  };

  const loobu = () => {
    if (laetud) setMustand(klooni(laetud));
    setViga(null);
    setOtsing('');
  };

  const alusSilt = (b: RightsBasis): string | null => {
    if (b === 'role_based') return t('collections.accessPanel.basisRoleBased');
    if (b === 'inert') return t('collections.accessPanel.basisInert');
    return null;
  };

  if (laadin) {
    return <div className="mt-3"><Loader2 size={16} className="animate-spin text-gray-400" /></div>;
  }

  if (!mustand || !laetud) {
    return (
      <div className="mt-3 rounded border border-red-200 bg-red-50 p-3">
        <p className="text-sm text-red-700">{viga}</p>
        <button type="button" onClick={lae}
                className="mt-2 text-sm text-red-700 underline">
          {t('collections.accessPanel.retry')}
        </button>
      </div>
    );
  }

  const roll = (username: string) =>
    users.find(u => u.username === username)?.role || 'contributor';

  return (
    <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-4">
      <h4 className="font-semibold text-gray-800">{t('collections.accessPanel.title')}</h4>
      <p className="mt-1 text-xs text-gray-500">{t('collections.accessPanel.notFullAudit')}</p>
      {mustand.visibility === 'public' && (
        <p className="mt-1 text-xs text-gray-500">{t('collections.accessPanel.publicNoRead')}</p>
      )}

      <ul className="mt-3 divide-y divide-gray-200">
        {read.length === 0 && (
          <li className="py-2 text-sm text-gray-500">{t('collections.accessPanel.noEntries')}</li>
        )}
        {read.map(rida => {
          const inimene = users.find(u => u.username === rida.username);
          // Kirjutamisulatus ilma lugemisõiguseta PIIRATUD kogul ei ava
          // teoseid — seda ei paranda vaikselt, vaid selgitatakse ja
          // pakutakse eraldi tegevust (spekk §2).
          const ulatusIlmaLugemiseta =
            rida.edit && !rida.allowed && mustand.visibility === 'restricted'
            && rida.editBasis === 'assigned';
          return (
            <li key={rida.username} className="py-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-gray-800">
                  {inimene ? `${inimene.name} (${rida.username})` : rida.username}
                </span>

                <label className="flex items-center gap-1 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={rida.allowed}
                    disabled={salvestan || !rida.canManage
                      || (!rida.allowed && !canAddAllowed(mustand))}
                    onChange={e => lyliti(rida.username, 'allowed', e.target.checked)}
                  />
                  {t('collections.accessPanel.readRight')}
                  {alusSilt(rida.allowedBasis) && (
                    <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700">
                      {alusSilt(rida.allowedBasis)}
                    </span>
                  )}
                </label>

                <label className="flex items-center gap-1 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={rida.edit}
                    disabled={salvestan || !rida.canManage
                      || (!rida.edit && !canAddEdit(mustand, roll(rida.username)))}
                    onChange={e => lyliti(rida.username, 'edit', e.target.checked)}
                  />
                  {t('collections.accessPanel.writeScope')}
                  {alusSilt(rida.editBasis) && (
                    <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700">
                      {alusSilt(rida.editBasis)}
                    </span>
                  )}
                </label>

                {rida.canManage && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-sm text-red-700 hover:underline"
                    disabled={salvestan}
                    onClick={() => eemaldaRida(rida.username)}
                  >
                    <Trash2 size={14} /> {t('collections.accessPanel.remove')}
                  </button>
                )}
              </div>

              {rida.editBasis === 'role_based' && rida.edit && (
                <p className="mt-1 text-xs text-gray-500">
                  {t('collections.accessPanel.editorNeedsRead')}
                </p>
              )}
              {ulatusIlmaLugemiseta && (
                <p className="mt-1 text-xs text-amber-700">
                  {t('collections.accessPanel.scopeWithoutRead')}{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => lyliti(rida.username, 'allowed', true)}
                  >
                    {t('collections.accessPanel.addReadRight')}
                  </button>
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-3">
        <input
          type="text"
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          placeholder={t('collections.accessPanel.searchPlaceholder')}
          value={otsing}
          onChange={e => setOtsing(e.target.value)}
        />
        {otsing.trim() !== '' && (
          <ul className="mt-2 max-h-48 overflow-y-auto rounded border border-gray-200 bg-white">
            {lisatavad.length === 0 && (
              <li className="px-2 py-1 text-sm text-gray-500">
                {t('collections.accessPanel.noMatches')}
              </li>
            )}
            {lisatavad.map(u => (
              <li key={u.username} className="flex items-center justify-between px-2 py-1">
                <span className="text-sm text-gray-800">{u.name} ({u.username})</span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-sm text-indigo-700 hover:underline"
                  onClick={() => {
                    // Lisamine algab sellest teljest, mis on üldse lubatud:
                    // avalikul kogul ainult ulatus, piiratud kogul lugemisõigus.
                    lyliti(u.username, canAddAllowed(mustand) ? 'allowed' : 'edit', true);
                    setOtsing('');
                  }}
                >
                  <UserPlus size={14} /> {t('collections.accessPanel.addPerson')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {viga && <p className="mt-3 text-sm text-red-700">{viga}</p>}

      {delta.length > 0 && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2">
          <p className="text-xs text-amber-800">
            {t('collections.accessPanel.sessionWarning')}{' '}
            {t('collections.accessPanel.sessionWarningCount', { count: mojutatud.length })}
          </p>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          disabled={delta.length === 0 || salvestan}
          onClick={salvesta}
        >
          {salvestan
            ? <span className="inline-flex items-center gap-1">
                <Loader2 className="animate-spin" size={14} />
                {t('collections.accessPanel.saving')}
              </span>
            : t('collections.accessPanel.save')}
        </button>
        <button
          type="button"
          className="rounded border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={delta.length === 0 || salvestan}
          onClick={loobu}
        >
          {t('collections.accessPanel.cancel')}
        </button>
      </div>
    </div>
  );
};

export default CollectionAccessPanel;
