# Markdown Notes Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable, discoverable markdown editor (toolbar + preview) and a safe markdown renderer, then wire them into the prosopography Notes and Biography fields.

**Architecture:** Two domain-neutral components in `src/components/`: `MarkdownEditor` (textarea + formatting toolbar + write/preview tabs + link popover) and `MarkdownView` (react-markdown render with a strict element allow-list). All text-transform logic lives in pure, unit-tested helpers (`markdownEditorHelpers.ts`). No backend, data model, or migration changes — `notes`/`biography` stay plain markdown strings.

**Tech Stack:** React 19 + TypeScript, `react-markdown` (existing), `remark-gfm` (new), Tailwind, lucide-react icons, vitest (node env), react-i18next.

## Global Constraints

- **Markdown only — no raw HTML.** Do NOT use `rehype-raw`. Raw HTML must stay escaped.
- **Rendered DOM is allow-listed** to: `p, strong, em, del, a, ul, ol, li, h1, h2, h3, blockquote, code, br`, with `unwrapDisallowed`.
- **Components are domain-neutral** (`src/components/`) — no person/prosopography coupling. API takes only text in/out.
- **i18n in `common` namespace** (default NS) under key `markdownEditor`; add to BOTH `src/locales/et/common.json` and `src/locales/en/common.json`.
- **Tests are `.test.ts` only** (vitest `include: ['src/**/*.test.ts']`, `environment: 'node'`) — pure functions, no DOM. React components are verified by `npm run typecheck` + manual QA.
- **Frontend gate:** `npm run typecheck` (= `tsc --noEmit`), not just `build`.
- **v1 scope:** toolbar buttons only ADD syntax (no toggle/removal). No tables/footnotes/tasklists UI. No keyboard shortcuts.
- Tailwind brand classes in this repo: `primary-500/600/700`.

---

## File Structure

**Create:**
- `src/components/markdownEditorHelpers.ts` — pure text-transform functions
- `src/components/__tests__/markdownEditorHelpers.test.ts` — unit tests
- `src/components/MarkdownView.tsx` — safe markdown renderer
- `src/components/MarkdownEditor.tsx` — toolbar + preview + link popover

**Modify:**
- `package.json` — add `remark-gfm` dependency
- `src/index.css` — add `.vutt-md` styles
- `src/locales/et/common.json` — add `markdownEditor` block
- `src/locales/en/common.json` — add `markdownEditor` block
- `src/prosopography/pages/PersonEditPage.tsx` — Biography + Notes textareas → `MarkdownEditor`
- `src/prosopography/pages/PersonDetailPage.tsx` — Notes `<p>` + Biography `<ReactMarkdown>` → `MarkdownView`

---

## Task 1: Pure text-transform helpers

**Files:**
- Create: `src/components/markdownEditorHelpers.ts`
- Test: `src/components/__tests__/markdownEditorHelpers.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface SelectionResult { text: string; start: number; end: number }`
  - `interface LinkPrefill { linkText: string; url: string; focusField: 'text' | 'url' }`
  - `applyWrap(text: string, start: number, end: number, marker: string, placeholder: string): SelectionResult`
  - `applyLinePrefix(text: string, start: number, end: number, prefix: string, options?: { skipIfPresent?: boolean }): SelectionResult`
  - `looksLikeUrl(s: string): boolean`
  - `linkPrefillFromSelection(selected: string): LinkPrefill`
  - `insertLink(text: string, start: number, end: number, label: string, url: string): SelectionResult`

- [ ] **Step 1: Write the failing test**

