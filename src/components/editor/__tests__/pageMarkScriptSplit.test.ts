/** @vitest-environment jsdom */
// Lehe tähistus fraktuurlehel: hall vähemuskiri (antiikva) katab ainult tähti,
// serva kirjavahemärk („Hu-") jääb välja. Tähistuse märk peab jääma ÜHEKS span'iks —
// muidu saab iga tükk oma `::before`-saki ja kustos paistab kahekordsena (Becker lk 76).
import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { vuttMarkupExtension } from '../VuttMarkupExtension';
import { scriptModeExtension } from '../scriptMode';

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; });

function render(doc: string) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  view = new EditorView({ state: EditorState.create({ doc, extensions: [vuttMarkupExtension, scriptModeExtension()] }), parent });
  return parent;
}

const FRAKTUR = '<f>mißbrauchen vnd anwenden.</f>\n<f>Wir wollen allhie zweyerley betrachten.</f>\n<f>mens GOttes.</f>\n';

describe('lehe tähistus ja vähemuskiri', () => {
  it('antiikva kustos fraktuurlehel on üks span ka poolitusmärgiga', () => {
    const dom = render(FRAKTUR + '<catch>II. Hu-</catch>');
    const spans = dom.querySelectorAll('.vutt-pm-catch');
    expect(spans.length).toBe(1);
    expect(spans[0].textContent).toBe('II. Hu-');
    // alates #731 on ka poolitusmärk hall (<f>-ist väljas = antiikva)
    expect(dom.querySelector('.vutt-pm-catch .vutt-script-minority')?.textContent).toBe('II. Hu-');
  });

  it('hall, mis ei kata kogu tähistust (kreeka sees), ei lõhu tähistust', () => {
    const dom = render(FRAKTUR + '<rh>Cap. λόγος II.</rh>');
    const spans = dom.querySelectorAll('.vutt-pm-rh');
    expect(spans.length).toBe(1);
    expect(spans[0].textContent).toBe('Cap. λόγος II.');
  });

  it('lehenumber punktiga', () => {
    const dom = render('<fw>265.</fw>\n' + FRAKTUR + '<rh>Cap. II.</rh>');
    expect(dom.querySelectorAll('.vutt-pm-rh').length).toBe(1);
    expect(dom.querySelectorAll('.vutt-pm-fw').length).toBe(1);
  });
});
