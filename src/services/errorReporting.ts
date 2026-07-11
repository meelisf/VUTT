import * as Sentry from '@sentry/react';

const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();

/** Eemaldab sündmusest kasutajaandmed ja päringute tundliku sisu. */
export function scrubErrorEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  delete event.user;

  if (event.request) {
    const url = event.request.url;
    event.request = {};
    if (url) {
      try {
        const parsed = new URL(url);
        event.request.url = `${parsed.origin}${parsed.pathname}`;
      } catch {
        // Vigast URL-i ei edastata.
      }
    }
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(({ data: _data, ...breadcrumb }) => breadcrumb);
  }
  return event;
}

/** Käivitab Sentry/GlitchTip integratsiooni ainult seadistatud DSN-i korral. */
export function initErrorReporting(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    beforeSend: scrubErrorEvent,
  });
}

export function reportError(error: unknown, context?: Record<string, string>): void {
  if (!dsn) return;
  Sentry.withScope((scope) => {
    if (context) scope.setTags(context);
    Sentry.captureException(error);
  });
}
