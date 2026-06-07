import { Routes, Route, Navigate } from 'react-router-dom';
import { PublicLayout } from './components/PublicLayout.js';
import { HomePage } from './pages/HomePage.js';
import { CartePage } from './pages/CartePage.js';
import { StatistiquesPage } from './pages/StatistiquesPage.js';
import { DonneesPage } from './pages/DonneesPage.js';

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<HomePage />} />
        <Route path="carte" element={<CartePage />} />
        <Route path="statistiques" element={<StatistiquesPage />} />
        <Route path="donnees" element={<DonneesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