Create `src/components/__tests__/markdownEditorHelpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  applyWrap,
  applyLinePrefix,
  looksLikeUrl,
  linkPrefillFromSelection,
  insertLink,
} from '../markdownEditorHelpers';

describe('applyWrap', () => {
  it('wraps a non-empty selection and keeps the inner text selected', () => {
    const r = applyWrap('Fischer', 0, 7, '**', 'paks');
    expect(r.text).toBe('**Fischer**');
    expect(r.start).toBe(2);
    expect(r.end).toBe(9);
  });

  it('inserts a placeholder when the selection is empty and selects it', () => {
    const r = applyWrap('', 0, 0, '**', 'paks');
    expect(r.text).toBe('**paks**');
    expect(r.start).toBe(2);
    expect(r.end).toBe(6);
  });

  it('wraps in the middle of existing text', () => {
    const r = applyWrap('a b c', 2, 3, '*', 'x');
    expect(r.text).toBe('a *b* c');
    expect(r.start).toBe(3);
    expect(r.end).toBe(4);
  });
});

describe('applyLinePrefix', () => {
  it('adds a heading prefix to the current line', () => {
    const r = applyLinePrefix('Title\nbody', 0, 0, '## ');
    expect(r.text).toBe('## Title\nbody');
  });

  it('prefixes every selected line for a list', () => {
    const r = applyLinePrefix('a\nb\nc', 0, 5, '- ', { skipIfPresent: true });
    expect(r.text).toBe('- a\n- b\n- c');
  });

  it('skips lines that already have the prefix (no duplication)', () => {
    const r = applyLinePrefix('- a\nb\nc', 0, 7, '- ', { skipIfPresent: true });
    expect(r.text).toBe('- a\n- b\n- c');
  });
});

describe('looksLikeUrl', () => {
  it('detects http/https/www', () => {
    expect(looksLikeUrl('https://archive.org/x')).toBe(true);
    expect(looksLikeUrl('  http://x ')).toBe(true);
    expect(looksLikeUrl('www.example.com')).toBe(true);
  });
  it('rejects plain text', () => {
    expect(looksLikeUrl('Johann Fischer')).toBe(false);
  });
});

describe('linkPrefillFromSelection', () => {
  it('prefills URL field when selection is a URL (focus on text)', () => {
    const p = linkPrefillFromSelection('https://archive.org/very/long');
    expect(p.url).toBe('https://archive.org/very/long');
    expect(p.linkText).toBe('');
    expect(p.focusField).toBe('text');
  });
  it('prefills link text when selection is plain text (focus on url)', () => {
    const p = linkPrefillFromSelection('Johann Fischer');
    expect(p.linkText).toBe('Johann Fischer');
    expect(p.url).toBe('');
    expect(p.focusField).toBe('url');
  });
  it('focuses text field when selection is empty', () => {
    const p = linkPrefillFromSelection('');
    expect(p.focusField).toBe('text');
  });
});

describe('insertLink', () => {
  it('replaces a selection with a markdown link', () => {
    const r = insertLink('Johann Fischer', 0, 14, 'Johann Fischer', 'http://x');
    expect(r.text).toBe('[Johann Fischer](http://x)');
    expect(r.start).toBe(r.end);
  });
  it('falls back to url as label when label empty', () => {
    const r = insertLink('', 0, 0, '', 'http://x');
    expect(r.text).toBe('[http://x](http://x)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/__tests__/markdownEditorHelpers.test.ts`
Expected: FAIL — `Cannot find module '../markdownEditorHelpers'`.

- [ ] **Step 3: Write the implementation**

Create `src/components/markdownEditorHelpers.ts`:

