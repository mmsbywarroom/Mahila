import { useEffect, useState } from 'react';
import { BarChart3, FileSpreadsheet, List, PieChart, Upload, UserPlus, Users, Vote } from 'lucide-react';
import { authHeadersJson, authUrl, parseJsonResponse } from '../lib/api';
import type { AdminNavPage } from './AdminLayout';

interface AdminHomeProps {
  onNavigate: (page: AdminNavPage) => void;
}

export default function AdminHome({ onNavigate }: AdminHomeProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<
    Array<{
      assembly: string;
      total_booths: number;
      total_votes: number;
      required_sakhi: number;
      added_sakhi: number;
    }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(authUrl('admin-assembly-dashboard'), {
          method: 'POST',
          headers: authHeadersJson(),
          body: JSON.stringify({ userId: 'admin', password: 'admin@123' }),
        });
        const data = await parseJsonResponse(response);
        if (!response.ok || !data?.success) {
          throw new Error(data?.message || 'Failed to load dashboard');
        }
        if (!cancelled) {
          setRows(
            (Array.isArray(data.rows) ? data.rows : []).map((r) => ({
              assembly: String(r?.assembly ?? ''),
              total_booths: Number(r?.total_booths ?? 0),
              total_votes: Number(r?.total_votes ?? 0),
              required_sakhi: Number(r?.required_sakhi ?? 0),
              added_sakhi: Number(r?.added_sakhi ?? 0),
            }))
          );
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Dashboard</h1>
        <p className="text-gray-600">Welcome — use the sidebar to open each section.</p>
      </div>

      <div className="bg-white rounded-2xl shadow-xl p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Assembly Performance</h2>
        </div>
        {loading ? (
          <p className="text-sm text-gray-500">Loading dashboard…</p>
        ) : error ? (
          <p className="text-sm text-red-700">{error}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Assembly</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Total Booth</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Total Votes</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Required Sakhi</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Added Sakhi</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                      No assembly data found.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.assembly} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-900">{row.assembly}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.total_booths.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.total_votes.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.required_sakhi.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.added_sakhi.toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('submissions')}
          className="bg-gradient-to-br from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white p-6 rounded-xl shadow-lg text-left transition-all"
        >
          <List className="h-10 w-10 mb-3 opacity-90" />
          <span className="block font-semibold text-lg">All Submissions</span>
          <span className="text-sm text-amber-100">View all entries</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('admin-incharges')}
          className="bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white p-6 rounded-xl shadow-lg text-left transition-all"
        >
          <Users className="h-10 w-10 mb-3 opacity-90" />
          <span className="block font-semibold text-lg">Incharge Management</span>
          <span className="text-sm text-emerald-100">Upload sheet + auto users</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('admin-user-create')}
          className="bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white p-6 rounded-xl shadow-lg text-left transition-all"
        >
          <UserPlus className="h-10 w-10 mb-3 opacity-90" />
          <span className="block font-semibold text-lg">User Create</span>
          <span className="text-sm text-orange-100">Manual user create only</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('admin-voter-upload')}
          className="bg-gradient-to-br from-violet-500 to-violet-600 hover:from-violet-600 hover:to-violet-700 text-white p-6 rounded-xl shadow-lg text-left transition-all"
        >
          <Vote className="h-10 w-10 mb-3 opacity-90" />
          <span className="block font-semibold text-lg">Voter List Upload</span>
          <span className="text-sm text-violet-100">Electoral roll CSV (separate module)</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('admin-voter-summary')}
          className="bg-gradient-to-br from-fuchsia-500 to-fuchsia-600 hover:from-fuchsia-600 hover:to-fuchsia-700 text-white p-6 rounded-xl shadow-lg text-left transition-all"
        >
          <BarChart3 className="h-10 w-10 mb-3 opacity-90" />
          <span className="block font-semibold text-lg">Voter summary</span>
          <span className="text-sm text-fuchsia-100">Assembly & booth counts</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('admin-assembly-report')}
          className="bg-gradient-to-br from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white p-6 rounded-xl shadow-lg text-left transition-all"
        >
          <BarChart3 className="h-10 w-10 mb-3 opacity-90" />
          <span className="block font-semibold text-lg">Assembly Report</span>
          <span className="text-sm text-indigo-100">Booth, votes, sakhi + CSV export</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('admin-sakhi-analytics')}
          className="bg-gradient-to-br from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white p-6 rounded-xl shadow-lg text-left transition-all"
        >
          <PieChart className="h-10 w-10 mb-3 opacity-90" />
          <span className="block font-semibold text-lg">Sakhi analytics</span>
          <span className="text-sm text-teal-100">By user, wing & assembly</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('admin-offline-sakhi-add')}
          className="bg-gradient-to-br from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white p-6 rounded-xl shadow-lg text-left transition-all"
        >
          <FileSpreadsheet className="h-10 w-10 mb-3 opacity-90" />
          <span className="block font-semibold text-lg">Offline Sakhi Add</span>
          <span className="text-sm text-rose-100">CSV vs electoral roll report</span>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('admin-upload')}
          className="bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white p-6 rounded-xl shadow-lg text-left transition-all"
        >
          <Upload className="h-10 w-10 mb-3 opacity-90" />
          <span className="block font-semibold text-lg">Locations CSV</span>
          <span className="text-sm text-blue-100">Bulk upload 20k+ records</span>
        </button>
      </div>
    </div>
  );
}
