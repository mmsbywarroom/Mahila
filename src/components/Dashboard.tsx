import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getZoneDistrictAssembly, isBlockLevelUser } from '../lib/profileHelpers';
import { PlusCircle, List, User, LogOut, Upload, Users, MapPin } from 'lucide-react';
import { authHeadersJson, authUrl, parseJsonResponse } from '../lib/api';

interface DashboardProps {
  onNavigate: (page: 'location' | 'submissions' | 'assembly-report' | 'admin-upload' | 'admin-incharges' | 'admin-user-create') => void;
}

export default function Dashboard({ onNavigate }: DashboardProps) {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';
  const pd = user?.profile_data as Record<string, unknown> | undefined;
  const designation = String(pd?.Designation ?? pd?.designation ?? '')
    .trim()
    .toLowerCase();
  const hasDistrictInchargeScope =
    designation.includes('district') &&
    designation.includes('incharge') &&
    Boolean(pd?.District ?? pd?.district);
  const hasZoneInchargeScope =
    designation.includes('zone') &&
    designation.includes('incharge') &&
    !designation.includes('district') &&
    Boolean(pd?.Zone ?? pd?.zone);
  const hasInchargeWideScope = hasDistrictInchargeScope || hasZoneInchargeScope;
  const isBlockLevel = isBlockLevelUser(user);
  const hasAssemblyRight = Boolean(user?.preferred_assembly) || hasInchargeWideScope;
  const area = user && !isAdmin ? getZoneDistrictAssembly(user) : null;

  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState('');
  const [submissionStats, setSubmissionStats] = useState<{
    total: number;
    assemblyWise: Array<{ assembly: string; count: number }>;
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const loadStats = async () => {
      setStatsLoading(true);
      setStatsError('');
      try {
        const response = await fetch(authUrl('submission-stats'), {
          method: 'POST',
          headers: authHeadersJson(),
          body: JSON.stringify(
            isAdmin
              ? { userId: 'admin', password: 'admin@123' }
              : { userId: user.id }
          ),
        });
        const data = await parseJsonResponse(response);
        if (!response.ok || !data?.success) {
          throw new Error(data?.message || 'Failed to load submission stats');
        }
        if (!cancelled) setSubmissionStats(data);
      } catch (e) {
        if (!cancelled) setStatsError(e instanceof Error ? e.message : 'Failed to load submission stats');
        if (!cancelled) setSubmissionStats(null);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    };

    void loadStats();
    return () => {
      cancelled = true;
    };
  }, [user?.id, isAdmin]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50">
      <div className="max-w-4xl mx-auto p-4 py-8">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Dashboard</h1>
              <p className="text-gray-600">Welcome, {user?.name}{isAdmin ? ' (Admin)' : ''}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="bg-orange-100 p-3 rounded-full">
                <User className="h-6 w-6 text-orange-600" />
              </div>
            </div>
          </div>

          {area && (
            <div className="mb-8 rounded-xl border border-gray-200 bg-gradient-to-br from-stone-50 to-orange-50/40 p-5">
              <div className="flex items-center gap-2 text-gray-700 font-semibold mb-3">
                <MapPin className="h-5 w-5 text-orange-600 shrink-0" />
                <span>Your area</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Zone</p>
                  <p className="text-gray-900 font-medium">{area.zone}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">District</p>
                  <p className="text-gray-900 font-medium">{area.district}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Assembly (AC)</p>
                  <p className="text-gray-900 font-medium">{area.assembly}</p>
                </div>
              </div>
            </div>
          )}

          <div className="mb-8 rounded-xl border border-gray-200 bg-gradient-to-br from-amber-50 to-white/60 p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Submission Dashboard</h2>
            <p className="text-sm text-gray-600 mb-4">
              {statsLoading
                ? 'Loading…'
                : isAdmin
                  ? 'All assemblies'
                  : isBlockLevel
                    ? `Your submissions (Block level) — AC: ${user?.preferred_assembly ?? '—'}`
                    : hasAssemblyRight
                      ? hasInchargeWideScope
                        ? 'Your assigned area (see below)'
                        : `Assembly: ${user?.preferred_assembly}`
                      : 'My submissions'}
            </p>

            {statsError && <div className="mb-4 text-sm text-red-700">{statsError}</div>}

            {!statsLoading && submissionStats && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Total submissions</p>
                    <p className="text-2xl font-bold text-gray-900 tabular-nums">{submissionStats.total.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
                    <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Assembly-wise</p>
                    {submissionStats.assemblyWise.length === 0 ? (
                      <p className="text-sm text-gray-600">No submissions yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <th className="text-left py-2 pr-4 text-gray-600">Assembly</th>
                              <th className="text-right py-2 text-gray-600">Count</th>
                            </tr>
                          </thead>
                          <tbody>
                            {submissionStats.assemblyWise.map((row) => (
                              <tr key={row.assembly} className="border-b border-gray-100 last:border-b-0">
                                <td className="py-2 pr-4 text-gray-900">{row.assembly}</td>
                                <td className="py-2 text-right text-gray-900 tabular-nums">{row.count.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className={`grid grid-cols-1 ${isAdmin ? 'md:grid-cols-2' : 'md:grid-cols-2'} gap-6 mb-8`}>
            {!isAdmin && (
              <button
                onClick={() => onNavigate('location')}
                className="bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white p-8 rounded-xl shadow-lg transition-all transform hover:scale-105 flex flex-col items-center gap-4"
              >
                <PlusCircle className="h-16 w-16" />
                <span className="text-xl font-semibold">New Entry</span>
                <span className="text-sm text-orange-100">Register new Sakhi</span>
              </button>
            )}

            <button
              onClick={() => onNavigate('submissions')}
              className="bg-gradient-to-br from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white p-8 rounded-xl shadow-lg transition-all transform hover:scale-105 flex flex-col items-center gap-4"
            >
              <List className="h-16 w-16" />
              <span className="text-xl font-semibold">
                {isAdmin
                  ? 'All Submissions'
                  : isBlockLevel
                    ? 'My Submissions'
                    : hasAssemblyRight
                      ? 'Assembly Submissions'
                      : 'My Submissions'}
              </span>
              <span className="text-sm text-amber-100">
                {isAdmin
                  ? 'View all submissions'
                  : isBlockLevel
                    ? 'Only entries you added'
                    : hasAssemblyRight
                      ? 'View assembly submissions'
                      : 'View your submissions'}
              </span>
            </button>
            {!isAdmin && hasAssemblyRight && (
              <button
                onClick={() => onNavigate('assembly-report')}
                className="bg-gradient-to-br from-violet-500 to-violet-600 hover:from-violet-600 hover:to-violet-700 text-white p-8 rounded-xl shadow-lg transition-all transform hover:scale-105 flex flex-col items-center gap-4"
              >
                <MapPin className="h-16 w-16" />
                <span className="text-xl font-semibold">Assembly Report</span>
                <span className="text-sm text-violet-100">Booth-wise voters and sakhi</span>
              </button>
            )}

            {isAdmin && (
              <button
                onClick={() => onNavigate('admin-incharges')}
                className="bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white p-8 rounded-xl shadow-lg transition-all transform hover:scale-105 flex flex-col items-center gap-4"
              >
                <Users className="h-16 w-16" />
                <span className="text-xl font-semibold">Incharge Management</span>
                <span className="text-sm text-emerald-100">Upload sheet + auto users</span>
              </button>
            )}

            {isAdmin && (
              <button
                onClick={() => onNavigate('admin-upload')}
                className="bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white p-8 rounded-xl shadow-lg transition-all transform hover:scale-105 flex flex-col items-center gap-4"
              >
                <Upload className="h-16 w-16" />
                <span className="text-xl font-semibold">Upload Locations CSV</span>
                <span className="text-sm text-blue-100">Bulk upload 20k+ records</span>
              </button>
            )}
          </div>

          <div className="border-t pt-6">
            <button
              onClick={logout}
              className="flex items-center gap-3 text-red-600 hover:text-red-700 transition-colors px-4 py-2 rounded-lg hover:bg-red-50"
            >
              <LogOut className="h-5 w-5" />
              <span className="font-medium">Logout</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