```ts
// Puhtad tekstiteisendused MarkdownEditor jaoks. DOM-vabad, unit-testitavad.

export interface SelectionResult {
  text: string;
  start: number;
  end: number;
}

export interface LinkPrefill {
  linkText: string;
  url: string;
  focusField: 'text' | 'url';
}

// Mähib valiku sümmeetrilise markeriga (** paksule, * kursiivile).
// Tühja valiku korral lisab markeri + kohahoidja ja valib kohahoidja.
export function applyWrap(
  text: string,
  start: number,
  end: number,
  marker: string,
  placeholder: string,
): SelectionResult {
  const selected = text.slice(start, end);
  if (selected.length === 0) {
    const inserted = `${marker}${placeholder}${marker}`;
    const newText = text.slice(0, start) + inserted + text.slice(end);
    const selStart = start + marker.length;
    return { text: newText, start: selStart, end: selStart + placeholder.length };
  }
  const inserted = `${marker}${selected}${marker}`;
  const newText = text.slice(0, start) + inserted + text.slice(end);
  const innerStart = start + marker.length;
  return { text: newText, start: innerStart, end: innerStart + selected.length };
}

// Lisab rea-prefiksi (nt "## " või "- ") iga valikus oleva rea algusesse.
// skipIfPresent: jätab vahele read, mis juba prefiksiga algavad (väldib topeldamist).
export function applyLinePrefix(
  text: string,
  start: number,
  end: number,
  prefix: string,
  options?: { skipIfPresent?: boolean },
): SelectionResult {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1; // 0 kui puudub
  let lineEnd = text.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = text.length;

  const block = text.slice(lineStart, lineEnd);
  const newBlock = block
    .split('\n')
    .map(line => (options?.skipIfPresent && line.startsWith(prefix) ? line : prefix + line))
    .join('\n');

  const newText = text.slice(0, lineStart) + newBlock + text.slice(lineEnd);
  return { text: newText, start: lineStart, end: lineStart + newBlock.length };
}

const URL_RE = /^(https?:\/\/|www\.)/i;

export function looksLikeUrl(s: string): boolean {
  return URL_RE.test(s.trim());
}

// Eeltäidab lingi-popoveri praeguse valiku põhjal.
export function linkPrefillFromSelection(selected: string): LinkPrefill {
  const trimmed = selected.trim();
  if (trimmed && looksLikeUrl(trimmed)) {
    return { linkText: '', url: trimmed, focusField: 'text' };
  }
  return { linkText: selected, url: '', focusField: trimmed ? 'url' : 'text' };
}

// Lisab markdown-lingi [label](url), asendades valiku. Kursor jääb lingi järele.
export function insertLink(
  text: string,
  start: number,
  end: number,
  label: string,
  url: string,
): SelectionResult {
  const safeUrl = url.trim();
  const safeLabel = label || safeUrl || 'link';
  const inserted = `[${safeLabel}](${safeUrl})`;
  const newText = text.slice(0, start) + inserted + text.slice(end);
  const cursor = start + inserted.length;
  return { text: newText, start: cursor, end: cursor };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/__tests__/markdownEditorHelpers.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/markdownEditorHelpers.ts src/components/__tests__/markdownEditorHelpers.test.ts
git commit -m "feat: markdown editor text-transform helpers + tests"
```

---

## Task 2: MarkdownView renderer + remark-gfm + CSS

**Files:**
- Modify: `package.json` (add `remark-gfm`)
- Create: `src/components/MarkdownView.tsx`
- Modify: `src/index.css` (append `.vutt-md` block)

**Interfaces:**
- Consumes: `react-markdown` (existing), `remark-gfm` (new)
- Produces: `MarkdownView` (default export), props `{ content: string; className?: string }`. Renders `null` when `content` is blank.

- [ ] **Step 1: Install remark-gfm**

Run: `npm install remark-gfm@^4.0.0`
Expected: `package.json` dependencies now include `remark-gfm`; `node_modules/remark-gfm` exists.

- [ ] **Step 2: Create the component**

Create `src/components/MarkdownView.tsx`:

```tsx
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Piiratud, turvaline markdown-renderdus (märkmed, elulugu jms).
// Ainult markdown — toores HTML escape'itud (ei kasuta rehype-raw'd).
// Renderduv DOM on allow-listitud; keelatud elementide tekst säilib (unwrapDisallowed).
const ALLOWED_ELEMENTS = [
  'p', 'strong', 'em', 'del', 'a',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3',
  'blockquote', 'code', 'br',
];

interface MarkdownViewProps {
  content: string;
  className?: string;
}

const MarkdownView: React.FC<MarkdownViewProps> = ({ content, className }) => {
  if (!content || !content.trim()) return null;
  return (
    <div className={['vutt-md', className].filter(Boolean).join(' ')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        allowedElements={ALLOWED_ELEMENTS}
        unwrapDisallowed
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownView;
```

- [ ] **Step 3: Append `.vutt-md` styles**

Append to the end of `src/index.css`:

