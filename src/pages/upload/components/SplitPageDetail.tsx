import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronLeft, ChevronRight, Columns2, Eye, EyeOff, FlipVertical2, LayoutGrid, RotateCcw, RotateCw } from 'lucide-react';
import { prepressPreviewUrl } from '../uploadApi';
import { clampSplitX, willSplit } from '../prepressPlan';
import type { PrepressPage, PrepressPlan } from '../types';

interface Props {
  uploadId: string;
  token: string | null;
  plan: PrepressPlan;
  pageNum: number;
  onPageChange: (n: number, patch: Partial<PrepressPage>) => void;
  onNavigate: (n: number) => void;
  onClose: () => void;
}

/**
 * Teine tase: üks leht suurelt, lohistatava joonega.
 *
 * Natiivse lahutusega köitevahe-riba oli siin varem kõrval-paanina ja
 * eemaldati: 100 DPI eelvaade näitab joone asukoha juba piisava täpsusega,
 * riba aga tõi kaasa oma endpointi, x-kvantimise ja ketta-vahemälu.
 *
 * Joon ja käepide järgivad TAHTLIKULT sama kuju nagu Manage-lehe poolitamine
 * (`PageImageEditorModal`) — sama žest peab mõlemas kohas ühtemoodi välja
 * nägema ja käituma, sh lohistuse kuulamine aknast (kursor tohib pildilt välja).
 */
