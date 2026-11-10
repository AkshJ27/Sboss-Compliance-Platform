import { lazy } from 'react';
import { Result } from 'antd';
import { Route, Routes } from 'react-router-dom';
import { Shell } from './app/Shell';
import { RequireAuth } from './core/auth/RequireAuth';
import { RequireRole } from './core/auth/RequireRole';
import LoginPage from './core/auth/LoginPage';

const DashboardPage = lazy(() => import('./modules/dashboard/DashboardPage'));
const RecordsPage = lazy(() => import('./modules/records/RecordsPage'));
const DocumentsPage = lazy(() => import('./modules/documents/DocumentsPage'));
const MastersPage = lazy(() => import('./modules/admin/masters/MastersPage'));
const UsersPage = lazy(() => import('./modules/admin/users/UsersPage'));
const SchedulesPage = lazy(() => import('./modules/admin/schedules/SchedulesPage'));
const LibraryPage = lazy(() => import('./modules/admin/library/LibraryPage'));
const AuditPage = lazy(() => import('./modules/admin/audit/AuditPage'));

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route path="records" element={<RecordsPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="admin" element={<RequireRole roles={['ORG_ADMIN']} />}>
            <Route path="masters" element={<MastersPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="schedules" element={<SchedulesPage />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="audit" element={<AuditPage />} />
          </Route>
          <Route path="*" element={<Result status="404" title="Page not found" />} />
        </Route>
      </Route>
    </Routes>
  );
}