```css
/* Markdown-renderdus märkmete/eluloo väljadel (.vutt-md) */
.vutt-md {
  overflow-wrap: break-word;
}
.vutt-md h1 { font-size: 1.5rem; font-weight: 700; margin: 0.5rem 0; }
.vutt-md h2 { font-size: 1.25rem; font-weight: 700; margin: 0.5rem 0; }
.vutt-md h3 { font-size: 1.1rem; font-weight: 600; margin: 0.5rem 0; }
.vutt-md p { margin: 0 0 0.75rem; }
.vutt-md p:last-child { margin-bottom: 0; }
.vutt-md ul { list-style: disc; padding-left: 1.5rem; margin: 0 0 0.75rem; }
.vutt-md ol { list-style: decimal; padding-left: 1.5rem; margin: 0 0 0.75rem; }
.vutt-md li { margin: 0.15rem 0; }
.vutt-md a { color: #2563eb; text-decoration: underline; overflow-wrap: anywhere; }
.vutt-md blockquote { border-left: 3px solid #e5e7eb; padding-left: 0.75rem; color: #4b5563; margin: 0 0 0.75rem; }
.vutt-md strong { font-weight: 700; }
.vutt-md em { font-style: italic; }
.vutt-md code { background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If react-markdown v10 types reject `node` in the `a` component, the `node: _node` rename keeps it unused-safe; confirm clean.)

- [ ] **Step 5: Build sanity**

Run: `npm run build`
Expected: build succeeds (confirms `remark-gfm` resolves in the bundle).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/MarkdownView.tsx src/index.css
git commit -m "feat: MarkdownView safe renderer (remark-gfm + allow-list) + .vutt-md styles"
```

---

## Task 3: MarkdownEditor component + i18n

**Files:**
- Create: `src/components/MarkdownEditor.tsx`
- Modify: `src/locales/et/common.json`
- Modify: `src/locales/en/common.json`

**Interfaces:**
- Consumes: `markdownEditorHelpers` (Task 1), `MarkdownView` (Task 2), `react-i18next`, `lucide-react`
- Produces: `MarkdownEditor` (default export), props:
  `{ value: string; onChange: (value: string) => void; placeholder?: string; minRows?: number; id?: string; disabled?: boolean }`

- [ ] **Step 1: Add Estonian i18n keys**

In `src/locales/et/common.json`, add a top-level `"markdownEditor"` block (sibling of `"buttons"`):

```json
  "markdownEditor": {
    "bold": "Paks",
    "italic": "Kursiiv",
    "heading": "Pealkiri",
    "link": "Lisa link",
    "list": "Loend",
    "help": "Vormindusabi",
    "write": "Kirjuta",
    "preview": "Eelvaade",
    "helpText": "Toetab markdownit: **paks**, *kursiiv*, # Pealkiri, [link](url), - loend",
    "linkText": "Lingi tekst",
    "linkUrl": "URL",
    "emptyPreview": "Pole midagi näidata",
    "boldPlaceholder": "paks tekst",
    "italicPlaceholder": "kursiiv"
  },
```

- [ ] **Step 2: Add English i18n keys**

In `src/locales/en/common.json`, add the matching block:

```json
  "markdownEditor": {
    "bold": "Bold",
    "italic": "Italic",
    "heading": "Heading",
    "link": "Insert link",
    "list": "List",
    "help": "Formatting help",
    "write": "Write",
    "preview": "Preview",
    "helpText": "Supports markdown: **bold**, *italic*, # Heading, [link](url), - list",
    "linkText": "Link text",
    "linkUrl": "URL",
    "emptyPreview": "Nothing to preview",
    "boldPlaceholder": "bold text",
    "italicPlaceholder": "italic"
  },
```

- [ ] **Step 3: Create the component**

Create `src/components/MarkdownEditor.tsx`:

