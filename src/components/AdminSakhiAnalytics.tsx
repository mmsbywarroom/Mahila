import { useEffect, useMemo, useState } from 'react';
import { Download, PieChart, RefreshCw, Search } from 'lucide-react';
import { authHeadersJson, authUrl, parseJsonResponse } from '../lib/api';

interface AdminSakhiAnalyticsProps {
  embedded?: boolean;
}

type ByUser = { user_id: string; name: string; mobile: string; wing: string; total_sakhi: number };
type ByWing = { wing: string; total_sakhi: number };
type ByAssembly = { assembly: string; total_sakhi: number };
type ByUserAssembly = { user_id: string; name: string; assembly: string; sakhi_count: number };

function csvEscape(value: string | number): string {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function AdminSakhiAnalytics({ embedded }: AdminSakhiAnalyticsProps) {
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [totalSubmissions, setTotalSubmissions] = useState(0);
  const [byUser, setByUser] = useState<ByUser[]>([]);
  const [byWing, setByWing] = useState<ByWing[]>([]);
  const [byAssembly, setByAssembly] = useState<ByAssembly[]>([]);
  const [byUserAssembly, setByUserAssembly] = useState<ByUserAssembly[]>([]);
  const [search, setSearch] = useState('');

  const byUserF = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return byUser;
    return byUser.filter((r) =>
      `${r.name} ${r.mobile} ${r.wing}`.toLowerCase().includes(q)
    );
  }, [byUser, search]);

  const byWingF = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return byWing;
    return byWing.filter((r) => r.wing.toLowerCase().includes(q));
  }, [byWing, search]);

  const byAssemblyF = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return byAssembly;
    return byAssembly.filter((r) => r.assembly.toLowerCase().includes(q));
  }, [byAssembly, search]);

  const byUserAssemblyF = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return byUserAssembly;
    return byUserAssembly.filter((r) =>
      `${r.name} ${r.assembly}`.toLowerCase().includes(q)
    );
  }, [byUserAssembly, search]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(authUrl('admin-sakhi-analytics'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({ userId: 'admin', password: 'admin@123' }),
      });
      const data = await parseJsonResponse(response);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to load analytics');
      }
      setTotalSubmissions(Number(data.totalSubmissions ?? 0));
      setByUser(Array.isArray(data.byUser) ? data.byUser : []);
      setByWing(Array.isArray(data.byWing) ? data.byWing : []);
      setByAssembly(Array.isArray(data.byAssembly) ? data.byAssembly : []);
      setByUserAssembly(Array.isArray(data.byUserAssembly) ? data.byUserAssembly : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setByUser([]);
      setByWing([]);
      setByAssembly([]);
      setByUserAssembly([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const downloadCsv = () => {
    setDownloading(true);
    try {
      const lines: string[] = [];
      lines.push(['Metric', 'Value'].map(csvEscape).join(','));
      lines.push(['Total sakhi entries (submissions)', totalSubmissions].map(csvEscape).join(','));
      lines.push('');
      lines.push(['By user — Name', 'Mobile', 'Wing', 'Sakhi added'].map(csvEscape).join(','));
      byUser.forEach((r) => {
        lines.push([r.name, r.mobile, r.wing, r.total_sakhi].map(csvEscape).join(','));
      });
      lines.push('');
      lines.push(['By wing — Wing', 'Sakhi added'].map(csvEscape).join(','));
      byWing.forEach((r) => {
        lines.push([r.wing, r.total_sakhi].map(csvEscape).join(','));
      });
      lines.push('');
      lines.push(['By assembly — Assembly', 'Sakhi added'].map(csvEscape).join(','));
      byAssembly.forEach((r) => {
        lines.push([r.assembly, r.total_sakhi].map(csvEscape).join(','));
      });
      lines.push('');
      lines.push(['By user × assembly — Name', 'Assembly', 'Sakhi added'].map(csvEscape).join(','));
      byUserAssembly.forEach((r) => {
        lines.push([r.name, r.assembly, r.sakhi_count].map(csvEscape).join(','));
      });

      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sakhi-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className={embedded ? 'w-full' : 'min-h-screen bg-gradient-to-br from-orange-50 to-amber-50'}>
      <div className={`${embedded ? 'max-w-full' : 'max-w-6xl'} mx-auto ${embedded ? '' : 'p-4 py-8'}`}>
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-teal-100 p-3 rounded-xl">
                <PieChart className="h-7 w-7 text-teal-800" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Sakhi analytics</h1>
                <p className="text-gray-600">
                  Per user, per wing, per assembly — who added how many sakhi entries
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={downloadCsv}
                disabled={downloading || loading || totalSubmissions === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                Download CSV
              </button>
            </div>
          </div>

          <div className="relative mb-6">
            <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter tables by name, mobile, wing, assembly…"
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div className="rounded-lg border border-teal-200 bg-teal-50/50 px-4 py-3 mb-8">
            <p className="text-sm text-teal-950">
              <span className="font-semibold">Total sakhi entries (submissions): </span>
              {loading ? '…' : totalSubmissions.toLocaleString()}
            </p>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : error ? (
            <p className="text-sm text-red-700">{error}</p>
          ) : (
            <div className="space-y-10">
              <section>
                <h2 className="text-lg font-semibold text-gray-900 mb-3">By user (total added)</h2>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Name</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Mobile</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Wing</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-700">Sakhi added</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byUserF.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                            {byUser.length === 0 ? 'No data.' : 'No rows match filter.'}
                          </td>
                        </tr>
                      ) : (
                        byUserF.map((r) => (
                          <tr key={r.user_id} className="border-t border-gray-100">
                            <td className="px-3 py-2 text-gray-900">{r.name}</td>
                            <td className="px-3 py-2 font-mono text-gray-800">{r.mobile}</td>
                            <td className="px-3 py-2 text-indigo-900">{r.wing}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium">
                              {r.total_sakhi.toLocaleString()}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-gray-900 mb-3">By wing (total added)</h2>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Wing</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-700">Sakhi added</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byWingF.length === 0 ? (
                        <tr>
                          <td colSpan={2} className="px-3 py-6 text-center text-gray-500">
                            {byWing.length === 0 ? 'No data.' : 'No rows match filter.'}
                          </td>
                        </tr>
                      ) : (
                        byWingF.map((r) => (
                          <tr key={r.wing} className="border-t border-gray-100">
                            <td className="px-3 py-2 text-gray-900">{r.wing}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.total_sakhi.toLocaleString()}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-gray-900 mb-3">By assembly (all users)</h2>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Assembly</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-700">Sakhi added</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byAssemblyF.length === 0 ? (
                        <tr>
                          <td colSpan={2} className="px-3 py-6 text-center text-gray-500">
                            {byAssembly.length === 0 ? 'No data.' : 'No rows match filter.'}
                          </td>
                        </tr>
                      ) : (
                        byAssemblyF.map((r) => (
                          <tr key={r.assembly} className="border-t border-gray-100">
                            <td className="px-3 py-2 text-gray-900">{r.assembly}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.total_sakhi.toLocaleString()}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-gray-900 mb-3">By user × assembly (detail)</h2>
                <p className="text-xs text-gray-500 mb-2">
                  Same user can appear on multiple rows — one row per assembly they submitted in.
                </p>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">User</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Assembly</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-700">Sakhi added</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byUserAssemblyF.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-3 py-6 text-center text-gray-500">
                            {byUserAssembly.length === 0 ? 'No data.' : 'No rows match filter.'}
                          </td>
                        </tr>
                      ) : (
                        byUserAssemblyF.map((r, i) => (
                          <tr key={`${r.user_id}-${r.assembly}-${i}`} className="border-t border-gray-100">
                            <td className="px-3 py-2 text-gray-900">{r.name}</td>
                            <td className="px-3 py-2 text-gray-800">{r.assembly}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.sakhi_count.toLocaleString()}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
