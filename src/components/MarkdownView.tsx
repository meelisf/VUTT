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
