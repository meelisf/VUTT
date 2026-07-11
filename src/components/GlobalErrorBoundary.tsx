import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import i18n from '../i18n';
import { reportError } from '../services/errorReporting';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/** Püüab kinni ka väljaspool React Routerit tekkinud renderdusvead. */
export default class GlobalErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, { boundary: 'global-react' });
    console.error('Globaalne Reacti renderdusviga', error, info);
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-6 h-6 text-red-500" />
          </div>
          <h1 className="text-lg font-bold text-gray-900 mb-2">{i18n.t('common:errors.boundaryTitle')}</h1>
          <p className="text-sm text-gray-500 mb-6">{i18n.t('common:errors.boundaryDescription')}</p>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700"
          >
            <RefreshCw size={14} />
            {i18n.t('common:errors.boundaryReload')}
          </button>
        </div>
      </div>
    );
  }
}
