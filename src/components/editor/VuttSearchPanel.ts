// VuttSearchPanel.ts — kohandatud CM6 otsingupaneel diakriitikatolerantse otsimisega
// Võimaldab otsida "auditorio" ja leida "Auditoriô", "auctoris" → "aûctoris" jne.

import type { EditorView } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import {
    SearchQuery, setSearchQuery, findNext, findPrevious,
    selectMatches, replaceNext, replaceAll, closeSearchPanel,
} from '@codemirror/search';

// Ajaloolises tekstis esinevad tähtede diakriitikavariandid.
// Võti = ASCII põhitäht (lowercase), väärtus = kõik variandid koos põhitähega.
const DIACRITIC_CLASS: Record<string, string> = {
    a: 'aàáâãäåāăæ',
    e: 'eèéêëēĕ',
    i: 'iìíîïīĭ',
    o: 'oòóôõöōŏœ',
    u: 'uùúûüūŭ',
    y: 'yýÿ',
    n: 'nñń',
    c: 'cçć',
    s: 'sśſ',  // ſ = pikk s, varase uusaja tekstis sage
    z: 'zźż',
    r: 'rŕ',
    l: 'lł',
    d: 'dď',
    t: 'tť',
};

function escapeForClass(s: string): string {
    // \ ja ] ja ^ on erilised regexp character class sees
    return s.replace(/[\\^\]]/g, '\\$&');
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Teisendab otsingutermi diakriitikatolerantseks regexp-musteriks.
 * Iga tähe jaoks, millel on teadaolevad diakriitikavariandid, laiendatakse see character class-iks.
 * "auditorio" → "[aàáâ...Aàáâ...][uùú...][d][i][t][oòóô...Oòóô...][r][i][oòóô...]"
 */
function buildDiacriticPattern(text: string, caseSensitive: boolean): string {
    let pattern = '';
    for (const ch of text) {
        // NFD normaliseerimine: "ô" → "o" + U+0302, siis eemaldame combining chars → "o"
        const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const variants = DIACRITIC_CLASS[base];

        if (variants) {
            const lower = escapeForClass(variants);
            if (caseSensitive) {
                const isUpper = ch !== ch.toLowerCase() && ch === ch.toUpperCase();
                const cls = isUpper ? escapeForClass(variants.toUpperCase()) : lower;
                pattern += `[${cls}]`;
            } else {
                pattern += `[${lower}${escapeForClass(variants.toUpperCase())}]`;
            }
        } else {
            pattern += escapeRegExp(ch);
        }
    }
    return pattern;
}

// Moodulitaseme olek — säilitab kuvatava otsingutermi paneeli sulgemisel
let lastSearchDisplay = '';
let lastReplaceDisplay = '';

/** Võimaldab TextEditoril seada initsiaalse otsingutermi (nt URL ?q= parameetrist). */
export function setSearchDisplayText(text: string): void {
    lastSearchDisplay = text;
}

export function createVuttSearchPanel(view: EditorView) {
    return new VuttSearchPanel(view);
}

class VuttSearchPanel {
    dom: HTMLElement;
    private searchInput: HTMLInputElement;
    private replaceInput: HTMLInputElement;
    private caseCheckbox: HTMLInputElement;
    private wordCheckbox: HTMLInputElement;

    constructor(private view: EditorView) {
        this.dom = document.createElement('div');
        this.dom.className = 'cm-search';

        this.searchInput = this.makeInput('Otsi', lastSearchDisplay);
        this.replaceInput = this.makeInput('Asenda', lastReplaceDisplay);
        this.caseCheckbox = this.makeCheckbox('case');
        this.wordCheckbox = this.makeCheckbox('word');

        this.buildDom();

        this.dom.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                if (e.target === this.replaceInput) {
                    replaceNext(this.view);
                } else {
                    if (e.shiftKey) findPrevious(this.view);
                    else findNext(this.view);
                }
                e.preventDefault();
            } else if (e.key === 'Escape') {
                closeSearchPanel(this.view);
                this.view.focus();
                e.preventDefault();
            }
        });
    }

    private makeInput(placeholder: string, value: string): HTMLInputElement {
        const el = document.createElement('input');
        el.className = 'cm-textfield';
        el.placeholder = placeholder;
        el.setAttribute('aria-label', placeholder);
        el.value = value;
        el.addEventListener('input', () => this.commit());
        return el;
    }

    private makeCheckbox(name: string): HTMLInputElement {
        const el = document.createElement('input');
        el.type = 'checkbox';
        el.name = name;
        el.addEventListener('change', () => this.commit());
        return el;
    }

    private btn(label: string, onclick: () => void, name?: string): HTMLButtonElement {
        const b = document.createElement('button');
        b.textContent = label;
        b.className = 'cm-button';
        b.type = 'button';
        if (name) b.name = name;
        b.addEventListener('click', onclick);
        return b;
    }

    private buildDom() {
        const d = this.dom;

        // Rida 1: otsing
        d.appendChild(this.searchInput);
        d.appendChild(this.btn('järgmine', () => findNext(this.view)));
        d.appendChild(this.btn('eelmine', () => findPrevious(this.view)));
        d.appendChild(this.btn('kõik', () => selectMatches(this.view)));

        // Aa (match case)
        const caseLabel = document.createElement('label');
        caseLabel.appendChild(this.caseCheckbox);
        caseLabel.appendChild(document.createTextNode('Aa'));
        d.appendChild(caseLabel);

        // W (terve sõna)
        const wordLabel = document.createElement('label');
        wordLabel.appendChild(this.wordCheckbox);
        wordLabel.appendChild(document.createTextNode('W'));
        d.appendChild(wordLabel);

        // Sulge (absoluutasendis paremas ülanurgas — CM6 base-theme hoiab seda)
        const close = this.btn('✕', () => {
            closeSearchPanel(this.view);
            this.view.focus();
        }, 'close');
        close.setAttribute('aria-label', 'sulge');
        d.appendChild(close);

        d.appendChild(document.createElement('br'));

        // Rida 2: asendamine
        d.appendChild(this.replaceInput);
        d.appendChild(this.btn('asenda', () => replaceNext(this.view)));
        d.appendChild(this.btn('asenda kõik', () => replaceAll(this.view)));
    }

    private commit() {
        lastSearchDisplay = this.searchInput.value;
        lastReplaceDisplay = this.replaceInput.value;

        const searchText = this.searchInput.value;
        const caseSensitive = this.caseCheckbox.checked;
        const wholeWord = this.wordCheckbox.checked;

        let search: string;
        let useRegexp: boolean;

        if (searchText.trim()) {
            search = buildDiacriticPattern(searchText, caseSensitive);
            useRegexp = true;
        } else {
            search = searchText;
            useRegexp = false;
        }

        this.view.dispatch({
            effects: setSearchQuery.of(new SearchQuery({
                search,
                regexp: useRegexp,
                caseSensitive,
                wholeWord,
                replace: this.replaceInput.value,
            }))
        });
    }

    mount() {
        this.searchInput.focus();
        if (this.searchInput.value) {
            this.searchInput.select();
            this.commit();
        }
    }

    update(_update: ViewUpdate) {
        // Paneel haldab oma olekut ise — ei loe tagasi CM6 SearchQuery state'ist
    }

    destroy() {
        lastSearchDisplay = this.searchInput.value;
        lastReplaceDisplay = this.replaceInput.value;
    }
}
