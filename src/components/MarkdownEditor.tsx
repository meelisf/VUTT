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

  // Autosuuruse olek: viimati programmiliselt seatud kõrgus + kas kasutaja on
  // käsitsi suurust muutnud (siis autosuurus enam ei sekku).
  const autoHeightRef = useRef<number | null>(null);
  const userResizedRef = useRef(false);

  // Dünaamiline kõrgus: kasvab sisuga kuni MAX_HEIGHT, siis scroll.
  // Jätame vahele, kui kasutaja on tekstiala käsitsi suurust muutnud.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta || tab !== 'write' || userResizedRef.current) return;
    ta.style.height = 'auto';
    const next = Math.min(ta.scrollHeight, MAX_HEIGHT);
    ta.style.height = `${next}px`;
    ta.style.overflowY = ta.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
    autoHeightRef.current = next;
  }, [value, tab]);

  // Käsitsi suuruse muutmise tuvastus: kui pärast hiire vabastust on tekstiala
  // kõrgus muutunud võrreldes viimati programmiliselt seatuga, lülitame
  // autosuuruse välja ja lubame kerimise (et sisu ei jääks peitu).
  const handleTextareaMouseUp = () => {
    const ta = textareaRef.current;
    if (!ta || autoHeightRef.current === null) return;
    if (Math.abs(ta.offsetHeight - autoHeightRef.current) > 1) {
      userResizedRef.current = true;
      ta.style.overflowY = 'auto';
    }
  };

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

  // Tabi vahetus sulgeb avatud lingi-popoveri (muidu jääks see kuva üle hõljuma).
  const switchTab = (next: 'write' | 'preview') => {
    setLinkOpen(false);
    setTab(next);
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
          <button type="button" onClick={() => switchTab('write')} className={`px-2 py-1 rounded ${tab === 'write' ? 'bg-white border border-gray-300 font-medium' : 'text-gray-500'}`}>{t('markdownEditor.write')}</button>
          <button type="button" onClick={() => switchTab('preview')} className={`px-2 py-1 rounded ${tab === 'preview' ? 'bg-white border border-gray-300 font-medium' : 'text-gray-500'}`}>{t('markdownEditor.preview')}</button>
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
            onMouseUp={handleTextareaMouseUp}
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
