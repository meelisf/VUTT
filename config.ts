// Konfiguratsioon

// PROD = builditud versioon, DEV = npm run dev
const IS_PROD = import.meta.env.PROD;

// ========================================
// DEPLOYMENT MODE - muuda vastavalt serverile
// ========================================
// 'nginx'  = HTTPS/production, Nginx proxy suunab /meili jne backendidele
// 'direct' = HTTP/sisevõrk, otse backendi portidele (7700, 8001, 8002)
const DEPLOYMENT_MODE: 'nginx' | 'direct' = 'direct';

// Dünaamiline hostname (direct mode jaoks)
const getServerHost = () => {
  if (typeof window !== 'undefined') {
    return window.location.hostname;
  }
  return 'localhost';
};

// API URL-id
const useProxy = !IS_PROD || DEPLOYMENT_MODE === 'nginx';

export const MEILI_HOST = useProxy ? '/meili' : `http://${getServerHost()}:7700`;
export const MEILI_API_KEY = import.meta.env.VITE_MEILI_API_KEY || '';
export const IMAGE_BASE_URL = useProxy ? '/api/images' : `http://${getServerHost()}:8001`;
export const FILE_API_URL = useProxy ? '/api/files' : `http://${getServerHost()}:8002`;

export const MEILI_INDEX = 'teosed';
