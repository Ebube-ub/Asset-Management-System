import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppLayout } from './components/layout/AppLayout';
import { canAccess, type NavKey } from '@shared/domain';
import { Spinner } from './components/ui';

import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { RequestsPage } from './pages/Requests';
import { NewRequestPage } from './pages/NewRequest';
import { RequestDetailPage } from './pages/RequestDetail';
import { ApprovalsPage } from './pages/Approvals';
import { StockPage } from './pages/Stock';
import { QuotationsPage } from './pages/Quotations';
import { QuotationDetailPage } from './pages/QuotationDetail';
import { FinancialPage } from './pages/Financial';
import { PurchasesPage } from './pages/Purchases';
import { AssetsPage } from './pages/Assets';
import { AssetDetailPage } from './pages/AssetDetail';
import { TransfersPage, ReturnsPage } from './pages/Movements';
import { DisposalsPage } from './pages/Disposals';
import { StaffPage } from './pages/Staff';
import { StaffDetailPage } from './pages/StaffDetail';
import { OrganisationPage } from './pages/Organisation';
import { RoomsPage } from './pages/Rooms';
import { AssetConfigurationPage } from './pages/AssetConfiguration';
import { ReportsPage } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { ProfilePage } from './pages/Profile';

function Guard({ children, area }: { children: React.ReactNode; area: NavKey }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (!canAccess(user.roles, area)) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-slate-200 bg-surface p-8 text-center">
        <p className="text-sm font-semibold text-ink">You do not have access to this module</p>
        <p className="mt-1 text-xs text-slate-500">
          This area is limited to specific roles. Your role is {user.roles.join(', ') || 'staff member'}.
        </p>
        <a href="/dashboard" className="mt-4 inline-block text-xs font-semibold text-brand-500 hover:underline">
          Back to your dashboard
        </a>
      </div>
    );
  }
  return <>{children}</>;
}

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <Spinner label="Starting I4nnova…" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route
        element={
          user ? (
            <AppLayout />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/requests" element={<RequestsPage />} />
        <Route path="/requests/new" element={<NewRequestPage />} />
        <Route path="/requests/:id" element={<RequestDetailPage />} />
        <Route path="/requests/:id/edit" element={<NewRequestPage />} />
        <Route path="/approvals" element={<Guard area="approvals"><ApprovalsPage /></Guard>} />
        <Route path="/stock" element={<Guard area="stock"><StockPage /></Guard>} />
        <Route path="/quotations" element={<Guard area="quotations"><QuotationsPage /></Guard>} />
        <Route path="/quotations/:id" element={<Guard area="quotations"><QuotationDetailPage /></Guard>} />
        <Route path="/financial-approvals" element={<Guard area="financial-approvals"><FinancialPage /></Guard>} />
        <Route path="/purchases" element={<Guard area="purchases"><PurchasesPage /></Guard>} />
        <Route path="/assets" element={<AssetsPage />} />
        <Route path="/assets/:id" element={<AssetDetailPage />} />
        <Route path="/transfers" element={<TransfersPage />} />
        <Route path="/returns" element={<ReturnsPage />} />
        <Route path="/disposals" element={<Guard area="disposals"><DisposalsPage /></Guard>} />
        <Route path="/staff" element={<Guard area="staff"><StaffPage /></Guard>} />
        <Route path="/staff/:id" element={<Guard area="staff"><StaffDetailPage /></Guard>} />
        <Route path="/organisation" element={<Guard area="organisation"><OrganisationPage /></Guard>} />
        <Route path="/rooms" element={<Guard area="rooms"><RoomsPage /></Guard>} />
        <Route
          path="/asset-configuration"
          element={
            <Guard area="asset-configuration">
              <AssetConfigurationPage />
            </Guard>
          }
        />
        <Route path="/asset-types" element={<Navigate to="/asset-configuration" replace />} />
        <Route path="/reports" element={<Guard area="reports"><ReportsPage /></Guard>} />
        <Route path="/settings" element={<Guard area="settings"><SettingsPage /></Guard>} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
