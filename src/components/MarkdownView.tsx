import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

// Piiratud, turvaline markdown-renderdus (märkmed, elulugu, kommentaarid).
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
  // softBreaks: single newline → <br> (remark-breaks). Vajalik vanade plain-text
  // kommentaaride reavahetuste säilitamiseks. Prosopo ei kasuta (vaikimisi false).
  softBreaks?: boolean;
}

const MarkdownView: React.FC<MarkdownViewProps> = ({ content, className, softBreaks }) => {
  if (!content || !content.trim()) return null;
  const remarkPlugins = softBreaks ? [remarkGfm, remarkBreaks] : [remarkGfm];
  return (
    <div className={['vutt-md', className].filter(Boolean).join(' ')}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
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
