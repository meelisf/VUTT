
// Konfiguratsioon
// Sinu Meilisearch serveri aadress
export const MEILI_HOST = 'http://172.17.120.146:7700';

// Sinu Meilisearch Master Key (keskkonnamuutujast)
// Loo fail .env.local ja lisa: MEILI_API_KEY=sinu_võti
export const MEILI_API_KEY = process.env.MEILI_API_KEY || ''; 

// Pildiserveri aadress (python http.server)
export const IMAGE_BASE_URL = 'http://172.17.120.146:8001';

// API server failide salvestamiseks (jookseb samas masinas kus pildid, aga vajab uut skripti)
export const FILE_API_URL = 'http://172.17.120.146:8002';

export const MEILI_INDEX = 'teosed';
