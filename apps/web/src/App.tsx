import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth.js';
import { Layout } from './components/Layout.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { MapPage } from './pages/MapPage.js';
import { ReportPage } from './pages/ReportPage.js';
import { EventsPage } from './pages/EventsPage.js';
import { RegistryPage } from './pages/RegistryPage.js';
import { BeneficiaryFormPage } from './pages/BeneficiaryFormPage.js';
import { DistributionsPage } from './pages/DistributionsPage.js';
import { UsersPage } from './pages/UsersPage.js';
import { AuditLogPage } from './pages/AuditLogPage.js';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.js'
import { ResourcesPage } from './pages/ResourcesPage.js';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'system_admin' && user.role !== 'national_decision_maker') {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="map" element={<MapPage />} />
        <Route path="report" element={<ReportPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="registry" element={<RegistryPage />} />
        <Route path="registry/new" element={<BeneficiaryFormPage />} />
        <Route path="distributions" element={<DistributionsPage />} />
        <Route path="resources" element={<ResourcesPage />} />
        <Route path="admin/users" element={<AdminRoute><UsersPage /></AdminRoute>} />
        <Route path="admin/audit-log" element={<AdminRoute><AuditLogPage /></AdminRoute>} />
      </Route>
    </Routes>
  );
}
