import React from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { UserProvider } from './contexts/UserContext';
import Dashboard from './pages/Dashboard';
import Workspace from './pages/Workspace';
import Statistics from './pages/Statistics';
import SearchPage from './pages/SearchPage';

const router = createBrowserRouter([
  {
    path: "/",
    element: <Dashboard />,
  },
  {
    path: "/search",
    element: <SearchPage />,
  },
  {
    path: "/stats",
    element: <Statistics />,
  },
  {
    path: "/work/:workId/:pageNum",
    element: <Workspace />,
  },
]);

const App: React.FC = () => {
  return (
    <UserProvider>
      <RouterProvider router={router} />
    </UserProvider>
  );
};

export default App;
