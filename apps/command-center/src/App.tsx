import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth.js';
import { CCLayout } from './components/CCLayout.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { OpsRoomPage } from './pages/OpsRoomPage.js';
import { CrisesPage } from './pages/CrisesPage.js';
import { RegistrePage } from './pages/RegistrePage.js';
import { DistributionsPage } from './pages/DistributionsPage.js';
import { CoordinationPage } from './pages/CoordinationPage.js';
import { RapportsPage } from './pages/RapportsPage.js';
import { StocksPage } from './pages/StocksPage.js';
import { AiPage } from './pages/AiPage.js';
import { ConflitPage } from './pages/ConflitPage.js';
import { RenseignementPage } from './pages/RenseignementPage.js';
import { IdpCheckpointPage } from './pages/IdpCheckpointPage.js';
import { EpidemicPage } from './pages/EpidemicPage.js';
import { EtdPage } from './pages/EtdPage.js';
import { AdminPage } from './pages/AdminPage.js';
import { CartographiePage } from './pages/CartographiePage.js';
import { ResponsablesPage } from './pages/ResponsablesPage.js';
import { RuesPage } from './pages/RuesPage.js';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function RequireRole({ role, children }: { role: string; children: React.ReactNode }) {
  const user = useAuthStore(s => s.user);
  return user?.role === role ? <>{children}</> : <Navigate to="/dashboard" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <CCLayout />
          </RequireAuth>
        }
      >
        <Route index                 element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"      element={<DashboardPage />} />
        <Route path="ops"            element={<OpsRoomPage />} />
        <Route path="crises"         element={<CrisesPage />} />
        <Route path="registre"       element={<RegistrePage />} />
        <Route path="distributions"  element={<DistributionsPage />} />
        <Route path="coordination"   element={<CoordinationPage />} />
        <Route path="rapports"       element={<RapportsPage />} />
        <Route path="stocks"         element={<StocksPage />} />
        <Route path="ai"             element={<AiPage />} />
        <Route path="conflit"          element={<ConflitPage />} />
        <Route path="renseignement"  element={<RenseignementPage />} />
        <Route path="etd"            element={<EtdPage />} />
        <Route path="idp"            element={<IdpCheckpointPage />} />
        <Route path="epidemie"       element={<EpidemicPage />} />
        <Route path="cartographie"   element={<CartographiePage />} />
        <Route path="responsables"   element={<ResponsablesPage />} />
        <Route path="rues"           element={<RuesPage />} />
        <Route path="admin" element={
          <RequireRole role="system_admin"><AdminPage /></RequireRole>
        } />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
