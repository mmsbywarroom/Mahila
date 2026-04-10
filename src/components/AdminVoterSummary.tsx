import { useState, useEffect, useCallback } from 'react';
import { authUrl, authHeadersJson, parseJsonResponse } from '../lib/api';
import { ArrowLeft, BarChart3, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';

interface AdminVoterSummaryProps {
  onBack?: () => void;
  embedded?: boolean;
}

const ADMIN_USER_ID = 'admin';
const ADMIN_PASSWORD = 'admin@123';
const BOOTH_PAGE = 50;

type AssemblyRow = { assembly: string; vote_count: number; booth_count: number };
type BoothRow = { booth: string; votes: number };

export default function AdminVoterSummary({ onBack, embedded }: AdminVoterSummaryProps) {
  const [filter, setFilter] = useState('');
  const [debouncedFilter, setDebouncedFilter] = useState('');
  const [assemblies, setAssemblies] = useState<AssemblyRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');

  const [selectedAssembly, setSelectedAssembly] = useState<string | null>(null);
  const [boothRows, setBoothRows] = useState<BoothRow[]>([]);
  const [boothOffset, setBoothOffset] = useState(0);
  const [boothHasMore, setBoothHasMore] = useState(false);
  const [boothTotal, setBoothTotal] = useState(0);
  const [boothLoading, setBoothLoading] = useState(false);
  const [boothError, setBoothError] = useState('');

  const [refreshingMv, setRefreshingMv] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilter(filter.trim()), 350);
    return () => clearTimeout(t);
  }, [filter]);

  const fetchAssemblies = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      const response = await fetch(authUrl('admin-voter-summary-assemblies'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({
          userId: ADMIN_USER_ID,
          password: ADMIN_PASSWORD,
          filter: debouncedFilter,
          limit: 200,
        }),
      });
      const data = await parseJsonResponse(response);
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to load assemblies');
      }
      const raw = data.assemblies;
      const arr: AssemblyRow[] = Array.isArray(raw)
        ? raw.map((r: { assembly?: string; vote_count?: number; booth_count?: number }) => ({
            assembly: String(r.assembly ?? ''),
            vote_count: Number(r.vote_count ?? 0),
            booth_count: Number(r.booth_count ?? 0),
          }))
        : [];
      setAssemblies(arr);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Load failed');
      setAssemblies([]);
    } finally {
      setListLoading(false);
    }
  }, [debouncedFilter]);

  useEffect(() => {
    void fetchAssemblies();
  }, [fetchAssemblies]);

  const fetchBooths = useCallback(async (assembly: string, offset: number) => {
    setBoothLoading(true);
    setBoothError('');
    try {
      const response = await fetch(authUrl('admin-voter-summary-booths'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({
          userId: ADMIN_USER_ID,
          password: ADMIN_PASSWORD,
          assembly,
          limit: BOOTH_PAGE,
          offset,
        }),
      });
      const data = await parseJsonResponse(response);
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to load booths');
      }
      const raw = data.rows as BoothRow[] | undefined;
      setBoothRows(
        Array.isArray(raw)
          ? raw.map((r) => ({ booth: String(r.booth), votes: Number(r.votes) }))
          : []
      );
      setBoothHasMore(Boolean(data.hasMore));
      setBoothTotal(Number(data.totalBooths ?? 0));
    } catch (e) {
      setBoothError(e instanceof Error ? e.message : 'Load failed');
      setBoothRows([]);
    } finally {
      setBoothLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedAssembly) {
      setBoothRows([]);
      setBoothOffset(0);
      setBoothHasMore(false);
      setBoothTotal(0);
      return;
    }
    void fetchBooths(selectedAssembly, boothOffset);
  }, [selectedAssembly, boothOffset, fetchBooths]);

  const refreshMaterializedView = async () => {
    setRefreshingMv(true);
    setRefreshMsg('');
    try {
      const response = await fetch(authUrl('admin-voter-summary-refresh'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({
          userId: ADMIN_USER_ID,
          password: ADMIN_PASSWORD,
        }),
      });
      const data = await parseJsonResponse(response);
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Refresh failed');
      }
      setRefreshMsg('Summary data refreshed.');
      void fetchAssemblies();
      if (selectedAssembly) {
        void fetchBooths(selectedAssembly, boothOffset);
      }
    } catch (e) {
      setRefreshMsg(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setRefreshingMv(false);
    }
  };

  return (
    <div className={embedded ? 'w-full' : 'min-h-screen bg-gradient-to-br from-orange-50 to-amber-50'}>
      <div className={`${embedded ? 'max-w-full' : 'max-w-6xl'} mx-auto ${embedded ? '' : 'p-4 py-8'}`}>
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex flex-wrap items-start gap-4 mb-6">
            {onBack && (
              <button type="button" onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <ArrowLeft className="h-6 w-6 text-gray-600" />
              </button>
            )}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="bg-violet-100 p-3 rounded-xl shrink-0">
                <BarChart3 className="h-8 w-8 text-violet-700" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Voter summary</h1>
                <p className="text-gray-600 text-sm">
                  Assembly and booth numbers come from pre-built summary tables (materialized views) — the app does not scan
                  millions of voter rows on each view. After big uploads, run <strong>Refresh summary</strong> once so counts
                  stay current.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-6">
            <button
              type="button"
              onClick={() => void refreshMaterializedView()}
              disabled={refreshingMv}
              className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-900 hover:bg-violet-100 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshingMv ? 'animate-spin' : ''}`} />
              Refresh summary
            </button>
            {refreshMsg && <span className="text-sm text-gray-600">{refreshMsg}</span>}
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Filter by assembly name</label>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Type to filter…"
              className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
          </div>

          {listError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{listError}</div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-2">Assemblies</h2>
              <div className="overflow-x-auto rounded-lg border border-gray-200 max-h-[420px] overflow-y-auto">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-gray-700">Assembly</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 tabular-nums">Booths</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 tabular-nums">Votes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listLoading ? (
                      <tr>
                        <td colSpan={3} className="px-3 py-8 text-center text-gray-500">
                          Loading…
                        </td>
                      </tr>
                    ) : assemblies.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-3 py-8 text-center text-gray-500">
                          No assemblies match. Refresh summary after upload, or adjust filter.
                        </td>
                      </tr>
                    ) : (
                      assemblies.map((row) => (
                        <tr
                          key={row.assembly}
                          onClick={() => {
                            setSelectedAssembly(row.assembly);
                            setBoothOffset(0);
                          }}
                          className={`cursor-pointer border-b border-gray-100 last:border-0 hover:bg-violet-50 ${
                            selectedAssembly === row.assembly ? 'bg-violet-100/80' : ''
                          }`}
                        >
                          <td className="px-3 py-2 text-gray-900">{row.assembly}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.booth_count.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{row.vote_count.toLocaleString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-2">
                Booths — {selectedAssembly ?? '—'}
              </h2>
              {!selectedAssembly && (
                <p className="text-sm text-gray-500 py-8">Select an assembly on the left to see booth-wise vote counts.</p>
              )}
              {selectedAssembly && boothError && (
                <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{boothError}</div>
              )}
              {selectedAssembly && (
                <>
                  <p className="text-xs text-gray-500 mb-2">
                    Total booths: {boothLoading ? '…' : boothTotal.toLocaleString()} · Page {Math.floor(boothOffset / BOOTH_PAGE) + 1}
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-gray-200 max-h-[360px] overflow-y-auto">
                    <table className="min-w-full text-sm">
                      <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Assembly</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-700">Booth no.</th>
                          <th className="px-3 py-2 text-right font-semibold text-gray-700 tabular-nums">Votes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {boothLoading && boothRows.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="px-3 py-8 text-center text-gray-500">
                              Loading…
                            </td>
                          </tr>
                        ) : (
                          boothRows.map((row) => (
                            <tr key={`${row.booth}-${row.votes}`} className="border-b border-gray-100 last:border-0">
                              <td className="px-3 py-2 text-gray-800">{selectedAssembly}</td>
                              <td className="px-3 py-2 font-mono text-gray-900">{row.booth}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{row.votes.toLocaleString()}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-3">
                    <button
                      type="button"
                      disabled={boothOffset === 0 || boothLoading}
                      onClick={() => setBoothOffset((o) => Math.max(0, o - BOOTH_PAGE))}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40"
                    >
                      <ChevronLeft className="h-4 w-4" /> Previous
                    </button>
                    <button
                      type="button"
                      disabled={!boothHasMore || boothLoading}
                      onClick={() => setBoothOffset((o) => o + BOOTH_PAGE)}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40"
                    >
                      Next <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
