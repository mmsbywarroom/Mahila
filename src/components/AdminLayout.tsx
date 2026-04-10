import type { ReactNode } from 'react';
import { BarChart3, FileSpreadsheet, LayoutDashboard, List, LogOut, PieChart, Upload, UserPlus, Users, Vote } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export type AdminNavPage =
  | 'dashboard'
  | 'submissions'
  | 'admin-upload'
  | 'admin-incharges'
  | 'admin-user-create'
  | 'admin-voter-upload'
  | 'admin-voter-summary'
  | 'admin-assembly-report'
  | 'admin-sakhi-analytics'
  | 'admin-offline-sakhi-add';

interface AdminLayoutProps {
  activePage: AdminNavPage;
  onNavigate: (page: AdminNavPage) => void;
  children: ReactNode;
}

const navItems: Array<{ page: AdminNavPage; label: string; icon: typeof LayoutDashboard }> = [
  { page: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { page: 'submissions', label: 'All Submissions', icon: List },
  { page: 'admin-incharges', label: 'Incharge Management', icon: Users },
  { page: 'admin-user-create', label: 'User Create', icon: UserPlus },
  { page: 'admin-voter-upload', label: 'Voter List Upload', icon: Vote },
  { page: 'admin-voter-summary', label: 'Voter summary', icon: BarChart3 },
  { page: 'admin-assembly-report', label: 'Assembly Report', icon: BarChart3 },
  { page: 'admin-sakhi-analytics', label: 'Sakhi analytics', icon: PieChart },
  { page: 'admin-offline-sakhi-add', label: 'Offline Sakhi Add', icon: FileSpreadsheet },
  { page: 'admin-upload', label: 'Upload Locations CSV', icon: Upload },
];

export default function AdminLayout({ activePage, onNavigate, children }: AdminLayoutProps) {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen overflow-hidden bg-slate-900">
      <aside className="hidden md:flex w-64 shrink-0 flex-col h-full min-h-0 border-r border-slate-700/80 bg-slate-900 text-slate-100">
        <div className="shrink-0 p-6 border-b border-slate-700/80">
          <p className="text-xs font-medium uppercase tracking-wider text-orange-400">Admin Panel</p>
          <p className="mt-1 font-semibold text-white truncate">{user?.name ?? 'Admin'}</p>
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-1">
          {navItems.map(({ page, label, icon: Icon }) => {
            const active = activePage === page;
            return (
              <button
                key={page}
                type="button"
                onClick={() => onNavigate(page)}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  active
                    ? 'bg-orange-600 text-white shadow-md'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="h-5 w-5 shrink-0 opacity-90" />
                {label}
              </button>
            );
          })}
        </nav>
        <div className="shrink-0 p-3 border-t border-slate-700/80 bg-slate-900">
          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-red-400 hover:bg-slate-800 hover:text-red-300 transition-colors"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            Logout
          </button>
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
        <header className="shrink-0 flex md:hidden items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
          <span className="font-semibold text-gray-900">Admin</span>
          <select
            value={activePage}
            onChange={(e) => onNavigate(e.target.value as AdminNavPage)}
            className="flex-1 max-w-[200px] rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          >
            {navItems.map(({ page, label }) => (
              <option key={page} value={page}>
                {label}
              </option>
            ))}
          </select>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-6 lg:p-8">
          {children}
        </main>

        <div className="shrink-0 flex border-t border-slate-200 bg-white p-3 md:hidden">
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
