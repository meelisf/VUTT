import React, { Suspense, lazy } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { UserProvider } from './contexts/UserContext';
import { CollectionProvider } from './contexts/CollectionContext';
import { Loader2 } from 'lucide-react';
import Dashboard from './pages/Dashboard';

// Lazy-loaded lehed (laetakse ainult vajaduse korral)
const Workspace = lazy(() => import('./pages/Workspace'));
const Statistics = lazy(() => import('./pages/Statistics'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const Register = lazy(() => import('./pages/Register'));
const SetPassword = lazy(() => import('./pages/SetPassword'));
const Admin = lazy(() => import('./pages/Admin'));
const Review = lazy(() => import('./pages/Review'));
const NotFound = lazy(() => import('./pages/NotFound'));

// Suspense fallback laadimise ajaks
const PageLoader = () => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center">
    <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
  </div>
);

// Suspense wrapper lazy-loaded lehtede jaoks
const Lazy = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<PageLoader />}>{children}</Suspense>
);

const router = createBrowserRouter([
  {
    path: "/",
    element: <Dashboard />,
  },
  {
    path: "/search",
    element: <Lazy><SearchPage /></Lazy>,
  },
  {
    path: "/stats",
    element: <Lazy><Statistics /></Lazy>,
  },
  {
    path: "/work/:workId/:pageNum?",
    element: <Lazy><Workspace /></Lazy>,
  },
  // Kasutajahalduse route'id
  {
    path: "/register",
    element: <Lazy><Register /></Lazy>,
  },
  {
    path: "/set-password",
    element: <Lazy><SetPassword /></Lazy>,
  },
  {
    path: "/admin",
    element: <Lazy><Admin /></Lazy>,
  },
  {
    path: "/review",
    element: <Lazy><Review /></Lazy>,
  },
  // 404 - catch-all marsruut (peab olema viimane)
  {
    path: "*",
    element: <Lazy><NotFound /></Lazy>,
  },
]);

const App: React.FC = () => {
  return (
    <UserProvider>
      <CollectionProvider>
        <RouterProvider router={router} />
      </CollectionProvider>
    </UserProvider>
  );
};

export default App;
