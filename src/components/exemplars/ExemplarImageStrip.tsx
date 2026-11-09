import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ExemplarImage } from '../../services/exemplarImagesService';
import { getExemplarThumbUrl } from '../../services/workImageService';
import { withImageToken, type ImageToken } from '../../utils/imageTokenUrl';

interface ExemplarImageStripProps {
  workId: string;
  exemplarId: string;
  images: ExemplarImage[];
  selectedId?: string | null;
  onSelect: (imageId: string) => void;
  imageToken: ImageToken | null;
}

/** Eksemplari pisipiltide rida (ADR 0079). Klõps valib pildi; silt pisipildi all. */
const ExemplarImageStrip: React.FC<ExemplarImageStripProps> = ({
  workId, exemplarId, images, selectedId, onSelect, imageToken,
}) => {
  const { t } = useTranslation(['workspace']);
  return (
    <div className="flex gap-2 overflow-x-auto pb-2" role="list">
      {images.map((img, i) => {
        const active = img.id === selectedId;
        return (
          <button
            key={img.id}
            type="button"
            role="listitem"
            data-testid="exemplar-thumb"
            aria-current={active ? 'true' : undefined}
            onClick={() => onSelect(img.id)}
            className={`shrink-0 w-20 text-left rounded border-2 ${active ? 'border-primary-600' : 'border-transparent hover:border-gray-300'}`}
          >
            <img
              src={withImageToken(getExemplarThumbUrl(workId, exemplarId, img.id), imageToken)}
              alt={t('exemplarImages.imageAlt', { n: i + 1 })}
              loading="lazy"
              className="w-full h-24 object-cover bg-gray-200 rounded-sm"
            />
            <span className="block truncate text-[11px] text-gray-600 px-0.5">{img.label || i + 1}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ExemplarImageStrip;
