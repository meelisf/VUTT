import React, { useMemo } from 'react';

// Line-by-Line Strict Renderer with Stateful Styling
// This component guarantees 1:1 alignment with the editor's gutter numbers
// and supports multi-line styles (bold, italic, etc.) by maintaining state across lines.

interface MarkdownPreviewProps {
    content: string;
}

interface Token {
    id: string;
    regex?: RegExp; // Symmetric tokens use this
    startRegex?: RegExp; // Asymmetric tokens (start)
    endRegex?: RegExp; // Asymmetric tokens (end)
    tag: string;
    className?: string;
}

const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content }) => {

    // Helper to escape HTML safely
    const escapeHtml = (text: string) => {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };

    // 1. Process "Atomic" items that strictly do not span lines or need state
    const processAtomic = (text: string) => {
        let processed = escapeHtml(text);

        // Page break: --lk--
        processed = processed.replace(/--lk--/g, '<hr class="page-break" />');

        // Footnotes: [^1] (lookahead to avoid matching definition)
        processed = processed.replace(/\[\^(\w+)\](?!\:)/g, '<span class="footnote-marker">$1</span>');

        // Footnote definitions: [^1]: text
        processed = processed.replace(
            /^\[\^(\w+)\]:\s*(.*)/,
            '<span class="footnote-def-number">$1.</span> $2'
        );

        return processed;
    };

    // 2. Stateful Parser Configuration
    const TOKENS: Token[] = [
        { id: 'bold', regex: /\*\*/, tag: 'strong' },
        { id: 'italic', regex: /\*/, tag: 'em' },
        { id: 'code', regex: /~/, tag: 'span', className: 'code-switch' },
        { id: 'highlight', regex: /==/, tag: 'mark' },
        { id: 'marginalia', startRegex: /\[\[m:/, endRegex: /\]\]/, tag: 'span', className: 'marginalia-highlight' }
    ];

    // Main render logic
    // We iterate through lines to ensure strict 1-to-1 mapping with line numbers.
    // However, we maintain activeStyles (Set) to support styling that spans multiple lines.
    const renderedLines = useMemo(() => {
        const rawLines = content.split('\n');
        const outputLines: { html: string, className: string }[] = [];

        // Current set of active styles (IDs)
        let activeStyles = new Set<string>();

        rawLines.forEach((rawLine, index) => {
            let className = "whitespace-pre";

            // Check for footnote definition classes
            const isFootnoteDef = rawLine.trim().match(/^\[\^(\w+)\]:/);
            const prevLine = index > 0 ? rawLines[index - 1] : null;
            const prevIsFootnoteDef = prevLine ? prevLine.trim().match(/^\[\^(\w+)\]:/) : false;

            if (isFootnoteDef) className += " footnote-definition";
            if (isFootnoteDef && !prevIsFootnoteDef) className += " footnote-separator";

            // Process atomic text first
            let lineText = processAtomic(rawLine);
            let lineHtml = "";

            // Re-open tags for styles active from previous line
            // Convert set to array to iterate
            Array.from(activeStyles).forEach(styleId => {
                const token = TOKENS.find(t => t.id === styleId);
                if (token) {
                    lineHtml += `<${token.tag}${token.className ? ` class="${token.className}"` : ''}>`;
                }
            });

            // Tokenizer Loop for this line
            let remaining = lineText;
            while (remaining.length > 0) {
                // Find nearest token
                let bestMatch: { index: number, token: Token, isStart?: boolean } | null = null;

                for (const token of TOKENS) {
                    let regex = token.regex;
                    let isStart: boolean | undefined = undefined;

                    // Special case for separate start/end tokens (Marginalia)
                    if (token.startRegex && token.endRegex) {
                        if (activeStyles.has(token.id)) {
                            regex = token.endRegex;
                            isStart = false;
                        } else {
                            regex = token.startRegex;
                            isStart = true;
                        }
                    }

                    if (regex) {
                        const m = remaining.match(regex);
                        if (m && m.index !== undefined) {
                            if (!bestMatch || m.index < bestMatch.index) {
                                bestMatch = { index: m.index, token, isStart };
                            }
                        }
                    }
                }

                if (bestMatch) {
                    // Append text before token
                    lineHtml += remaining.substring(0, bestMatch.index);

                    // Toggle style logic
                    const styleId = bestMatch.token.id;
                    const isActive = activeStyles.has(styleId);

                    // Determine if we are opening or closing
                    const shouldOpen = bestMatch.isStart !== undefined ? bestMatch.isStart : !isActive;

                    if (shouldOpen) {
                        activeStyles.add(styleId);
                        lineHtml += `<${bestMatch.token.tag}${bestMatch.token.className ? ` class="${bestMatch.token.className}"` : ''}>`;
                    } else {
                        activeStyles.delete(styleId);
                        lineHtml += `</${bestMatch.token.tag}>`;
                    }

                    // Advance past token
                    let tokenLength = 0;
                    if (bestMatch.token.regex) {
                        const m = remaining.match(bestMatch.token.regex);
                        tokenLength = m ? m[0].length : 0;
                    } else if (bestMatch.isStart !== undefined && bestMatch.token.startRegex && bestMatch.token.endRegex) {
                        const regex = bestMatch.isStart ? bestMatch.token.startRegex : bestMatch.token.endRegex;
                        const m = remaining.match(regex);
                        tokenLength = m ? m[0].length : 0;
                    }

                    remaining = remaining.substring(bestMatch.index + tokenLength);

                } else {
                    // No more tokens, append rest
                    lineHtml += remaining;
                    remaining = "";
                }
            }

            // Close tags for styles active at end of line (in reverse order roughly)
            Array.from(activeStyles).reverse().forEach(styleId => {
                const token = TOKENS.find(t => t.id === styleId);
                if (token) {
                    lineHtml += `</${token.tag}>`;
                }
            });

            // Prevent empty line collapse
            if (lineHtml === "") lineHtml = "&nbsp;";

            outputLines.push({ html: lineHtml, className });
        });

        return outputLines;
    }, [content]);

    return (
        <div
            className="markdown-preview min-h-full bg-white p-6 text-[18px] text-gray-900 overflow-x-auto"
            style={{
                fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif',
                fontFeatureSettings: '"hist" on, "salt" on',
                lineHeight: '1.7', // Base line-height
            }}
        >
            {renderedLines.map((line, index) => (
                <div
                    key={index}
                    className={line.className}
                    style={{
                        height: '1.7em', // STRICT HEIGHT ENFORCEMENT
                        lineHeight: '1.7em',
                        display: 'flex',
                        alignItems: 'baseline',
                        width: 'fit-content', // Allow horizontal growth
                        minWidth: '100%'
                    }}
                    dangerouslySetInnerHTML={{ __html: line.html }}
                />
            ))}
        </div>
    );
};

export default MarkdownPreview;
