// Router, providers and role-based guards.
//
//   /login                     sign in
//   /today /promises /sync     officer
//   /m /m/import /m/promises /m/team /m/team/:officerId /m/activity   manager + head
//   /loan/:id                  everyone (read-only for managers)
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import type { Role } from '../shared/types';
import { BrandMark } from './components/Icons';
import { Shell } from './components/Shell';
import { Loading } from './components/States';
import { ToastProvider } from './components/Toast';
import { AuthProvider, homePath, useAuth } from './lib/auth';
import { startOutbox } from './lib/outbox';
import Login from './pages/Login';
import LoanDetail from './pages/officer/LoanDetail';
import Promises from './pages/officer/Promises';
import SyncCenter from './pages/officer/SyncCenter';
import Today from './pages/officer/Today';

// Manager screens load on demand so an officer's low-end phone never parses dashboard code.
const managerPages = () => import('./pages/manager');
const ManagerOverview = lazy(() => managerPages().then((m) => ({ default: m.ManagerOverview })));
const ManagerImport = lazy(() => managerPages().then((m) => ({ default: m.ManagerImport })));
const ManagerPromises = lazy(() => managerPages().then((m) => ({ default: m.ManagerPromises })));
const ManagerTeam = lazy(() => managerPages().then((m) => ({ default: m.ManagerTeam })));
const ManagerOfficerList = lazy(() => managerPages().then((m) => ({ default: m.ManagerOfficerList })));
const ManagerActivity = lazy(() => managerPages().then((m) => ({ default: m.ManagerActivity })));

function Splash() {
  return (
    <div className="splash" role="status" aria-label="Loading">
      <BrandMark size={44} />
    </div>
  );
}

/** Signed in? Otherwise go to /login. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, user } = useAuth();
  const location = useLocation();
  if (!ready) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Right role? Otherwise go to that user's home screen. */
function RequireRole({ roles }: { roles: Role[] }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!roles.includes(user.role)) return <Navigate to={homePath(user.role)} replace />;
  return <Outlet />;
}

function HomeRedirect() {
  const { ready, user } = useAuth();
  if (!ready) return <Splash />;
  return <Navigate to={user ? homePath(user.role) : '/login'} replace />;
}

function LoginRoute() {
  const { ready, user } = useAuth();
  if (!ready) return <Splash />;
  if (user) return <Navigate to={homePath(user.role)} replace />;
  return <Login />;
}

/** Officers get the offline outbox; it keeps retrying in the background once started. */
function OutboxStarter() {
  const { user } = useAuth();
  useEffect(() => {
    if (user?.role === 'officer') startOutbox(user.id);
  }, [user?.role, user?.id]);
  return null;
}

function ManagerSuspense() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <Loading />
        </div>
      }
    >
      <Outlet />
    </Suspense>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route element={<RequireRole roles={['officer']} />}>
          <Route path="/today" element={<Today />} />
          <Route path="/promises" element={<Promises />} />
          <Route path="/sync" element={<SyncCenter />} />
        </Route>
        <Route element={<RequireRole roles={['manager', 'head']} />}>
          <Route element={<ManagerSuspense />}>
            <Route path="/m" element={<ManagerOverview />} />
            <Route path="/m/import" element={<ManagerImport />} />
            <Route path="/m/promises" element={<ManagerPromises />} />
            <Route path="/m/team" element={<ManagerTeam />} />
            <Route path="/m/team/:officerId" element={<ManagerOfficerList />} />
            <Route path="/m/activity" element={<ManagerActivity />} />
          </Route>
        </Route>
        <Route path="/loan/:id" element={<LoanDetail />} />
      </Route>
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <OutboxStarter />
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
