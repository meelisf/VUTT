import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  FileEdit,
  Check,
  X,
  Loader2,
  AlertTriangle,
  Clock,
  User,
  FileText,
  Image as ImageIcon,
  ChevronDown,
  ChevronUp,
  LogOut,
  Settings
} from 'lucide-react';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { FILE_API_URL, IMAGE_BASE_URL } from '../config';
import { useUser } from '../contexts/UserContext';

interface PendingEdit {
  id: string;
  teose_id: string;
  lehekylje_number: number;
  user: string;
  user_name: string;
  role_at_submission: string;
  submitted_at: string;
  original_text: string;
  new_text: string;
  base_text_hash: string;
  status: string;
  has_conflict: boolean;
  conflict_type: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
}

// Sõna-taseme diff: võrdleb kahte stringi ja tagastab esiletõstetud JSX elemendid
const getWordDiff = (oldStr: string, newStr: string): { oldParts: React.ReactNode[]; newParts: React.ReactNode[] } => {
  // Tükeldame sõnadeks, säilitades tühikud
  const tokenize = (s: string): string[] => {
    const tokens: string[] = [];
    let current = '';
    for (const char of s) {
      if (char === ' ' || char === '\t') {
        if (current) tokens.push(current);
        tokens.push(char);
        current = '';
      } else {
        current += char;
      }
    }
    if (current) tokens.push(current);
    return tokens;
  };

  const oldTokens = tokenize(oldStr);
  const newTokens = tokenize(newStr);

  // Leia pikima ühise alamjada (LCS) lihtsustatud versioon
  // Märgime ära, millised tokenid on mõlemas
  const oldInNew = new Set<number>();
  const newInOld = new Set<number>();

  // Lihtne greedy matching: käime läbi ja otsime vasteid
  let newIdx = 0;
  for (let i = 0; i < oldTokens.length; i++) {
    // Otsi see token uuest stringist alates newIdx-st
    for (let j = newIdx; j < newTokens.length; j++) {
      if (oldTokens[i] === newTokens[j] && oldTokens[i].trim() !== '') {
        oldInNew.add(i);
        newInOld.add(j);
        newIdx = j + 1;
        break;
      }
    }
  }

  // Ehitame JSX elemendid
  const oldParts: React.ReactNode[] = oldTokens.map((token, i) => {
    if (oldInNew.has(i)) {
      return <span key={i}>{token}</span>;
    } else {
      return <span key={i} className="bg-red-300 rounded px-0.5">{token}</span>;
    }
  });

  const newParts: React.ReactNode[] = newTokens.map((token, i) => {
    if (newInOld.has(i)) {
      return <span key={i}>{token}</span>;
    } else {
      return <span key={i} className="bg-green-300 rounded px-0.5">{token}</span>;
    }
  });

  return { oldParts, newParts };
};

