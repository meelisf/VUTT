import React from 'react';
import { sanitizeHighlight, escapeHtml } from '../utils/sanitizeHtml';

// Üks keskne koht HTML-i renderdamiseks Reactis. Uusi dangerouslySetInnerHTML
// otsekasutusi ei lisata komponentidesse; vali siin allikas ja sanitiseerimisreegel.
type SafeHtmlKind =
  | 'highlight'    // Meilisearch _formatted väljad: escape kõik, taasta ainult <em> highlight
  | 'translation'  // i18n stringid: escape kõik, taasta ainult <strong>
  | 'generated'    // rakenduse enda parseri genereeritud HTML (sisend on enne escape'itud)
  | 'trusted';     // staatilised repo/public HTML failid, mitte kasutajasisu

interface SafeHtmlProps {
  html: string;
  kind: SafeHtmlKind;
  as?: 'div' | 'span';
  className?: string;
  style?: React.CSSProperties;
  allowBr?: boolean;
}

function sanitizeTranslationHtml(html: string): string {
  return escapeHtml(html)
    .split('&lt;strong&gt;').join('<strong>')
    .split('&lt;/strong&gt;').join('</strong>');
}

function prepareHtml(kind: SafeHtmlKind, html: string, allowBr?: boolean): string {
  if (kind === 'highlight') return sanitizeHighlight(html, { allowBr });
  if (kind === 'translation') return sanitizeTranslationHtml(html);
  return html;
}

const SafeHtml: React.FC<SafeHtmlProps> = ({ html, kind, as = 'div', className, style, allowBr }) => {
  const Element = as;
  return (
    <Element
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: prepareHtml(kind, html, allowBr) }}
    />
  );
};

export default SafeHtml;
