import { WorkStatus } from '../types';

/** Teose staatuse täpi taustavärv (kaart ja loendirida). */
export const workStatusDotClass = (status?: WorkStatus): string => {
  switch (status) {
    case 'Valmis': return 'bg-green-500';
    case 'Töös': return 'bg-amber-400';
    case 'Toores': default: return 'bg-gray-300';
  }
};