// Diff-komponent: näitab ridade erinevusi sõna-taseme esiletõstmisega
const DiffView: React.FC<{ original: string; modified: string }> = ({ original, modified }) => {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');

  // Lihtne ridade võrdlus
  const maxLines = Math.max(originalLines.length, modifiedLines.length);
  const diffLines: { type: 'same' | 'removed' | 'added' | 'changed'; original?: string; modified?: string; lineNum: number }[] = [];

  for (let i = 0; i < maxLines; i++) {
    const origLine = originalLines[i];
    const modLine = modifiedLines[i];

    if (origLine === modLine) {
      diffLines.push({ type: 'same', original: origLine, lineNum: i + 1 });
    } else if (origLine === undefined) {
      diffLines.push({ type: 'added', modified: modLine, lineNum: i + 1 });
    } else if (modLine === undefined) {
      diffLines.push({ type: 'removed', original: origLine, lineNum: i + 1 });
    } else {
      diffLines.push({ type: 'changed', original: origLine, modified: modLine, lineNum: i + 1 });
    }
  }

  return (
    <div className="font-mono text-sm border rounded-lg overflow-hidden">
      {diffLines.map((line, idx) => {
        // Muutunud ridade puhul arvutame sõna-taseme diff'i
        const wordDiff = line.type === 'changed' && line.original && line.modified
          ? getWordDiff(line.original, line.modified)
          : null;

        return (
          <div key={idx} className="flex">
            <span className="w-10 px-2 py-0.5 text-gray-400 text-right bg-gray-50 border-r select-none flex-shrink-0">
              {line.lineNum}
            </span>
            <div className="flex-1 min-w-0">
              {line.type === 'same' && (
                <div className="px-2 py-0.5 text-gray-700 whitespace-pre-wrap break-all">{line.original}</div>
              )}
              {line.type === 'removed' && (
                <div className="px-2 py-0.5 bg-red-100 text-red-800 whitespace-pre-wrap break-all">
                  <span className="text-red-500 mr-1">-</span>{line.original}
                </div>
              )}
              {line.type === 'added' && (
                <div className="px-2 py-0.5 bg-green-100 text-green-800 whitespace-pre-wrap break-all">
                  <span className="text-green-500 mr-1">+</span>{line.modified}
                </div>
              )}
              {line.type === 'changed' && wordDiff && (
                <>
                  <div className="px-2 py-0.5 bg-red-100 text-red-800 whitespace-pre-wrap break-all">
                    <span className="text-red-500 mr-1">-</span>{wordDiff.oldParts}
                  </div>
                  <div className="px-2 py-0.5 bg-green-100 text-green-800 whitespace-pre-wrap break-all">
                    <span className="text-green-500 mr-1">+</span>{wordDiff.newParts}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const Review: React.FC = () => {
  const { t } = useTranslation(['review', 'common', 'auth']);
  const { user, authToken, logout, isLoading: userLoading } = useUser();
  const navigate = useNavigate();

  const [pendingEdits, setPendingEdits] = useState<PendingEdit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  // Laiendatud muudatus detailvaate jaoks
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Töötlemise staatus
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Kontrolli ligipääsu
  useEffect(() => {
    if (!userLoading && (!user || !['editor', 'admin'].includes(user.role))) {
      navigate('/');
    }
  }, [user, userLoading, navigate]);

  // Lae ootel muudatused
  useEffect(() => {
    if (authToken && user && ['editor', 'admin'].includes(user.role)) {
      loadPendingEdits();
    }
  }, [authToken, user]);

  const loadPendingEdits = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${FILE_API_URL}/pending-edits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_token: authToken })
      });

      const data = await response.json();

      if (data.status === 'success') {
        setPendingEdits(data.pending_edits);
      } else {
        setError(data.message || 'Viga muudatuste laadimisel');
      }
    } catch (e) {
      console.error('Load pending edits error:', e);
      setError('Serveriga ühendamine ebaõnnestus');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (editId: string) => {
    setProcessingId(editId);

    try {
      const response = await fetch(`${FILE_API_URL}/pending-edits/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: authToken,
          edit_id: editId
        })
      });

      const data = await response.json();

      if (data.status === 'success') {
        await loadPendingEdits();
        setExpandedId(null);
      } else {
        setError(data.message || 'Kinnitamine ebaõnnestus');
      }
    } catch (e) {
      console.error('Approve error:', e);
      setError('Serveriga ühendamine ebaõnnestus');
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (editId: string) => {
    setProcessingId(editId);

    try {
      const response = await fetch(`${FILE_API_URL}/pending-edits/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: authToken,
          edit_id: editId
        })
      });

      const data = await response.json();

      if (data.status === 'success') {
        await loadPendingEdits();
        setExpandedId(null);
      } else {
        setError(data.message || 'Tagasilükkamine ebaõnnestus');
      }
    } catch (e) {
      console.error('Reject error:', e);
      setError('Serveriga ühendamine ebaõnnestus');
    } finally {
      setProcessingId(null);
    }
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString('et-EE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getConflictLabel = (edit: PendingEdit) => {
    if (!edit.has_conflict) return null;

    switch (edit.conflict_type) {
      case 'other_pending':
        return t('conflicts.otherPending');
      case 'base_changed':
        return t('conflicts.baseChanged');
      case 'both':
        return t('conflicts.both');
      default:
        return null;
    }
  };

  if (userLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between flex-shrink-0 shadow-sm">
        <Link to="/" className="hover:opacity-80 transition-opacity flex items-center gap-3">
          <img src="/logo.png" alt="VUTT Logo" className="h-10 w-auto" />
          <div>
            <h1 className="text-2xl font-bold text-primary-900 tracking-tight leading-none">{t('common:app.name')}</h1>
            <p className="text-xs text-gray-500 font-medium tracking-wide uppercase leading-none mt-0.5">{t('common:app.subtitle')}</p>
          </div>
        </Link>
        <div className="flex items-center gap-4">
          {/* Kasutaja rippmenüü */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 hover:bg-gray-100 rounded-lg px-2 py-1 transition-colors"
            >
              <div className="text-right hidden sm:block">
                <p className="text-sm font-semibold text-gray-900">{user.name}</p>
                <p className="text-xs text-gray-500">{t(`common:roles.${user.role}`)}</p>
              </div>
              <div className="h-9 w-9 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 font-bold border-2 border-primary-200 text-sm">
                {user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <ChevronDown size={16} className={`text-gray-400 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
            </button>

            {showUserMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-48 z-50">
                  <div className="sm:hidden px-4 py-2 border-b border-gray-100">
                    <p className="font-medium text-gray-900">{user.name}</p>
                    <p className="text-xs text-gray-500">{t(`common:roles.${user.role}`)}</p>
                  </div>

                  <Link
                    to="/review"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <FileEdit size={16} />
                    {t('common:nav.review')}
                  </Link>

                  {user.role === 'admin' && (
                    <Link
                      to="/admin"
                      onClick={() => setShowUserMenu(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <Settings size={16} />
                      {t('common:nav.admin')}
                    </Link>
                  )}

                  <div className="border-t border-gray-100 my-1" />

                  <button
                    onClick={() => { setShowUserMenu(false); logout(); }}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 w-full"
                  >
                    <LogOut size={16} />
                    {t('auth:login.logout')}
                  </button>
                </div>
              </>
            )}
          </div>
          <LanguageSwitcher />
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
            <FileEdit className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
            <p className="text-sm text-gray-500">{t('subtitle')}</p>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          </div>
        ) : pendingEdits.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <FileEdit size={48} className="mx-auto mb-4 text-gray-300" />
            <p className="text-gray-500">{t('empty')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingEdits.map((edit) => (
              <div key={edit.id} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                {/* Kokkuvõte rida */}
                <div
                  className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedId(expandedId === edit.id ? null : edit.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <User size={16} className="text-gray-400" />
                        <span className="font-medium text-gray-900">{edit.user_name}</span>
                        <span className="text-sm text-gray-500">({edit.user})</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <FileText size={14} />
                        <Link
                          to={`/work/${edit.teose_id}/${edit.lehekylje_number}`}
                          className="hover:text-primary-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {edit.teose_id} / lk {edit.lehekylje_number}
                        </Link>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Clock size={14} />
                        {formatDate(edit.submitted_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {edit.has_conflict && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
                          <AlertTriangle size={12} />
                          {t('list.conflict')}
                        </span>
                      )}
                      {expandedId === edit.id ? (
                        <ChevronUp size={20} className="text-gray-400" />
                      ) : (
                        <ChevronDown size={20} className="text-gray-400" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Laiendatud detailvaade */}
                {expandedId === edit.id && (
                  <div className="border-t border-gray-200">
                    {/* Konflikti hoiatus */}
                    {edit.has_conflict && (
                      <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 flex items-start gap-2">
                        <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                        <p className="text-sm text-amber-800">{getConflictLabel(edit)}</p>
                      </div>
                    )}

                    <div className="p-4">
                      {/* Diff vaade */}
                      <h3 className="text-sm font-medium text-gray-700 mb-2">{t('detail.diff')}</h3>
                      <div className="mb-4 max-h-96 overflow-y-auto">
                        <DiffView original={edit.original_text} modified={edit.new_text} />
                      </div>

                      {/* Link pildiga kõrvutamiseks */}
                      <div className="mb-4">
                        <Link
                          to={`/work/${edit.teose_id}/${edit.lehekylje_number}`}
                          className="inline-flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700"
                        >
                          <ImageIcon size={16} />
                          Ava Workspace'is pildiga kõrvutamiseks
                        </Link>
                      </div>

                      {/* Nupud */}
                      <div className="flex gap-3 pt-4 border-t border-gray-200">
                        <button
                          onClick={() => handleApprove(edit.id)}
                          disabled={processingId === edit.id}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-green-400 transition-colors flex items-center gap-2"
                        >
                          {processingId === edit.id ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Check size={16} />
                          )}
                          {t('actions.approve')}
                        </button>
                        <button
                          onClick={() => handleReject(edit.id)}
                          disabled={processingId === edit.id}
                          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-red-400 transition-colors flex items-center gap-2"
                        >
                          {processingId === edit.id ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <X size={16} />
                          )}
                          {t('actions.reject')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        </div>
      </main>
    </div>
  );
};

export default Review;
