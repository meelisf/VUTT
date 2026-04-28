import React, { Suspense, lazy } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { UserProvider } from './contexts/UserContext';
import { CollectionProvider } from './contexts/CollectionContext';
import { Loader2 } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import RouteErrorBoundary from './components/RouteErrorBoundary';

// Lazy import koos automaatse uuesti laadimisega, kui chunk on pärast uut buildi muutunud
function lazyRetry(importFn: () => Promise<any>) {
  return lazy(() =>
    importFn().catch(() => {
      // Chunk puudub (uus build) → lae leht uuesti, et saada uus index.html
      window.location.reload();
      // Tagasta tühi promise, et vältida React viga enne reload'i
      return new Promise(() => {});
    })
  );
}

// Lazy-loaded lehed (laetakse ainult vajaduse korral)
const Workspace = lazyRetry(() => import('./pages/Workspace'));
const Statistics = lazyRetry(() => import('./pages/Statistics'));
const SearchPage = lazyRetry(() => import('./pages/SearchPage'));
const Register = lazyRetry(() => import('./pages/Register'));
const SetPassword = lazyRetry(() => import('./pages/SetPassword'));
const Admin = lazyRetry(() => import('./pages/Admin'));
const Upload = lazyRetry(() => import('./pages/Upload'));
const Review = lazyRetry(() => import('./pages/Review'));
const Notifications = lazyRetry(() => import('./pages/Notifications'));
const WorkManage = lazyRetry(() => import('./pages/WorkManage'));
const NotFound = lazyRetry(() => import('./pages/NotFound'));
const Settings = lazyRetry(() => import('./pages/Settings'));
const PersonsPage = lazyRetry(() => import('./prosopography/pages/PersonsPage'));
const PersonDetailPage = lazyRetry(() => import('./prosopography/pages/PersonDetailPage'));
const PersonEditPage = lazyRetry(() => import('./prosopography/pages/PersonEditPage'));
const AdminRegistrations = lazyRetry(() => import('./pages/admin/Registrations'));
const AdminUsers = lazyRetry(() => import('./pages/admin/Users'));
const AdminTrash = lazyRetry(() => import('./pages/admin/Trash'));
const AdminCollections = lazyRetry(() => import('./pages/admin/Collections'));

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
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/search",
    element: <Lazy><SearchPage /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/stats",
    element: <Lazy><Statistics /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/work/:workId/manage",
    element: <Lazy><WorkManage /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/work/:workId/:pageNum?",
    element: <Lazy><Workspace /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  // Kasutajahalduse route'id
  {
    path: "/register",
    element: <Lazy><Register /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/set-password",
    element: <Lazy><SetPassword /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/admin",
    element: <Lazy><Admin /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/admin/registrations",
    element: <Lazy><AdminRegistrations /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/admin/users",
    element: <Lazy><AdminUsers /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/admin/trash",
    element: <Lazy><AdminTrash /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/admin/collections",
    element: <Lazy><AdminCollections /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/upload",
    element: <Lazy><Upload /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/review",
    element: <Lazy><Review /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/notifications",
    element: <Lazy><Notifications /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/settings",
    element: <Lazy><Settings /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  // Prosopograafia
  {
    path: "/persons",
    element: <Lazy><PersonsPage /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/persons/new",
    element: <Lazy><PersonEditPage /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/persons/:id",
    element: <Lazy><PersonDetailPage /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/persons/:id/edit",
    element: <Lazy><PersonEditPage /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
  // 404 - catch-all marsruut (peab olema viimane)
  {
    path: "*",
    element: <Lazy><NotFound /></Lazy>,
    errorElement: <RouteErrorBoundary />,
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
