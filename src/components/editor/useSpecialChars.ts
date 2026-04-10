import { useState, useEffect } from 'react';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
import { FILE_API_URL } from '../../config';

export interface SpecialCharacter {
  row?: number;
  character: string;
  name?: string;
  keyboard_code?: number | null;
}

interface UseSpecialCharsReturn {
  specialCharacters: SpecialCharacter[];
  isCustomChars: boolean;
  showCharPanel: boolean;
  setShowCharPanel: (v: boolean) => void;
  showCharEditor: boolean;
  setShowCharEditor: (v: boolean) => void;
  setSpecialCharacters: (chars: SpecialCharacter[]) => void;
  setIsCustomChars: (v: boolean) => void;
}

export function useSpecialChars(authToken: string | null): UseSpecialCharsReturn {
  const [specialCharacters, setSpecialCharacters] = useState<SpecialCharacter[]>([]);
  const [isCustomChars, setIsCustomChars] = useState(false);
  const [showCharPanel, setShowCharPanel] = useState(true);
  const [showCharEditor, setShowCharEditor] = useState(false);

  // Laadime erimärgid
  useEffect(() => {
    const loadSpecialCharacters = async () => {
      try {
        if (authToken) {
          const response = await fetchWithTimeout(`${FILE_API_URL}/user-chars`, { headers: getAuthHeaders(authToken), timeout: 5000 });
          if (response.ok) {
            const data = await response.json();
            if (data.is_custom) {
              setSpecialCharacters(data.characters || []);
              setIsCustomChars(true);
              return;
            }
          }
        }
        const response = await fetchWithTimeout('/special_characters.json', { timeout: 5000 });
        if (response.ok) {
          const data = await response.json();
          setSpecialCharacters(data.characters || []);
          setIsCustomChars(false);
        }
      } catch (e) {
        console.warn('Erimärkide laadimine ebaõnnestus:', e);
      }
    };
    loadSpecialCharacters();
  }, [authToken]);

  return {
    specialCharacters,
    isCustomChars,
    showCharPanel,
    setShowCharPanel,
    showCharEditor,
    setShowCharEditor,
    setSpecialCharacters,
    setIsCustomChars,
  };
}
