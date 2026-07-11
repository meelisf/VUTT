import { useRouteError, isRouteErrorResponse, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw, Home, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { reportError } from '../services/errorReporting';

// React Routeri errorElement — näitab kasutajasõbralikku veateadet marsruudi vigade korral
export default function RouteErrorBoundary() {
  const error = useRouteError();
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    reportError(error, { boundary: 'react-router' });
  }, [error]);

  // Veateade
  let errorMessage = t('errors.unknownError');
  if (isRouteErrorResponse(error)) {
    errorMessage = `${error.status} ${error.statusText}`;
  } else if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === 'string') {
    errorMessage = error;
  }

  // Stack trace (ainult dev-režiimis kasulik)
  const errorStack = error instanceof Error ? error.stack : undefined;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
        <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-red-500" />
        </div>

        <h1 className="text-lg font-bold text-gray-900 mb-2">
          {t('errors.boundaryTitle')}
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          {t('errors.boundaryDescription')}
        </p>

        <div className="flex gap-3 justify-center mb-4">
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
          >
            <RefreshCw size={14} />
            {t('errors.boundaryReload')}
          </button>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
          >
            <Home size={14} />
            {t('errors.boundaryHome')}
          </button>
        </div>

        {/* Kokkupandav veateade */}
        <div className="text-left">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors mx-auto"
          >
            <ChevronDown size={12} className={`transition-transform ${showDetails ? 'rotate-180' : ''}`} />
            {t('errors.boundaryDetails')}
          </button>
          {showDetails && (
            <div className="mt-2 p-3 bg-gray-50 rounded border border-gray-200 text-xs text-gray-600 font-mono overflow-auto max-h-48">
              <div>{errorMessage}</div>
              {errorStack && (
                <pre className="mt-2 text-[10px] text-gray-400 whitespace-pre-wrap">{errorStack}</pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
