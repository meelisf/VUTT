import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, RotateCcw, Loader2 } from 'lucide-react';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
import { FILE_API_URL } from '../../config';

interface SpecialCharacter {
  character: string;
  name?: string;
}

interface CharSetEditorProps {
  characters: SpecialCharacter[];
  isCustom: boolean;
  authToken: string;
  onClose: () => void;
  onSaved: (characters: SpecialCharacter[], isCustom: boolean) => void;
}

const CharSetEditor: React.FC<CharSetEditorProps> = ({ characters, isCustom, authToken, onClose, onSaved }) => {
  const { t } = useTranslation(['workspace', 'common']);
  const [chars, setChars] = useState<SpecialCharacter[]>(characters);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const save = async (newChars: SpecialCharacter[], customFlag = true) => {
    setIsSaving(true);
    try {
      const res = await fetchWithTimeout(`${FILE_API_URL}/user-chars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_token: authToken, characters: newChars }),
        timeout: 10000,
      });
      if (!res.ok) {
        console.error('Erimärkide salvestamine ebaõnnestus:', res.status);
        return;
      }
      onSaved(newChars, customFlag);
    } catch (e) {
      console.error('Erimärkide salvestamine ebaõnnestus:', e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = (idx: number) => {
    const newChars = chars.filter((_, i) => i !== idx);
    setChars(newChars);
    save(newChars);
  };

  const handleAdd = (input: string) => {
    // Võta kõik unikaalsed märgid sisendist (unicode-teadlik)
    const candidates = [...input].filter(c => c.trim());
    if (candidates.length === 0) return;

    const newChars = [...chars];
    let changed = false;
    for (const char of candidates) {
      if (!newChars.some(c => c.character === char)) {
        newChars.push({ character: char });
        changed = true;
      }
    }
    if (!changed) return;

    setChars(newChars);
    save(newChars);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleReset = async () => {
    setIsSaving(true);
    try {
      await fetchWithTimeout(`${FILE_API_URL}/user-chars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_token: authToken, reset: true }),
        timeout: 10000,
      });
      // Hangi globaalsed vaikimisi märgid
      const res = await fetchWithTimeout(`${FILE_API_URL}/user-chars`, { headers: getAuthHeaders(authToken), timeout: 5000 });
      const data = await res.json();
      if (data.characters) {
        setChars(data.characters);
        onSaved(data.characters, false);
      }
    } catch (e) {
      console.error('Lähtestamine ebaõnnestus:', e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-80 mx-4" onClick={e => e.stopPropagation()}>
        {/* Päis */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-800">{t('editor.specialChars')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Olemasolevad märgid */}
          <div className="flex flex-wrap gap-1.5 min-h-[36px]">
            {chars.length === 0 ? (
              <span className="text-xs text-gray-400 italic self-center">
                {t('editor.noChars', 'Märke pole lisatud')}
              </span>
            ) : (
              chars.map((char, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-sm font-serif"
                  title={char.name}
                >
                  {char.character}
                  <button
                    onClick={() => handleRemove(idx)}
                    disabled={isSaving}
                    className="text-gray-400 hover:text-red-500 transition-colors ml-0.5 disabled:opacity-50"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))
            )}
          </div>

          {/* Lisa märk */}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              placeholder={t('editor.pasteChar', 'Kleebi sümbol...')}
              className="flex-1 border border-gray-200 rounded px-2 py-1 text-sm font-serif focus:outline-none focus:ring-1 focus:ring-primary-400"
              onPaste={(e) => {
                e.preventDefault();
                handleAdd(e.clipboardData.getData('text'));
              }}
            />
            <button
              onClick={() => {
                handleAdd(inputRef.current?.value || '');
              }}
              disabled={isSaving}
              className="px-3 py-1 bg-primary-600 text-white text-xs rounded hover:bg-primary-700 transition-colors disabled:opacity-50"
            >
              {t('editor.addChar', 'Lisa')}
            </button>
          </div>

          {/* Lähtesta vaikimisi */}
          {isCustom && (
            <button
              onClick={handleReset}
              disabled={isSaving}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
            >
              <RotateCcw size={11} />
              {t('editor.resetChars', 'Lähtesta vaikimisi')}
            </button>
          )}
        </div>

        {/* Salvestamise indikaator */}
        {isSaving && (
          <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-center gap-1.5 text-xs text-gray-400">
            <Loader2 size={11} className="animate-spin" />
            {t('editor.saving', 'Salvestan...')}
          </div>
        )}
      </div>
    </div>
  );
};

export default CharSetEditor;