```tsx
import React, { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bold, Italic, Heading, Link as LinkIcon, List, HelpCircle } from 'lucide-react';
import MarkdownView from './MarkdownView';
import {
  applyWrap,
  applyLinePrefix,
  insertLink,
  linkPrefillFromSelection,
  type SelectionResult,
} from './markdownEditorHelpers';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minRows?: number;
  id?: string;
  disabled?: boolean;
}

const MAX_HEIGHT = 500;

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  value, onChange, placeholder, minRows = 3, id, disabled,
}) => {
  const { t } = useTranslation('common');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [showHelp, setShowHelp] = useState(false);

  // Lingi-popover
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const savedSel = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const linkFirstFocus = useRef<'text' | 'url'>('text');
  const linkTextRef = useRef<HTMLInputElement>(null);
  const linkUrlRef = useRef<HTMLInputElement>(null);

  // Dünaamiline kõrgus: kasvab sisuga kuni MAX_HEIGHT, siis scroll.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta || tab !== 'write') return;
    ta.style.height = 'auto';
    const next = Math.min(ta.scrollHeight, MAX_HEIGHT);
    ta.style.height = `${next}px`;
    ta.style.overflowY = ta.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [value, tab]);

  const getSel = () => {
    const ta = textareaRef.current;
    return {
      start: ta?.selectionStart ?? value.length,
      end: ta?.selectionEnd ?? value.length,
    };
  };

  const applyResult = (res: SelectionResult) => {
    onChange(res.text);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(res.start, res.end);
    });
  };

  const handleBold = () => {
    const { start, end } = getSel();
    applyResult(applyWrap(value, start, end, '**', t('markdownEditor.boldPlaceholder')));
  };
  const handleItalic = () => {
    const { start, end } = getSel();
    applyResult(applyWrap(value, start, end, '*', t('markdownEditor.italicPlaceholder')));
  };
  const handleHeading = () => {
    const { start, end } = getSel();
    applyResult(applyLinePrefix(value, start, end, '## '));
  };
  const handleList = () => {
    const { start, end } = getSel();
    applyResult(applyLinePrefix(value, start, end, '- ', { skipIfPresent: true }));
  };

  const openLinkPopover = () => {
    const { start, end } = getSel();
    savedSel.current = { start, end };
    const prefill = linkPrefillFromSelection(value.slice(start, end));
    setLinkText(prefill.linkText);
    setLinkUrl(prefill.url);
    linkFirstFocus.current = prefill.focusField;
    setLinkOpen(true);
  };

  // Popoveri avamisel fookus esimesele väljale.
  useLayoutEffect(() => {
    if (!linkOpen) return;
    const target = linkFirstFocus.current === 'url' ? linkUrlRef.current : linkTextRef.current;
    target?.focus();
  }, [linkOpen]);

  const closeLinkPopover = () => {
    setLinkOpen(false);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(savedSel.current.start, savedSel.current.end);
    });
  };

  const confirmLink = () => {
    const { start, end } = savedSel.current;
    setLinkOpen(false);
    applyResult(insertLink(value, start, end, linkText, linkUrl));
  };

  const toolBtn = 'p-1.5 rounded hover:bg-gray-200 disabled:opacity-40';
  const editingDisabled = disabled || tab === 'preview';

  return (
    <div className="markdown-editor">
      {/* Nupuriba + tabid */}
      <div className="flex items-center justify-between border border-gray-300 rounded-t bg-gray-50 px-2 py-1">
        <div className="flex items-center gap-1">
          <button type="button" onClick={handleBold} disabled={editingDisabled} title={t('markdownEditor.bold')} className={toolBtn}><Bold size={16} /></button>
          <button type="button" onClick={handleItalic} disabled={editingDisabled} title={t('markdownEditor.italic')} className={toolBtn}><Italic size={16} /></button>
          <button type="button" onClick={handleHeading} disabled={editingDisabled} title={t('markdownEditor.heading')} className={toolBtn}><Heading size={16} /></button>
          <button type="button" onClick={openLinkPopover} disabled={editingDisabled} title={t('markdownEditor.link')} className={toolBtn}><LinkIcon size={16} /></button>
          <button type="button" onClick={handleList} disabled={editingDisabled} title={t('markdownEditor.list')} className={toolBtn}><List size={16} /></button>
          <button type="button" onClick={() => setShowHelp(v => !v)} title={t('markdownEditor.help')} className={`${toolBtn} text-gray-500`}><HelpCircle size={16} /></button>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <button type="button" onClick={() => setTab('write')} className={`px-2 py-1 rounded ${tab === 'write' ? 'bg-white border border-gray-300 font-medium' : 'text-gray-500'}`}>{t('markdownEditor.write')}</button>
          <button type="button" onClick={() => setTab('preview')} className={`px-2 py-1 rounded ${tab === 'preview' ? 'bg-white border border-gray-300 font-medium' : 'text-gray-500'}`}>{t('markdownEditor.preview')}</button>
        </div>
      </div>

      {showHelp && (
        <div className="border-x border-gray-300 bg-blue-50 px-3 py-2 text-xs text-gray-600">
          {t('markdownEditor.helpText')}
        </div>
      )}

      {/* Sisu */}
      <div className="relative">
        {tab === 'write' ? (
          <textarea
            ref={textareaRef}
            id={id}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            rows={minRows}
            onChange={e => onChange(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-b focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none resize-y font-mono leading-relaxed block"
          />
        ) : (
          <div className="w-full min-h-[80px] px-3 py-2 text-sm border border-gray-300 rounded-b bg-white">
            {value.trim()
              ? <MarkdownView content={value} />
              : <span className="text-gray-400">{t('markdownEditor.emptyPreview')}</span>}
          </div>
        )}

        {linkOpen && (
          <div
            className="absolute z-20 top-2 left-2 w-72 bg-white border border-gray-300 rounded shadow-lg p-3 space-y-2"
            onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); closeLinkPopover(); } }}
          >
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('markdownEditor.linkText')}</label>
              <input ref={linkTextRef} type="text" value={linkText} onChange={e => setLinkText(e.target.value)}
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded outline-none focus:ring-1 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('markdownEditor.linkUrl')}</label>
              <input ref={linkUrlRef} type="url" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://…"
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded outline-none focus:ring-1 focus:ring-primary-500" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={closeLinkPopover} className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded">{t('buttons.cancel')}</button>
              <button type="button" onClick={confirmLink} disabled={!linkUrl.trim()} className="px-2 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-40">{t('buttons.apply')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MarkdownEditor;
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Verify i18n JSON validity**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/et/common.json','utf8')); JSON.parse(require('fs').readFileSync('src/locales/en/common.json','utf8')); console.log('ok')"`
Expected: prints `ok` (both files are valid JSON — no trailing-comma errors).

