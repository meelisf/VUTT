import React from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { UserProvider } from './contexts/UserContext';
import Dashboard from './pages/Dashboard';
import Workspace from './pages/Workspace';
import Statistics from './pages/Statistics';
import SearchPage from './pages/SearchPage';
// Uued kasutajahalduse lehed (TODO: loo komponendid)
// import Register from './pages/Register';
// import SetPassword from './pages/SetPassword';
// import Admin from './pages/Admin';
// import Review from './pages/Review';

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
  // Uued kasutajahalduse route'id (TODO: eemalda kommentaarid kui komponendid valmis)
  // {
  //   path: "/register",
  //   element: <Register />,
  // },
  // {
  //   path: "/set-password",
  //   element: <SetPassword />,
  // },
  // {
  //   path: "/admin",
  //   element: <Admin />,
  // },
  // {
  //   path: "/review",
  //   element: <Review />,
  // },
]);

const App: React.FC = () => {
  return (
    <UserProvider>
      <RouterProvider router={router} />
    </UserProvider>
  );
};

export default App;
