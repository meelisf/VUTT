import React from 'react';
import { CheckCircle } from 'lucide-react';

/** Sammuindikaator upload-viisardi ülaosas. */
const StepIndicator: React.FC<{ step: 1 | 2 | 3; labels: [string, string, string] }> = ({
  step,
  labels,
}) => (
  <div className="flex items-center gap-0 mb-8">
    {labels.map((label, i) => {
      const num = (i + 1) as 1 | 2 | 3;
      const active = num === step;
      const done = num < step;
      return (
        <React.Fragment key={num}>
          <div className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                done
                  ? 'bg-green-500 border-green-500 text-white'
                  : active
                  ? 'bg-primary-600 border-primary-600 text-white'
                  : 'bg-white border-gray-300 text-gray-400'
              }`}
            >
              {done ? <CheckCircle size={14} /> : num}
            </div>
            <span
              className={`text-sm font-medium ${
                active ? 'text-primary-700' : done ? 'text-green-600' : 'text-gray-400'
              }`}
            >
              {label}
            </span>
          </div>
          {i < 2 && <div className="flex-1 h-0.5 bg-gray-200 mx-3" />}
        </React.Fragment>
      );
    })}
  </div>
);

export default StepIndicator;
