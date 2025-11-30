
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { UserProvider } from './contexts/UserContext';
import Dashboard from './pages/Dashboard';
import Workspace from './pages/Workspace';
import Statistics from './pages/Statistics';
import SearchPage from './pages/SearchPage';

const App: React.FC = () => {
  return (
    <UserProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/stats" element={<Statistics />} />
          <Route path="/work/:workId/:pageNum" element={<Workspace />} />
        </Routes>
      </Router>
    </UserProvider>
  );
};

export default App;
