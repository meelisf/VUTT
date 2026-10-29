import React from 'react';
import { useTranslation } from 'react-i18next';
import { parseGitDiff, type GitDiffBlockKind, type GitDiffLineType } from './gitDiff';

const BLOCK_LABEL_KEY: Record<GitDiffBlockKind, string> = {
  json: 'history.diffBlock.json',
  text: 'history.diffBlock.text',
  other: 'history.diffBlock.other',
};

const LINE_CLASS: Record<GitDiffLineType, string> = {
  addition: 'bg-green-50 text-green-900 pl-4 border-l-4 border-green-400 py-0.5',
  deletion: 'bg-red-50 text-red-900 pl-4 border-l-4 border-red-300 py-0.5',
  context: 'text-gray-500 pl-4 border-l-4 border-transparent',
};

// Git-diffi lihtsustatud kuva — lehe ajalugu ja ülevaatusleht (#674)
const GitDiffView: React.FC<{ diff: string }> = ({ diff }) => {
  const { t } = useTranslation('workspace');
  const blocks = parseGitDiff(diff);

  if (blocks.length === 0) {
    return (
      <div className="p-4 text-center text-gray-400 italic text-sm">
        {t('history.onlyTimestampChanges')}
      </div>
    );
  }

  return (
    <>
      {blocks.map(block => (
        <div key={block.key} className="mb-6 last:mb-0">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 border-b border-gray-100 pb-1">
            {t(BLOCK_LABEL_KEY[block.kind])}
          </div>
          <div className="space-y-0.5">
            {block.lines.map(line => (
              <div key={line.key} className={`font-mono text-xs whitespace-pre-wrap break-all ${LINE_CLASS[line.type]}`}>
                {line.text}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
};

export default GitDiffView;
