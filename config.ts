
// Konfiguratsioon

// Meilisearchi aadress
// PROD (Nginx): '/meili' (suunatakse nginxist)
// DEV (npm run dev): 'http://LOCALHOST:7700' (või sinu serveri IP)
const IS_PROD = import.meta.env.PROD; // Vite automaatne muutuja

// Kui oleme productionis (builditud), eeldame et Nginx proxy-b päringud
// Kui oleme dev modes, kasutame otse IP-sid (muuda need vastavalt oma võrgule kui vaja)
const DEV_IP = '172.17.120.146'; // Sinu arvuti IP arenduses

export const MEILI_HOST = IS_PROD ? '/meili' : `http://${DEV_IP}:7700`;

// API võtmed
export const MEILI_API_KEY = import.meta.env.VITE_MEILI_API_KEY || '';

// Pildiserver
export const IMAGE_BASE_URL = IS_PROD ? '/api/images' : `http://${DEV_IP}:8001`;

// Failiserver
export const FILE_API_URL = IS_PROD ? '/api/files' : `http://${DEV_IP}:8002`;

export const MEILI_INDEX = 'teosed';