- [ ] **Step 6: Commit**

```bash
git add src/components/MarkdownEditor.tsx src/locales/et/common.json src/locales/en/common.json
git commit -m "feat: MarkdownEditor (toolbar, preview tabs, link popover, autosize)"
```

---

## Task 4: Wire into Person pages

**Files:**
- Modify: `src/prosopography/pages/PersonEditPage.tsx`
- Modify: `src/prosopography/pages/PersonDetailPage.tsx`

**Interfaces:**
- Consumes: `MarkdownEditor` (Task 3), `MarkdownView` (Task 2)
- Produces: nothing (final integration)

- [ ] **Step 1: Import MarkdownEditor in PersonEditPage**

In `src/prosopography/pages/PersonEditPage.tsx`, add after the existing imports (near the top, after the lucide-react import line):

```tsx
import MarkdownEditor from '../../components/MarkdownEditor';
```

- [ ] **Step 2: Replace the Biography textarea**

In `src/prosopography/pages/PersonEditPage.tsx`, find the Biography block (currently around lines 592–603):

```tsx
        {/* ── Elulugu ── */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-5">
          <label className="block text-xs text-gray-500 uppercase tracking-wide mb-2">
            {t('biography', 'Elulugu')} <span className="font-normal lowercase">(markdown)</span>
          </label>
          <textarea
            value={draft.biography}
            onChange={e => set({ biography: e.target.value })}
            rows={8}
            placeholder={t('form.biographyPlaceholder')}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none resize-y font-mono leading-relaxed"
          />
        </div>
```

Replace with:

```tsx
        {/* ── Elulugu ── */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-5">
          <label className="block text-xs text-gray-500 uppercase tracking-wide mb-2">
            {t('biography', 'Elulugu')}
          </label>
          <MarkdownEditor
            value={draft.biography}
            onChange={v => set({ biography: v })}
            minRows={8}
            placeholder={t('form.biographyPlaceholder')}
          />
        </div>
```

- [ ] **Step 3: Replace the Notes textarea**

In `src/prosopography/pages/PersonEditPage.tsx`, find the Notes block (currently around lines 836–847):

```tsx
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
              {t('notes', 'Märkmed')}
            </label>
            <textarea
              value={draft.notes}
              onChange={e => set({ notes: e.target.value })}
              rows={3}
              placeholder={t('form.notesPlaceholder')}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none resize-y"
            />
          </div>
```

Replace with:

```tsx
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
              {t('notes', 'Märkmed')}
            </label>
            <MarkdownEditor
              value={draft.notes}
              onChange={v => set({ notes: v })}
              minRows={3}
              placeholder={t('form.notesPlaceholder')}
            />
          </div>
```