const SplitPageDetail: React.FC<Props> = ({
  uploadId, token, plan, pageNum, onPageChange, onNavigate, onClose,
}) => {
  const { t } = useTranslation(['upload', 'common']);
  const page = plan.pages.find((p) => p.n === pageNum);
  const liveX = page?.mode === 'custom' && page.split_x != null
    ? page.split_x
    : plan.default_split_x;

  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  /**
   * Pildi TEGELIK kast letterbox-ala sees (px, `boxRef` suhtes).
   *
   * Modaal on fikseeritud kõrgusega ja pilt mahutatakse `object-contain`-iga —
   * seega jääb pildi kõrvale (portree) või alla-peale (lapiti) tühja ala.
   * Joon, käepide ja klõps EI TOHI käia konteineri järgi: `x` on osa PILDI
   * laiusest. Mõõdame elemendi enda kasti, mitte ei arvuta kuvasuhtest —
   * `max-h-full max-w-full` korral ON img-elemendi kast juba renderdatud kast.
   */
  const [imgBox, setImgBox] = useState({ left: 0, top: 0, width: 0, height: 0 });

  // Kas seda lehte päriselt poolitatakse. Joon ja käepide EI TOHI olla nähtaval,
  // kui vastus on ei — muidu näitab vaade tegevust, mida ei toimu.
  const splits = page ? willSplit(plan, pageNum) : false;
  const excluded = Boolean(page?.excluded);
  // Väljajäetud lehel EI ole poolitusnupp keelatud: `excluded` ja `mode` on
  // risti (ADR 0026) — poolitusolek säilib ja hakkab kehtima, kui leht OCR-i
  // tagasi lisada. Nupp on ainult tuhmim + vihjega, sest praegu ta ei tee midagi.
  const noSplitMode = page?.mode === 'nosplit';

  const index = plan.pages.findIndex((p) => p.n === pageNum);
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < plan.pages.length - 1;

  const goTo = useCallback((i: number) => {
    const target = plan.pages[i];
    if (target) onNavigate(target.n);
  }, [plan.pages, onNavigate]);

  const setX = (x: number) =>
    onPageChange(pageNum, { mode: 'custom', split_x: clampSplitX(Number(x.toFixed(4))) });

  // Ref hoiab värskeimat setX-i, et aknakuulajad ei tellitaks iga renderi peale
  // uuesti (onPageChange on vanemas inline-arrow).
  const setXRef = useRef(setX);
  setXRef.current = setX;

  const xFromClient = (clientX: number) => {
    // Mõõda sündmuse hetkel: kerimine/akna muutus võib olekus oleva kasti
    // vananenuks teha, ja vale x kirjutataks plaani.
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (!rect.width) return;
    setXRef.current((clientX - rect.left) / rect.width);
  };

  // Pildi kasti mõõtmine: laadimisel, akna muutusel ja lehe vahetusel.
  // ResizeObserver katab ka modaali sisemised nihked (nupurea murdumine).
  const measure = useCallback(() => {
    const box = boxRef.current;
    const img = imgRef.current;
    if (!box || !img) return;
    const b = box.getBoundingClientRect();
    const i = img.getBoundingClientRect();
    const next = {
      left: i.left - b.left, top: i.top - b.top, width: i.width, height: i.height,
    };
    setImgBox((prev) => (prev.left === next.left && prev.top === next.top
      && prev.width === next.width && prev.height === next.height ? prev : next));
  }, []);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (boxRef.current) ro.observe(boxRef.current);
    if (imgRef.current) ro.observe(imgRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, pageNum]);

  // Lohistus: kuula AKNAST, et kursor võiks väljuda pildi raamist
  // (sama muster nagu PageImageEditorModal).
  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => xFromClient(e.clientX);
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging]);

  // Klaviatuur: nooled vahetavad LEHTE (mitte joont), Escape sulgeb.
  // Sama leping nagu Manage-lehe pildiredaktoris — ära kaaperda nooli,
  // kui fookus on sisestusväljal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      const role = (document.activeElement as HTMLElement | null)?.getAttribute('role');
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || role === 'slider') return;
      if (e.key === 'ArrowLeft') goTo(index - 1);
      else if (e.key === 'ArrowRight') goTo(index + 1);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, index, onClose]);

  if (!page) return null;

  return (
    // z-[1300]: Header on `sticky z-[1200]` ja kataks muidu modaali ülemise
    // serva — just seal, kus on sulgemisnupp. Sama väärtus nagu
    // PageImageEditorModal'is; tegevusribad on `z-[1100]` ehk päise all.
    <div className="fixed inset-0 z-[1300] flex items-center justify-center overflow-hidden bg-black/70 p-2 sm:p-4">
      {/* Kõrgus on FIKSEERITUD (`h-`, mitte `max-h-`) ja pilt mahutatakse
          järelejäänud kasti. Varem kasvas modaal sisu järgi: lapiti leht andis
          madala akna, portree kõrge — nupurida hüppas iga lehe peale uude
          kohta ja portree alumine serv jäi kerimise taha. Ülevaatus on
          tsükliline töö („vaata → otsusta → järgmine"), seega peavad päis ja
          nupurida seisma paigal ja leht olema ALATI tervikuna näha.
          flex-col: päis ja jalus on omaette flex-lapsed ega keri kaasa. */}
      <div className="flex h-[calc(100vh-1rem)] w-full max-w-6xl flex-col rounded bg-white sm:h-[calc(100vh-2rem)]">
        <div className="flex flex-shrink-0 items-center justify-between gap-2 rounded-t border-b border-gray-200 bg-white px-4 py-3">
          <h3 className="font-semibold">
            {/* Väljajätmine domineerib päises: „ei poolitata" oleks tõsi, aga
                varjaks tähtsama fakti — seda lehte ei tule teosesse üldse. */}
            {excluded
              ? t('step3split.detail.headerExcluded', {
                n: pageNum, total: plan.pages.length,
              })
              : splits
                ? t('step3split.detail.header', {
                  n: pageNum,
                  total: plan.pages.length,
                  percent: Math.round(liveX * 1000) / 10,
                })
                : t('step3split.detail.headerNoSplit', {
                  n: pageNum, total: plan.pages.length,
                })}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common:buttons.close')}
            className="-mr-1 rounded p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            <X size={18} />
          </button>
        </div>

        {/* overflow-hidden, MITTE auto: pilt mahutatakse, mitte ei keritata. */}
        <div className="min-h-0 flex-1 overflow-hidden p-4">
          <div
            ref={boxRef}
            className={`relative flex h-full w-full select-none touch-none items-center justify-center ${splits ? 'cursor-col-resize' : ''}`}
            onPointerDown={(e) => { if (splits) xFromClient(e.clientX); }}
          >
            <img
              ref={imgRef}
              src={prepressPreviewUrl(uploadId, pageNum, token, page?.rotate ?? 0)}
              alt={`${pageNum}`}
              onLoad={measure}
              className="block max-h-full max-w-full object-contain"
              draggable={false}
            />
            {/* Joon + käepide: sama kuju nagu Manage-lehe poolitamisel.
                Nähtaval AINULT siis, kui leht päriselt poolitatakse, ja
                paigutatud PILDI kasti järgi (vt imgBox) — muidu jookseks
                joon letterboxi tühja alasse. */}
            {splits && imgBox.width > 0 && (
              <>
                <div
                  data-testid="detail-line"
                  className="pointer-events-none absolute w-0.5 bg-red-500 opacity-90"
                  style={{
                    left: imgBox.left + liveX * imgBox.width,
                    top: imgBox.top,
                    height: imgBox.height,
                  }}
                />
                <div
                  data-testid="detail-handle"
                  className="absolute flex h-10 w-5 -translate-x-1/2 -translate-y-1/2 cursor-col-resize items-center justify-center rounded bg-red-500 shadow-md"
                  style={{
                    left: imgBox.left + liveX * imgBox.width,
                    top: imgBox.top + imgBox.height / 2,
                  }}
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
                >
                  <div className="mx-0.5 h-6 w-0.5 bg-white/70" />
                  <div className="mx-0.5 h-6 w-0.5 bg-white/70" />
                </div>
              </>
            )}

            {!splits && imgBox.width > 0 && (
              <div
                data-testid="detail-nosplit-badge"
                className="pointer-events-none absolute flex flex-col items-center justify-start gap-1 bg-white/40 pt-6"
                style={{
                  left: imgBox.left, top: imgBox.top,
                  width: imgBox.width, height: imgBox.height,
                }}
              >
                <span className="flex items-center gap-2 rounded-full bg-gray-900/85 px-4 py-2 text-sm font-medium text-white shadow-lg">
                  {excluded ? <EyeOff size={15} /> : <Columns2 size={15} />}
                  {excluded ? t('step3split.isExcluded') : t('step3split.willNotSplit')}
                </span>
                {/* Ilma tagajärjeta jäi õhku, MIS väljajäetud lehest saab:
                    ta ei jõua OCR-i ega teosesse, seega ka poolitamine ei
                    puutu teda. Poolitusolek ise jääb plaani alles. */}
                {excluded && (
                  <span
                    data-testid="detail-excluded-explain"
                    className="max-w-[22rem] rounded bg-gray-900/70 px-3 py-1 text-center text-xs text-white shadow"
                  >
                    {t('step3split.excludedExplain')}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 rounded-b border-t border-gray-200 bg-white px-4 py-3">
          {/* Üks rühm, järjestuses: Ülevaatesse | ‹ › | Ära poolita · Ära OCR-i
              (§9). Otsustusnupud on TAHTLIKULT nooltega samas rühmas: täisvaates
              käib töö tsükliga „vaata → otsusta → järgmine leht", ja parem serv
              sundis käe iga lehe kohta üle ekraani rändama. Paremale jääb ainult
              harv „Lähtesta üldjoonele". Väljapääs on SÕNADEGA — päise X ja
              Escape üksi ei ütle, KUHU nad viivad. Lehe vahetus järgib Manage
              pildiredaktori kuju ja klahve; joont nihutab kasutaja AINULT
              hiirega (käepide või klõps pildil).

              Värvi leping (sama nii siin kui kontaktlehel): must = seda lehte
              EI poolitata / EI OCR-ita. Silt nimetab TEGEVUSE, värv näitab
              OLEKUT, aria-pressed käib värviga käsikäes. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                data-testid="back-to-overview"
                onClick={onClose}
                className="mr-2 flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-100"
              >
                <LayoutGrid size={15} />
                {t('step3split.backToOverview')}
              </button>
              <button
                type="button"
                data-testid="page-prev"
                onClick={() => goTo(index - 1)}
                disabled={!hasPrev}
                title={t('common:buttons.previous')}
                className="rounded border border-gray-300 bg-white p-2 hover:bg-gray-100 disabled:opacity-40"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                data-testid="page-next"
                onClick={() => goTo(index + 1)}
                disabled={!hasNext}
                title={t('common:buttons.next')}
                className="rounded border border-gray-300 bg-white p-2 hover:bg-gray-100 disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>

              <div className="ml-2 flex flex-wrap items-center gap-2 border-l border-gray-200 pl-3">
                <button
                  type="button"
                  data-testid="detail-nosplit"
                  aria-pressed={noSplitMode}
                  title={excluded ? t('step3split.card.splitKeptWhileExcluded') : undefined}
                  className={`flex items-center gap-1.5 rounded border px-3 py-1 text-sm ${
                    noSplitMode
                      ? 'border-gray-900 bg-gray-900 font-medium text-white'
                      : 'border-gray-300'
                  } ${excluded ? 'opacity-50' : ''}`}
                  onClick={() => onPageChange(pageNum, {
                    mode: noSplitMode ? 'default' : 'nosplit', split_x: null,
                  })}
                >
                  <Columns2 size={15} />
                  {noSplitMode ? t('step3split.card.split') : t('step3split.card.noSplit')}
                </button>
                {/* Pööre — samad ikoonid nagu PageImageEditorModal-is (§ tuttav
                    žest). KOGUV: kaks klõpsu paremale = 180°. Pööre rakendub
                    enne poolitamist, seega joon liigub pööratud pildiga kaasa. */}
                <button
                  type="button"
                  data-testid="detail-rotate-left"
                  title={t('step3split.bar.rotateLeft')}
                  className="rounded border border-gray-300 bg-white p-2 hover:bg-gray-100"
                  onClick={() => onPageChange(pageNum, {
                    rotate: (((page.rotate ?? 0) - 90) % 360 + 360) % 360,
                  })}
                >
                  <RotateCcw size={15} />
                </button>
                <button
                  type="button"
                  data-testid="detail-rotate-right"
                  title={t('step3split.bar.rotateRight')}
                  className="rounded border border-gray-300 bg-white p-2 hover:bg-gray-100"
                  onClick={() => onPageChange(pageNum, {
                    rotate: (((page.rotate ?? 0) + 90) % 360 + 360) % 360,
                  })}
                >
                  <RotateCw size={15} />
                </button>
                <button
                  type="button"
                  data-testid="detail-rotate-180"
                  title={t('step3split.bar.rotate180')}
                  className="rounded border border-gray-300 bg-white p-2 hover:bg-gray-100"
                  onClick={() => onPageChange(pageNum, {
                    rotate: (((page.rotate ?? 0) + 180) % 360 + 360) % 360,
                  })}
                >
                  <FlipVertical2 size={15} />
                </button>

                <button
                  type="button"
                  data-testid="detail-exclude"
                  aria-pressed={excluded}
                  className={`flex items-center gap-1.5 rounded border px-3 py-1 text-sm ${
                    excluded
                      ? 'border-gray-900 bg-gray-900 font-medium text-white'
                      : 'border-gray-300'
                  }`}
                  onClick={() => onPageChange(pageNum, { excluded: !excluded })}
                >
                  {excluded ? <EyeOff size={15} /> : <Eye size={15} />}
                  {excluded ? t('step3split.card.include') : t('step3split.card.exclude')}
                </button>
              </div>
            </div>

            <button
              type="button"
              className={`rounded border px-3 py-1 text-sm ${
                page.mode === 'default'
                  ? 'border-primary-600 bg-primary-50 font-medium text-primary-700'
                  : 'border-gray-300'
              }`}
              onClick={() => onPageChange(pageNum, { mode: 'default', split_x: null })}
            >
              {t('step3split.detail.resetToGlobal')}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">{t('step3split.detail.arrowHint')}</p>
        </div>
      </div>
    </div>
  );
};

export default SplitPageDetail;
