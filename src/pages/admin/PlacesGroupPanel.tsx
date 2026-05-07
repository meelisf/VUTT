import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Trash2, Edit2, X, ChevronRight } from 'lucide-react';
import { putGroup, deleteGroup, autoAssignGroupParents } from '../../prosopography/services/prosopographyService';

interface GroupEntry {
  labels?: Record<string, string>;
  sort_order?: number;
  parent?: string | null;
}

interface PlacesGroupPanelProps {
  groups: Record<string, GroupEntry>;
  token: string;
  lang: string;
  onGroupsChanged: (groups: Record<string, GroupEntry>) => void;
  onClose: () => void;
}

const LANGS = ['et', 'en'];

function resolveLabel(labels: Record<string, string> | undefined, lang: string): string {
  if (!labels) return '';
  return labels[lang] ?? labels.et ?? labels.en ?? Object.values(labels)[0] ?? '';
}

const PlacesGroupPanel: React.FC<PlacesGroupPanelProps> = ({
  groups, token, lang, onGroupsChanged, onClose,
}) => {
  const { t } = useTranslation('admin');
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editData, setEditData] = useState<{ labels: Record<string, string>; sort_order: number; parent: string }>({
    labels: {}, sort_order: 50, parent: '',
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteErrorKey, setDeleteErrorKey] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newKey, setNewKey] = useState('');

  const sortedGroups = Object.entries(groups).sort(([, a], [, b]) => (a.sort_order ?? 50) - (b.sort_order ?? 50));
  const topLevelKeys = Object.keys(groups).filter(k => !groups[k]?.parent);

  function startEdit(key: string) {
    const entry = groups[key];
    setEditKey(key);
    setEditData({ labels: { ...(entry.labels ?? {}) }, sort_order: entry.sort_order ?? 50, parent: entry.parent ?? '' });
    setSaveError(null);
  }

  async function handleSave(isNew: boolean) {
    const key = isNew ? newKey.trim() : editKey!;
    if (!key) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await putGroup(key, {
        labels: editData.labels,
        sort_order: editData.sort_order,
        parent: editData.parent || null,
      }, token);
      onGroupsChanged({ ...groups, [result.key]: result.entry });
      setEditKey(null);
      setShowNew(false);
      setNewKey('');
      setEditData({ labels: {}, sort_order: 50, parent: '' });
    } catch (e: any) {
      setSaveError(e.message ?? t('places.groupSaveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(key: string) {
    setDeletingKey(key);
    setDeleteError(null);
    setDeleteErrorKey(null);
    try {
      await deleteGroup(key, token);
      const next = { ...groups };
      delete next[key];
      onGroupsChanged(next);
    } catch (e: any) {
      setDeleteError(e.message ?? t('places.groupDeleteError'));
      setDeleteErrorKey(key);
    } finally {
      setDeletingKey(null);
    }
  }

  async function handleAutoAssign() {
    setAssigning(true);
    setAssignResult(null);
    try {
      const result = await autoAssignGroupParents(token);
      setAssignResult(t('places.autoAssignResult', { count: result.assigned }));
      // Teavita parent-komponenti, et laeks meta uuesti
      onGroupsChanged({ ...groups, __reload: true } as any);
    } catch (e: any) {
      setAssignResult(t('places.autoAssignError'));
    } finally {
      setAssigning(false);
    }
  }

  function EditForm({ isNew }: { isNew: boolean }) {
    return (
      <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
        {isNew && (
          <div>
            <label className="text-xs font-medium text-gray-600">{t('places.groupKey')}</label>
            <input
              type="text"
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
              placeholder="nt gootaland"
              className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono"
            />
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-gray-600">{t('places.groupLabels')}</label>
          {LANGS.map(l => (
            <div key={l} className="flex items-center gap-1 mt-0.5">
              <span className="text-xs text-gray-400 w-5">{l}</span>
              <input
                type="text"
                value={editData.labels[l] ?? ''}
                onChange={e => setEditData(d => ({ ...d, labels: { ...d.labels, [l]: e.target.value } }))}
                className="flex-1 border border-gray-300 rounded px-2 py-0.5 text-sm"
              />
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs font-medium text-gray-600">{t('places.groupSortOrder')}</label>
            <input
              type="text"
              inputMode="numeric"
              value={editData.sort_order}
              onChange={e => setEditData(d => ({ ...d, sort_order: parseInt(e.target.value) || 50 }))}
              className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium text-gray-600">{t('places.groupParent')}</label>
            <select
              value={editData.parent}
              onChange={e => setEditData(d => ({ ...d, parent: e.target.value }))}
              className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <option value="">{t('places.groupParentNone')}</option>
              {topLevelKeys
                .filter(k => k !== (isNew ? newKey : editKey))
                .map(k => (
                  <option key={k} value={k}>{resolveLabel(groups[k].labels, lang) || k}</option>
                ))}
            </select>
          </div>
        </div>
        {saveError && <p className="text-xs text-red-600">{saveError}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => handleSave(isNew)}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            {saving ? t('places.groupSaving') : t('places.groupSave')}
          </button>
          <button
            onClick={() => { setEditKey(null); setShowNew(false); setSaveError(null); setNewKey(''); }}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
          >
            {t('places.groupCancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg bg-white mb-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900">{t('places.groups')}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAutoAssign}
            disabled={assigning}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50"
          >
            {assigning && <Loader2 size={11} className="animate-spin" />}
            {assigning ? t('places.autoAssigning') : t('places.autoAssign')}
          </button>
          <button
            onClick={() => { setShowNew(true); setEditKey(null); setEditData({ labels: {}, sort_order: 50, parent: '' }); setSaveError(null); }}
            className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
          >
            + {t('places.addGroup')}
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-1">
            <X size={16} />
          </button>
        </div>
      </div>

      {assignResult && (
        <div className="px-4 py-2 text-xs text-violet-700 bg-violet-50 border-b border-violet-100">
          {assignResult}
        </div>
      )}

      <div className="p-3 space-y-1 max-h-96 overflow-y-auto">
        {showNew && (
          <div className="mb-2 rounded border border-primary-200 p-2">
            <div className="text-xs font-medium text-gray-700 mb-1">+ {t('places.addGroup')}</div>
            <EditForm isNew={true} />
          </div>
        )}

        {sortedGroups.map(([key, entry]) => {
          const label = resolveLabel(entry.labels, lang) || key;
          const parentLabel = entry.parent ? (resolveLabel(groups[entry.parent]?.labels, lang) || entry.parent) : null;
          const isEditing = editKey === key;

          return (
            <div key={key} className={`rounded border p-2 ${entry.parent ? 'border-gray-100 ml-4' : 'border-gray-200'}`}>
              <div className="flex items-center gap-2">
                {entry.parent && <ChevronRight size={11} className="text-gray-300 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-800">{label}</span>
                  <span className="text-xs text-gray-400 ml-2 font-mono">{key}</span>
                  {parentLabel && (
                    <span className="text-xs text-violet-500 ml-2">↳ {parentLabel}</span>
                  )}
                </div>
                <span className="text-xs text-gray-400">{entry.sort_order ?? '—'}</span>
                <button
                  onClick={() => isEditing ? setEditKey(null) : startEdit(key)}
                  className="text-gray-400 hover:text-primary-600"
                >
                  <Edit2 size={13} />
                </button>
                <button
                  onClick={() => handleDelete(key)}
                  disabled={deletingKey === key}
                  className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                >
                  {deletingKey === key ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
              {deleteError && deleteErrorKey === key && (
                <p className="text-xs text-red-600 mt-1">{deleteError}</p>
              )}
              {isEditing && <EditForm isNew={false} />}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PlacesGroupPanel;
