
import React from 'react';
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Workspace from './pages/Workspace';
import Statistics from './pages/Statistics';
import SearchPage from './pages/SearchPage';

const App: React.FC = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/stats" element={<Statistics />} />
        <Route path="/work/:workId/:pageNum" element={<Workspace />} />
      </Routes>
    </Router>
  );
};

export default App;
