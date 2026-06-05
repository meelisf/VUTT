import React, { useState, useRef, useEffect } from 'react';
import { Plus, X, Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';

interface ArchiveInfo {
  name: string;
  url?: string;
}

interface ArchiveSelectProps {
  archives: Record<string, ArchiveInfo>;
  value: string;
  onChange: (archiveId: string) => void;
  onArchiveAdded: (id: string, info: ArchiveInfo) => void;
  userRole: string;
  authToken: string | null;
  className?: string;
}

const ArchiveSelect: React.FC<ArchiveSelectProps> = ({
  archives, value, onChange, onArchiveAdded, userRole, authToken, className = '',
}) => {
  const { t } = useTranslation(['admin', 'common']);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notifyText, setNotifyText] = useState('');
  const [notifySent, setNotifySent] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const entries = Object.entries(archives);
  const showFilter = entries.length > 8;
  const filtered = filter
    ? entries.filter(([id, info]) =>
        id.toLowerCase().includes(filter.toLowerCase()) ||
        info.name.toLowerCase().includes(filter.toLowerCase())
      )
    : entries;

  const selectedLabel = value && archives[value]
    ? `${value} — ${archives[value].name}`
    : `— ${t('admin:archives.selectPlaceholder')} —`;

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowAddForm(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const handleAddAdmin = async () => {
    const trimId = newId.trim();
    const trimName = newName.trim();
    const trimUrl = newUrl.trim();
    if (!trimId || !trimName) {
      setAddError(t('admin:archives.idNameRequired'));
      return;
    }
    if (archives[trimId]) {
      setAddError(t('admin:archives.duplicateId', { id: trimId }));
      return;
    }
    setSaving(true);
    setAddError('');
    try {
      const resp = await fetchWithTimeout(`${FILE_API_URL}/config/archives`, {
        method: 'POST',
        headers: { ...getAuthHeaders(authToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: trimId, name: trimName, ...(trimUrl ? { url: trimUrl } : {}) }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        setAddError(err.detail || t('common:error.unknown'));
        return;
      }
      const info: ArchiveInfo = { name: trimName, ...(trimUrl ? { url: trimUrl } : {}) };
      onArchiveAdded(trimId, info);
      onChange(trimId);
      setNewId(''); setNewName(''); setNewUrl('');
      setShowAddForm(false);
      setOpen(false);
    } catch {
      setAddError(t('common:error.unknown'));
    } finally {
      setSaving(false);
    }
  };

  const handleNotifySubmit = async () => {
    if (!notifyText.trim() || !authToken) return;
    setSaving(true);
    try {
      await fetchWithTimeout(`${FILE_API_URL}/notifications/send`, {
        method: 'POST',
        headers: { ...getAuthHeaders(authToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_mode: 'admins',
          title: t('admin:archives.requestTitle'),
          body: notifyText,
        }),
      });
      setNotifySent(true);
    } catch {
      // ignore send errors
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <div className="flex gap-1 items-center">
        <button
          type="button"
          onClick={() => { setOpen(o => !o); setFilter(''); }}
          className="flex items-center gap-1 border border-gray-300 rounded px-2 py-2 text-sm bg-white w-28 shrink-0 hover:border-gray-400 text-left"
        >
          <span className="flex-1 truncate text-xs text-gray-700">{selectedLabel}</span>
          <ChevronDown size={12} className="shrink-0 text-gray-400" />
        </button>

        {userRole !== 'contributor' && (
          <button
            type="button"
            onClick={() => {
              if (userRole === 'admin') {
                setShowAddForm(f => !f);
                setShowNotifyModal(false);
              } else {
                setNotifyText(t('admin:archives.requestBody', { id: '', name: '' }));
                setNotifySent(false);
                setShowNotifyModal(true);
              }
            }}
            className="p-1 text-gray-400 hover:text-primary-600 border border-gray-300 rounded bg-white hover:border-primary-400"
            title={t('admin:archives.addArchive')}
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-56 bg-white border border-gray-200 rounded shadow-lg left-0 top-full">
          {showFilter && (
            <div className="p-1.5 border-b border-gray-100">
              <input
                autoFocus
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary-400"
                placeholder={t('common:buttons.search')}
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
            </div>
          )}
          <ul className="max-h-48 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-50"
                onClick={() => { onChange(''); setOpen(false); }}
              >
                — {t('admin:archives.selectPlaceholder')} —
              </button>
            </li>
            {filtered.map(([id, info]) => (
              <li key={id}>
                <button
                  type="button"
                  className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between hover:bg-gray-50 ${value === id ? 'font-medium text-primary-700' : 'text-gray-700'}`}
                  onClick={() => { onChange(id); setOpen(false); setFilter(''); }}
                >
                  <span><span className="font-medium">{id}</span> — {info.name}</span>
                  {value === id && <Check size={12} />}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-gray-400">{'Tulemusi ei leitud'}</li>
            )}
          </ul>
        </div>
      )}

      {showAddForm && (
        <div className="absolute z-50 mt-1 left-0 w-64 bg-white border border-gray-200 rounded shadow-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-600">{t('admin:archives.addArchive')}</p>
          <input
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-primary-400 outline-none"
            placeholder={t('admin:archives.idPlaceholder')}
            value={newId}
            onChange={e => { setNewId(e.target.value); setAddError(''); }}
          />
          <input
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-primary-400 outline-none"
            placeholder={t('admin:archives.name')}
            value={newName}
            onChange={e => { setNewName(e.target.value); setAddError(''); }}
          />
          <input
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-primary-400 outline-none"
            placeholder={t('admin:archives.url')}
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
          />
          {addError && <p className="text-xs text-red-600">{addError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAddAdmin}
              disabled={saving}
              className="flex-1 text-xs bg-primary-600 text-white rounded px-2 py-1.5 hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? '...' : t('common:buttons.save')}
            </button>
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setAddError(''); setNewId(''); setNewName(''); setNewUrl(''); }}
              className="text-xs text-gray-500 hover:text-gray-700 px-2"
            >
              {t('common:buttons.cancel')}
            </button>
          </div>
        </div>
      )}

      {showNotifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-xl p-4 w-80 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{t('admin:archives.requestTitle')}</p>
              <button type="button" onClick={() => setShowNotifyModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            {notifySent ? (
              <p className="text-sm text-green-700">{t('admin:archives.requestSent')}</p>
            ) : (
              <>
                <textarea
                  className="w-full border border-gray-300 rounded px-2 py-2 text-sm resize-none focus:ring-1 focus:ring-primary-400 outline-none"
                  rows={4}
                  value={notifyText}
                  onChange={e => setNotifyText(e.target.value)}
                />
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setShowNotifyModal(false)} className="text-sm text-gray-500 px-3 py-1.5">
                    {t('common:buttons.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleNotifySubmit}
                    disabled={saving || !notifyText.trim()}
                    className="text-sm bg-primary-600 text-white rounded px-3 py-1.5 hover:bg-primary-700 disabled:opacity-50"
                  >
                    {saving ? '...' : t('admin:archives.send')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ArchiveSelect;
