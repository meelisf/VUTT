// Osa liigi märgi värv (#464). Märk kannab ka numbrit ja pealkirja (title), seega
// värv ei ole ainus tunnus.
import type { PartKind } from '../../../services/workPartsApi';

export const KIND_STYLE: Record<PartKind, string> = {
  letter: 'bg-sky-100 text-sky-800 border border-sky-300',
  poem: 'bg-amber-100 text-amber-800 border border-amber-300',
  speech: 'bg-violet-100 text-violet-800 border border-violet-300',
  session: 'bg-emerald-100 text-emerald-800 border border-emerald-300',
  attachment: 'bg-gray-100 text-gray-700 border border-gray-300',
};
