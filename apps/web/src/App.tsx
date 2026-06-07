import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth.js';
import { Layout } from './components/Layout.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { MapPage } from './pages/MapPage.js';
import { ReportPage } from './pages/ReportPage.js';
import { EventsPage } from './pages/EventsPage.js';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
      </Route>
    </Routes>
  );
}
