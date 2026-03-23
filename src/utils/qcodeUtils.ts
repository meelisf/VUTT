// Wikidata Q-koodi tuvastamine (nt "Q12345")
export const isQCode = (val: string) => /^Q\d+$/.test(val);

// vutt: isiku-ID tuvastamine (nt "vutt:Pabc123")
export const isVuttId = (val: string) => /^vutt:P/.test(val);
