import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth.js';
import { CCLayout } from './components/CCLayout.js';
import { LoginPage } from './pages/LoginPage.js';
import { OpsRoomPage } from './pages/OpsRoomPage.js';
import { CrisesPage } from './pages/CrisesPage.js';
import { CoordinationPage } from './pages/CoordinationPage.js';
import { RapportsPage } from './pages/RapportsPage.js';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
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
        <Route index element={<Navigate to="/ops" replace />} />
        <Route path="ops"          element={<OpsRoomPage />} />
        <Route path="crises"       element={<CrisesPage />} />
        <Route path="coordination" element={<CoordinationPage />} />
        <Route path="rapports"     element={<RapportsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/ops" replace />} />
    </Routes>
  );
}
