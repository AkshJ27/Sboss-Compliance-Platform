import { lazy } from 'react';
import { Result } from 'antd';
import { Route, Routes } from 'react-router-dom';
import { Shell } from './app/Shell';
import { RequireAuth } from './core/auth/RequireAuth';
import LoginPage from './core/auth/LoginPage';

const DashboardPage = lazy(() => import('./modules/dashboard/DashboardPage'));
const RecordsPage = lazy(() => import('./modules/records/RecordsPage'));

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route path="records" element={<RecordsPage />} />
          <Route path="*" element={<Result status="404" title="Page not found" />} />
        </Route>
      </Route>
    </Routes>
  );
}