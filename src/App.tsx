import { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import SakhiForm from './components/SakhiForm';
import Submissions from './components/Submissions';
import AdminLocationUpload from './components/AdminLocationUpload';
import AdminUserManagement from './components/AdminUserManagement';
import AdminInchargeManagement from './components/AdminInchargeManagement';
import AdminVoterListUpload from './components/AdminVoterListUpload';
import AdminVoterSummary from './components/AdminVoterSummary';
import AdminAssemblyReport from './components/AdminAssemblyReport';
import AdminSakhiAnalytics from './components/AdminSakhiAnalytics';
import AdminOfflineSakhiAdd from './components/AdminOfflineSakhiAdd';
import AdminLayout from './components/AdminLayout';
import AdminHome from './components/AdminHome';
import AssemblyReport from './components/AssemblyReport';
import type { AdminNavPage } from './components/AdminLayout';

type Page =
  | 'dashboard'
  | 'location'
  | 'submissions'
  | 'assembly-report'
  | 'admin-upload'
  | 'admin-incharges'
  | 'admin-user-create'
  | 'admin-voter-upload'
  | 'admin-voter-summary'
  | 'admin-assembly-report'
  | 'admin-sakhi-analytics';

function normalizePathname(path: string): string {
  const p = path.replace(/\/+$/, '') || '/';
  return p;
}

/** Public share link: full assembly report without admin session */
function isPublicAssemblyReportPath(pathname: string): boolean {
  const p = normalizePathname(pathname);
  return p === '/admin/assembly-report' || p === '/admin/aasembly-report';
}

function AppContent() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const { user, isLoading } = useAuth();
  const isAdminLoginPath = pathname === '/admin' || pathname === '/admin/';
  const isAdmin = user?.role === 'admin';
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');

  if (isPublicAssemblyReportPath(pathname)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50">
        <AdminAssemblyReport publicView />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-orange-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login forceMode={isAdminLoginPath ? 'admin' : 'user'} />;
  }

  // Strict URL-mode guard:
  // - /admin only for admin session
  // - non-/admin path only for user session
  if (isAdminLoginPath && !isAdmin) {
    return <Login forceMode="admin" />;
  }
  if (!isAdminLoginPath && isAdmin) {
    return <Login forceMode="user" />;
  }

  const handleNavigate = (page: Page) => {
    setCurrentPage(page);
  };

  const handleAdminNavigate = (page: AdminNavPage) => {
    setCurrentPage(page);
  };

  const handleFormSuccess = () => {
    setCurrentPage('dashboard');
  };

  switch (currentPage) {
    case 'location':
      if (isAdmin) {
        return (
          <AdminLayout activePage="dashboard" onNavigate={handleAdminNavigate}>
            <AdminHome onNavigate={handleAdminNavigate} />
          </AdminLayout>
        );
      }
      return (
        <SakhiForm
          onBack={() => setCurrentPage('dashboard')}
          onSuccess={handleFormSuccess}
        />
      );
    case 'submissions':
      if (isAdmin) {
        return (
          <AdminLayout activePage="submissions" onNavigate={handleAdminNavigate}>
            <Submissions embedded />
          </AdminLayout>
        );
      }
      return <Submissions onBack={() => setCurrentPage('dashboard')} />;
    case 'assembly-report':
      if (isAdmin) {
        return (
          <AdminLayout activePage="dashboard" onNavigate={handleAdminNavigate}>
            <AdminHome onNavigate={handleAdminNavigate} />
          </AdminLayout>
        );
      }
      return <AssemblyReport onBack={() => setCurrentPage('dashboard')} />;
    case 'admin-upload':
      if (!isAdmin) {
        return <Dashboard onNavigate={handleNavigate} />;
      }
      return (
        <AdminLayout activePage="admin-upload" onNavigate={handleAdminNavigate}>
          <AdminLocationUpload embedded />
        </AdminLayout>
      );
    case 'admin-incharges':
      if (!isAdmin) {
        return <Dashboard onNavigate={handleNavigate} />;
      }
      return (
        <AdminLayout activePage="admin-incharges" onNavigate={handleAdminNavigate}>
          <AdminInchargeManagement embedded />
        </AdminLayout>
      );
    case 'admin-user-create':
      if (!isAdmin) {
        return <Dashboard onNavigate={handleNavigate} />;
      }
      return (
        <AdminLayout activePage="admin-user-create" onNavigate={handleAdminNavigate}>
          <AdminUserManagement embedded />
        </AdminLayout>
      );
    case 'admin-voter-upload':
      if (!isAdmin) {
        return <Dashboard onNavigate={handleNavigate} />;
      }
      return (
        <AdminLayout activePage="admin-voter-upload" onNavigate={handleAdminNavigate}>
          <AdminVoterListUpload embedded />
        </AdminLayout>
      );
    case 'admin-voter-summary':
      if (!isAdmin) {
        return <Dashboard onNavigate={handleNavigate} />;
      }
      return (
        <AdminLayout activePage="admin-voter-summary" onNavigate={handleAdminNavigate}>
          <AdminVoterSummary embedded />
        </AdminLayout>
      );
    case 'admin-assembly-report':
      if (!isAdmin) {
        return <Dashboard onNavigate={handleNavigate} />;
      }
      return (
        <AdminLayout activePage="admin-assembly-report" onNavigate={handleAdminNavigate}>
          <AdminAssemblyReport embedded />
        </AdminLayout>
      );
    case 'admin-sakhi-analytics':
      if (!isAdmin) {
        return <Dashboard onNavigate={handleNavigate} />;
      }
      return (
        <AdminLayout activePage="admin-sakhi-analytics" onNavigate={handleAdminNavigate}>
          <AdminSakhiAnalytics embedded />
        </AdminLayout>
      );
    case 'admin-offline-sakhi-add':
      if (!isAdmin) {
        return <Dashboard onNavigate={handleNavigate} />;
      }
      return (
        <AdminLayout activePage="admin-offline-sakhi-add" onNavigate={handleAdminNavigate}>
          <AdminOfflineSakhiAdd embedded />
        </AdminLayout>
      );
    default:
      if (isAdmin) {
        return (
          <AdminLayout activePage="dashboard" onNavigate={handleAdminNavigate}>
            <AdminHome onNavigate={handleAdminNavigate} />
          </AdminLayout>
        );
      }
      return <Dashboard onNavigate={handleNavigate} />;
  }
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
