import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';
import { initErrorReporting } from './services/errorReporting';
import 'leaflet/dist/leaflet.css';
import './index.css';
import './i18n';

initErrorReporting();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <Suspense fallback={<div className="h-screen flex items-center justify-center">Laadin...</div>}>
        <App />
      </Suspense>
    </GlobalErrorBoundary>
  </React.StrictMode>
);
