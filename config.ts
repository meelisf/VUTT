
// Konfiguratsioon
// Sinu Meilisearch serveri aadress
export const MEILI_HOST = 'http://172.17.120.146:7700';

// Sinu Meilisearch Master Key
export const MEILI_API_KEY = process.env.MEILISEARCH_MASTER_KEY || 'de32f842cb3c0459719aba3d59d659cb2c83bdcb6549da3a242fefbb4e02b1d9'; 

// Pildiserveri aadress (python http.server)
export const IMAGE_BASE_URL = 'http://172.17.120.146:8001';

// API server failide salvestamiseks (jookseb samas masinas kus pildid, aga vajab uut skripti)
export const FILE_API_URL = 'http://172.17.120.146:8002';

export const MEILI_INDEX = 'teosed';
