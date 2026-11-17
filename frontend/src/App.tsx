import { lazy } from 'react';
import { Result } from 'antd';
import { Route, Routes } from 'react-router-dom';
import { Shell } from './app/Shell';
import { RequireAuth } from './core/auth/RequireAuth';
import { RequireRole } from './core/auth/RequireRole';
import LoginPage from './core/auth/LoginPage';
import ForgotPasswordPage from './core/auth/ForgotPasswordPage';
import SetPasswordPage from './core/auth/SetPasswordPage';

const DashboardPage = lazy(() => import('./modules/dashboard/DashboardPage'));
const RecordsPage = lazy(() => import('./modules/records/RecordsPage'));
const DocumentsPage = lazy(() => import('./modules/documents/DocumentsPage'));
const MastersPage = lazy(() => import('./modules/admin/masters/MastersPage'));
const UsersPage = lazy(() => import('./modules/admin/users/UsersPage'));
const SchedulesPage = lazy(() => import('./modules/admin/schedules/SchedulesPage'));
const BulkToolsPage = lazy(() => import('./modules/admin/bulk/BulkToolsPage'));
const EventsPage = lazy(() => import('./modules/admin/events/EventsPage'));
const LawChangesPage = lazy(() => import('./modules/admin/lawchanges/LawChangesPage'));
const LibraryPage = lazy(() => import('./modules/admin/library/LibraryPage'));
const AuditPage = lazy(() => import('./modules/admin/audit/AuditPage'));
const TasksPage = lazy(() => import('./modules/tasks/TasksPage'));
const ReportsPage = lazy(() => import('./modules/reports/ReportsPage'));
const LegalUpdatesPage = lazy(() => import('./modules/legal/LegalUpdatesPage'));
const ConfigureLegalPage = lazy(() => import('./modules/legal/ConfigureLegalPage'));

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<SetPasswordPage mode="reset" />} />
      <Route path="/accept-invite" element={<SetPasswordPage mode="invite" />} />
      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route path="records" element={<RecordsPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="legal-updates" element={<LegalUpdatesPage />} />
          <Route path="legal-updates/configure" element={<ConfigureLegalPage />} />
          <Route element={<RequireRole roles={['ORG_ADMIN', 'MEMBER']} />}>
            <Route path="tasks" element={<TasksPage />} />
          </Route>
          <Route path="admin" element={<RequireRole roles={['ORG_ADMIN']} />}>
            <Route path="masters" element={<MastersPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="schedules" element={<SchedulesPage />} />
            <Route path="bulk" element={<BulkToolsPage />} />
            <Route path="events" element={<EventsPage />} />
            <Route path="law-changes" element={<LawChangesPage />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="audit" element={<AuditPage />} />
          </Route>
          <Route path="*" element={<Result status="404" title="Page not found" />} />
        </Route>
      </Route>
    </Routes>
  );
}