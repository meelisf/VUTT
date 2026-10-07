/**
 * Osa püsilink `/work/:workId/part/:partId` (#526): lahendab osa esimese lehe
 * praeguses lehtede järjestuses ja suunab töölauale (`/work/:id/:leht?part=`).
 * Lehenumber ei ole lingis, sest lehtede ümberjärjestus/poolitus nihutab seda.
 *
 * Lugemistõrge (ligipääs, sisselogimata) → teose leht: töölaud oskab neid
 * olukordi ise näidata. Teoses puuduv osa → 404, mitte vaikne teose algus.
 */
import React, { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useUser } from '../contexts/UserContext';
import { getPartsToc } from '../services/workPartsApi';
import { partWorkspacePath } from './manage/partsModel';
import NotFound from './NotFound';

type Target = { kind: 'go'; to: string } | { kind: 'missing' };

const PartRedirect: React.FC = () => {
  const { workId = '', partId = '' } = useParams();
  const { authToken, isLoading } = useUser();
  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    // Token loetakse käivitusel; enne seda päring läheks anonüümsena.
    if (isLoading) return;
    let cancelled = false;
    getPartsToc(workId, authToken).then(r => {
      if (cancelled) return;
      const part = r.parts.find(p => p.id === partId);
      const to = part && partWorkspacePath(workId, part, new Map(Object.entries(r.pageNumbers)));
      setTarget(to ? { kind: 'go', to } : { kind: 'missing' });
    }).catch(() => {
      if (!cancelled) setTarget({ kind: 'go', to: `/work/${encodeURIComponent(workId)}` });
    });
    return () => { cancelled = true; };
  }, [workId, partId, authToken, isLoading]);

  if (target?.kind === 'go') return <Navigate to={target.to} replace />;
  if (target?.kind === 'missing') return <NotFound />;
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
    </div>
  );
};

export default PartRedirect;
