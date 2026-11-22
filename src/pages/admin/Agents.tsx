import React, { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import Header from '../../components/Header';
import { useUser } from '../../contexts/UserContext';
import { hasAgentAccess, isAtLeast } from '../../utils/roleUtils';
import AgentProposalsPanel from './agents/AgentProposalsPanel';

// „Agendid" (#869): agendikood ja ootel ettepanekud ühes kohas. Superadmin ja
// agendi lipuga admin; server jõustab sama (`require_agent_access`).
const Agents: React.FC = () => {
  const { t } = useTranslation(['admin', 'common']);
  const { user, authToken, isLoading: userLoading } = useUser();
  const navigate = useNavigate();
  const allowed = hasAgentAccess(user);

  useEffect(() => {
    if (!userLoading && !allowed) navigate('/');
  }, [allowed, userLoading, navigate]);

  if (!user || !allowed || !authToken) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header pageTitle={t('admin:cards.agents')} />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <Link to="/admin" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft size={16} />
          Admin
        </Link>
        <h2 className="mb-1 text-lg font-semibold text-gray-800">{t('admin:cards.agents')}</h2>
        <p className="mb-4 text-sm text-gray-600">
          {isAtLeast(user.role, 'superadmin') ? t('admin:agents.introSuperadmin') : t('admin:agents.intro')}
        </p>
        <AgentProposalsPanel token={authToken} showOwner={isAtLeast(user.role, 'superadmin')} />
      </div>
    </div>
  );
};

export default Agents;
