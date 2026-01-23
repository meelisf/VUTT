// Konfiguratsioon
// PRODUCTION HTTPS CONFIG - Fixed for Meilisearch SDK

// Meilisearch JS SDK vajab TÄIELIKKU URL-i, mitte suhtelist teekonda
// Seega kasutame window.location.origin + /meili
const getMeiliHost = (): string => {
  if (typeof window !== 'undefined') {
    // Brauseris: kasuta praegust domeeni
    return `${window.location.origin}/meili`;
  }
  // Fallback (SSR vms)
  return '/meili';
};

// Need API-d kasutavad fetch()-i, mis toetab suhtelisi URL-e
export const MEILI_HOST = getMeiliHost();
export const MEILI_API_KEY = import.meta.env.VITE_MEILI_SEARCH_API_KEY || '';
export const IMAGE_BASE_URL = '/api/images';
export const FILE_API_URL = '/api/files';

export const MEILI_INDEX = 'teosed';

console.log("VUTT Config Loaded:", { MEILI_HOST, IMAGE_BASE_URL, FILE_API_URL });