- [ ] **Step 4: Swap renderers in PersonDetailPage**

In `src/prosopography/pages/PersonDetailPage.tsx`:

(a) Replace the `react-markdown` import at line 4:

```tsx
import ReactMarkdown from 'react-markdown';
```

with:

```tsx
import MarkdownView from '../../components/MarkdownView';
```

(b) Replace the Biography render block (around lines 638–645):

```tsx
        {/* ── Elulugu ── */}
        {person.biography && (
          <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
            <CardHeader icon={<BookMarked size={18} />} title={t('biography', 'Elulugu')} />
            <div className="markdown-preview text-sm text-gray-800 leading-relaxed">
              <ReactMarkdown>{person.biography}</ReactMarkdown>
            </div>
          </div>
        )}
```

with:

```tsx
        {/* ── Elulugu ── */}
        {person.biography && (
          <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
            <CardHeader icon={<BookMarked size={18} />} title={t('biography', 'Elulugu')} />
            <MarkdownView content={person.biography} className="text-sm text-gray-800 leading-relaxed" />
          </div>
        )}
```

(c) Replace the Notes render (around lines 746–752):

```tsx
        {/* ── Märkmed ── */}
        {person.notes && (
          <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
            <CardHeader icon={<StickyNote size={18} />} title={t('notes', 'Märkmed')} />
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{person.notes}</p>
          </div>
        )}
```

with:

```tsx
        {/* ── Märkmed ── */}
        {person.notes && (
          <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
            <CardHeader icon={<StickyNote size={18} />} title={t('notes', 'Märkmed')} />
            <MarkdownView content={person.notes} className="text-sm text-gray-700" />
          </div>
        )}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Confirms the old `ReactMarkdown` import is fully removed and nothing else references it.)

- [ ] **Step 6: Full test + build**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds.

- [ ] **Step 7: Manual QA (browser, `npm run dev`)**

On a person edit page and detail page, confirm:
- Toolbar visible above Notes and Biography; B/I/H/🔗/• and `?` work.
- Bold/italic on a selection insert `**…**` / `*…*`; on empty selection insert a placeholder.
- Heading prefixes the line with `## `; List prefixes selected lines with `- ` and does not duplicate on already-prefixed lines.
- Link button: with a plain-text selection prefills link text and focuses URL; with a URL selection prefills URL and focuses link text; Esc/Cancel returns focus to the textarea at the saved position; Apply inserts `[text](url)`.
- Preview tab renders headings/bold/italic/links/lists; bare long URLs are clickable and wrap (no layout overflow).
- Detail page: Notes and Biography render markdown; a pasted GFM table appears as run-on text (not a table) and is not too confusing.

- [ ] **Step 8: Commit**

```bash
git add src/prosopography/pages/PersonEditPage.tsx src/prosopography/pages/PersonDetailPage.tsx
git commit -m "feat: use MarkdownEditor/MarkdownView for person notes and biography"
```

---

## Self-Review Notes

- **Spec coverage:** MarkdownEditor (toolbar B/I/H/link/list, write/preview tabs default Write, `?` help, link popover with prefill + focus mgmt, autosize, undo limitation documented) → Task 3. MarkdownView (remark-gfm, allowedElements, unwrapDisallowed, urlTransform safety, `_blank`/`noopener`, null on blank) → Task 2. `.vutt-md` CSS (`anywhere` links, p-margin, ul/ol padding) → Task 2. Pure helpers + 5 spec test cases → Task 1. Integration into Notes + Biography on both pages → Task 4. Markdown-only/no rehype-raw, common-namespace i18n, domain-neutral API → Global Constraints + respective tasks.
- **Type consistency:** `SelectionResult`/`LinkPrefill` defined in Task 1 and consumed verbatim in Task 3; `MarkdownView` props `{content, className}` defined Task 2, used Task 3 (preview) and Task 4 (detail page); `MarkdownEditor` props defined Task 3, used Task 4.
- **No placeholders:** every code step contains full code; every run step has an expected result.
- **Deferred (per spec YAGNI):** page/work notes fields stay unchanged (API ready only); no toggle-removal, side-by-side preview, tables UI, or keyboard shortcuts.
```