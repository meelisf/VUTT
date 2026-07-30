import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import App from './App';
import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import './index.css';
import { i18nReady, preloadOtherLanguage } from './i18n';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

/**
 * Laisa route-chunki ootamise vaade. Komponendina (mitte `i18n.t` kutsena
 * render'i hetkel), et hilisem keelevahetus jõuaks ka siia teksti kohale.
 */
const LoadingFallback: React.FC = () => {
  const { t } = useTranslation('common');
  return <div className="h-screen flex items-center justify-center">{t('labels.loading')}</div>;
};

const render = () => {
  root.render(
    <React.StrictMode>
      <Suspense fallback={<LoadingFallback />}>
        <App />
      </Suspense>
    </React.StrictMode>
  );
  // Teine keel jõudeajal vahemällu — keelevahetus ei jää siis chunki ootama.
  preloadOtherLanguage();
};

// Tõlked laetakse nüüd laisalt (#187), seega ootame esimese keele paki ära.
// Muidu vilguks rakendus hetkeks tõlkevõtmetega. Vea korral renderdame ikkagi —
// katkine tõlgete laadimine ei tohi jätta tühja lehte.
i18nReady.then(render).catch(error => {
  console.error('i18n init failed', error);
  render();
});
