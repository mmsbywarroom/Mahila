import { useState, useEffect } from 'react';
import { authUrl, authHeadersJson, parseJsonResponse } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { validateIndianMobile10 } from '../lib/validation';
import { isBlockLevelUser } from '../lib/profileHelpers';
import { ArrowLeft, Trash2, Eye, Search, Pencil } from 'lucide-react';
import { VOTER_EDITABLE_KEYS, VOTER_FIELD_LABELS } from './SakhiForm';

interface Submission {
  id: string;
  user_id: string;
  sakhi_name: string;
  sakhi_mobile: string;
  father_name: string;
  husband_name: string;
  state: string;
  district: string;
  assembly: string;
  halka: string;
  village: string;
  booth_number: string;
  status: string;
  created_at: string;
  aadhaar_front_url?: string | null;
  aadhaar_back_url?: string | null;
  voter_id_url?: string | null;
  live_photo_url?: string | null;
  ocr_data?: Array<{ label: string; text: string }> | null;
  user_name?: string;
  user_mobile?: string;
  submitter_wing?: string | null;
  source_name?: string | null;
  documents_collected_consent?: string | null;
  documents_collected_aadhaar?: string | null;
  documents_collected_voter?: string | null;
  /** true = EPIC/roll lookup; false = without EPIC; undefined/null = legacy */
  submitted_with_epic?: boolean | null;
}

interface SubmissionsProps {
  onBack?: () => void;
  embedded?: boolean;
}

interface BoothClusterSakhi {
  name: string;
  epic: string;
  mobile: string;
}

interface BoothCluster {
  cluster_no: number;
  range_start: number;
  range_end: number;
  sakhi_count: number;
  sakhis: BoothClusterSakhi[];
}

interface BoothReport {
  boothid: string;
  total_unique_votes: number;
  clusters: BoothCluster[];
}

const OCR_FIELD_LABELS: Record<string, string> = {
  e_first_name: 'First name',
  e_middle_name: 'Middle / Guardian name',
  guardian_relation: 'Guardian relation',
  sex: 'Sex',
  age: 'Age',
  vcardid: 'EPIC / Voter ID',
  boothid: 'Booth no.',
  part_no: 'Part no.',
  srno: 'Serial no.',
  e_assemblyname: 'Assembly',
  mobile_number: 'Mobile',
  dob: 'Date of birth',
  aadhaar_number: 'Aadhaar',
  full_name: 'Full name',
  house_no: 'House no.',
  familyid: 'Family ID',
};

function labelForOcrKey(key: string): string {
  if (OCR_FIELD_LABELS[key]) return OCR_FIELD_LABELS[key];
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatOcrValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(t);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function parseVoterLookupJson(ocr: Submission['ocr_data']): Record<string, unknown> | null {
  if (!ocr || !Array.isArray(ocr)) return null;
  const item = ocr.find((x) => x.label === 'voter_lookup');
  if (!item?.text) return null;
  try {
    const o = JSON.parse(String(item.text)) as Record<string, unknown>;
    return o !== null && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

function epicFromOcr(ocr: Submission['ocr_data']): string {
  const o = parseVoterLookupJson(ocr);
  if (!o) return '—';
  const v = String(o.vcardid ?? '').trim();
  return v || '—';
}

/** Electoral roll assembly name from OCR (`e_assemblyname`), e.g. Ghanaur */
function assemblyRollFromOcr(ocr: Submission['ocr_data']): string {
  const o = parseVoterLookupJson(ocr);
  if (!o) return '—';
  const v = String(o.e_assemblyname ?? '').trim();
  return v || '—';
}

function boothFromSubmission(row: Submission): string {
  const direct = String(row.booth_number ?? '').trim();
  if (direct) return direct;
  const o = parseVoterLookupJson(row.ocr_data);
  const fromLookup = String(o?.boothid ?? '').trim();
  return fromLookup || '—';
}

function shortSubmittedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function labelEpicMode(submitted_with_epic: boolean | null | undefined): string {
  if (submitted_with_epic === true) return 'With EPIC';
  if (submitted_with_epic === false) return 'Without EPIC';
  return '—';
}

function labelDocumentsConsent(doc: string | null | undefined): string {
  const v = String(doc ?? '').trim().toLowerCase();
  if (v === 'yes') return 'Yes';
  if (v === 'no') return 'No';
  return '—';
}

function labelDocumentsConsentPair(s: Submission): string {
  const a = s.documents_collected_aadhaar;
  const v = s.documents_collected_voter;
  if (
    a != null &&
    String(a).trim() !== '' &&
    v != null &&
    String(v).trim() !== ''
  ) {
    return `Aadhaar: ${labelDocumentsConsent(a)} · Voter: ${labelDocumentsConsent(v)}`;
  }
  return labelDocumentsConsent(s.documents_collected_consent);
}

function labelSourceName(s: Submission): string {
  const v = String(s.source_name ?? '').trim();
  return v || 'SakhiApp';
}

function hasVoterLookupBlob(ocr: Submission['ocr_data']): boolean {
  if (!ocr || !Array.isArray(ocr)) return false;
  return ocr.some(
    (x) =>
      x?.label === 'voter_lookup' && String((x as { text?: string }).text ?? '').trim() !== ''
  );
}

function parseVoterLookupForEdit(ocr: Submission['ocr_data']): Record<string, string> {
  const base: Record<string, string> = Object.fromEntries(VOTER_EDITABLE_KEYS.map((k) => [k, '']));
  if (!ocr || !Array.isArray(ocr)) return base;
  const item = ocr.find((x) => x?.label === 'voter_lookup');
  if (!item?.text) return base;
  try {
    const j = JSON.parse(item.text) as Record<string, unknown>;
    for (const k of VOTER_EDITABLE_KEYS) {
      if (j[k] != null) base[k] = String(j[k]);
    }
  } catch {
    /* keep base */
  }
  return base;
}

function buildOcrAfterVoterEdit(
  prev: Submission['ocr_data'],
  roll: Record<string, string>
): Submission['ocr_data'] {
  const arr = Array.isArray(prev) ? [...prev] : [];
  let obj: Record<string, unknown> = {};
  const idx = arr.findIndex((x: { label?: string }) => x?.label === 'voter_lookup');
  if (idx >= 0) {
    try {
      const t = String((arr[idx] as { text?: string }).text ?? '');
      const p = JSON.parse(t);
      if (p && typeof p === 'object' && !Array.isArray(p)) obj = { ...(p as Record<string, unknown>) };
    } catch {
      obj = {};
    }
  }
  for (const k of VOTER_EDITABLE_KEYS) {
    obj[k] = roll[k] ?? '';
  }
  const item = { label: 'voter_lookup' as const, text: JSON.stringify(obj) };
  if (idx >= 0) arr[idx] = item;
  else arr.push(item);
  return arr;
}

function OcrTextBlock({ text }: { text: string }) {
  const obj = tryParseJsonObject(text);
  if (!obj) {
    return <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{text}</p>;
  }
  const entries = Object.entries(obj);
  if (entries.length === 0) {
    return <p className="text-sm text-gray-500">(empty)</p>;
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
      <dl className="divide-y divide-gray-100">
        {entries.map(([key, value]) => (
          <div
            key={key}
            className="grid grid-cols-1 sm:grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-0.5 px-3 py-2.5 text-sm items-baseline"
          >
            <dt className="font-medium text-gray-500 shrink-0">{labelForOcrKey(key)}</dt>
            <dd className="text-gray-900 break-words">{formatOcrValue(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

interface AssemblyReport {
  assembly: string;
  total_unique_booths: number;
  total_unique_votes: number;
  booths: BoothReport[];
}

export default function Submissions({ onBack, embedded }: SubmissionsProps) {
  const PAGE_SIZE = 50;
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isBlockLevel = isBlockLevelUser(user);
  const hasAssemblyRight = Boolean(user?.preferred_assembly);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [assemblyReports, setAssemblyReports] = useState<AssemblyReport[]>([]);
  const [reportAssembly, setReportAssembly] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [editSubmission, setEditSubmission] = useState<Submission | null>(null);
  const [editForm, setEditForm] = useState({
    sakhi_name: '',
    sakhi_mobile: '',
    father_name: '',
    husband_name: '',
    state: '',
    district: '',
    assembly: '',
    halka: '',
    village: '',
    booth_number: '',
    status: '',
  });
  /** EPIC / roll fields (ocr_data voter_lookup) — only for non-admin edit */
  const [editVoterLookup, setEditVoterLookup] = useState<Record<string, string>>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    loadSubmissions();
  }, [isAdmin, user?.id]);

  const loadSubmissions = async () => {
    setLoading(true);
    setLoadError('');
    try {
      if (isAdmin) {
        const response = await fetch(authUrl('admin-submissions'), {
          method: 'POST',
          headers: authHeadersJson(),
          body: JSON.stringify({
            userId: 'admin',
            password: 'admin@123',
          }),
        });

        const data = await parseJsonResponse(response);
        if (!response.ok || !data.success) {
          setSubmissions([]);
          setLoadError(
            typeof data?.message === 'string' && data.message
              ? data.message
              : `Could not load submissions (HTTP ${response.status}).`
          );
          return;
        }
        setSubmissions(data.submissions || []);
      } else {
        if (!user?.id) {
          setSubmissions([]);
          setLoadError('Not signed in.');
          return;
        }
        const response = await fetch(authUrl('user-submissions'), {
          method: 'POST',
          headers: authHeadersJson(),
          body: JSON.stringify({
            userId: user.id,
          }),
        });

        const data = await parseJsonResponse(response);
        if (!response.ok || !data.success) {
          setSubmissions([]);
          setLoadError(
            typeof data?.message === 'string' && data.message
              ? data.message
              : `Could not load submissions (HTTP ${response.status}).`
          );
          return;
        }
        setSubmissions(data.submissions || []);
      }
    } catch (e) {
      setSubmissions([]);
      setLoadError(
        e instanceof Error ? e.message : 'Network error — check that the API is running and VITE_API_URL is correct.'
      );
    } finally {
      setLoading(false);
    }
  };

  const loadBoothClusters = async (assembly?: string) => {
    if (!isAdmin) return;
    setReportLoading(true);
    setReportError('');
    try {
      const response = await fetch(authUrl('admin-booth-clusters'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({
          userId: 'admin',
          password: 'admin@123',
          assembly: assembly?.trim() || undefined,
        }),
      });
      const data = await parseJsonResponse(response);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to load booth clusters');
      }
      setAssemblyReports(data.assemblies || []);
    } catch (e) {
      setAssemblyReports([]);
      setReportError(e instanceof Error ? e.message : 'Failed to load booth clusters');
    } finally {
      setReportLoading(false);
    }
  };

  const handleSoftDelete = async (id: string) => {
    if (
      !confirm(
        'This entry will be removed from the list (soft delete — record remains in database, only hidden from list). Continue?'
      )
    ) {
      return;
    }
    try {
      const response = await fetch(authUrl('soft-delete-submission'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({
          userId: isAdmin ? 'admin' : user?.id,
          password: isAdmin ? 'admin@123' : undefined,
          submissionId: id,
        }),
      });
      const data = await parseJsonResponse(response);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to remove');
      }
      setSubmissions((prev) => prev.filter((s) => s.id !== id));
      setSelectedSubmission((s) => (s?.id === id ? null : s));
      setEditSubmission((s) => (s?.id === id ? null : s));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to remove');
    }
  };

  const openEdit = (row: Submission) => {
    setEditSubmission(row);
    setEditForm({
      sakhi_name: row.sakhi_name,
      sakhi_mobile: row.sakhi_mobile,
      father_name: row.father_name,
      husband_name: row.husband_name,
      state: row.state,
      district: row.district,
      assembly: row.assembly,
      halka: row.halka,
      village: row.village,
      booth_number: row.booth_number || '',
      status: row.status || 'pending',
    });
    setEditVoterLookup(parseVoterLookupForEdit(row.ocr_data));
    setEditError('');
  };

  const saveEdit = async () => {
    if (!editSubmission || !user) return;
    if (!isAdmin && !user.id) return;

    if (!isAdmin) {
      setEditSaving(true);
      setEditError('');
      try {
        const voter_lookup = Object.fromEntries(
          VOTER_EDITABLE_KEYS.map((k) => [k, editVoterLookup[k] ?? ''])
        );
        const response = await fetch(authUrl('update-submission'), {
          method: 'POST',
          headers: authHeadersJson(),
          body: JSON.stringify({
            userId: user.id,
            submissionId: editSubmission.id,
            voter_lookup,
          }),
        });
        const data = await parseJsonResponse(response);
        if (!response.ok || !data?.success) {
          throw new Error(data?.message || 'Save failed');
        }
        const nextOcr = buildOcrAfterVoterEdit(editSubmission.ocr_data, editVoterLookup);
        setSubmissions((prev) =>
          prev.map((s) => (s.id === editSubmission.id ? { ...s, ocr_data: nextOcr } : s))
        );
        setSelectedSubmission((s) =>
          s?.id === editSubmission.id ? { ...s, ocr_data: nextOcr } : s
        );
        setEditSubmission(null);
      } catch (e) {
        setEditError(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setEditSaving(false);
      }
      return;
    }

    const mobile = editForm.sakhi_mobile.replace(/\D/g, '').slice(0, 10);
    const mobileErr = validateIndianMobile10(mobile);
    if (mobileErr) {
      setEditError(mobileErr);
      return;
    }
    setEditSaving(true);
    setEditError('');
    try {
      const body: Record<string, unknown> = {
        userId: 'admin',
        password: 'admin@123',
        submissionId: editSubmission.id,
        sakhi_name: editForm.sakhi_name,
        sakhi_mobile: mobile,
        father_name: editForm.father_name,
        husband_name: editForm.husband_name,
        state: editForm.state,
        district: editForm.district,
        assembly: editForm.assembly,
        halka: editForm.halka,
        village: editForm.village,
        booth_number: editForm.booth_number,
        status: editForm.status,
      };
      const response = await fetch(authUrl('update-submission'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify(body),
      });
      const data = await parseJsonResponse(response);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Save failed');
      }
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === editSubmission.id
            ? {
                ...s,
                sakhi_name: editForm.sakhi_name,
                sakhi_mobile: mobile,
                father_name: editForm.father_name,
                husband_name: editForm.husband_name,
                state: editForm.state,
                district: editForm.district,
                assembly: editForm.assembly,
                halka: editForm.halka,
                village: editForm.village,
                booth_number: editForm.booth_number,
                status: editForm.status,
              }
            : s
        )
      );
      setSelectedSubmission((s) =>
        s?.id === editSubmission.id
          ? {
              ...s,
              sakhi_name: editForm.sakhi_name,
              sakhi_mobile: mobile,
              father_name: editForm.father_name,
              husband_name: editForm.husband_name,
              state: editForm.state,
              district: editForm.district,
              assembly: editForm.assembly,
              halka: editForm.halka,
              village: editForm.village,
              booth_number: editForm.booth_number,
              status: editForm.status,
            }
          : s
      );
      setEditSubmission(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setEditSaving(false);
    }
  };

  const filteredSubmissions = submissions.filter((s) => {
    const q = searchTerm.toLowerCase();
    const epic = epicFromOcr(s.ocr_data);
    const rollAsm = assemblyRollFromOcr(s.ocr_data);
    return (
      s.sakhi_name.toLowerCase().includes(q) ||
      s.sakhi_mobile.includes(searchTerm) ||
      s.father_name.toLowerCase().includes(q) ||
      s.husband_name.toLowerCase().includes(q) ||
      s.village.toLowerCase().includes(q) ||
      s.state.toLowerCase().includes(q) ||
      s.district.toLowerCase().includes(q) ||
      s.assembly.toLowerCase().includes(q) ||
      s.halka.toLowerCase().includes(q) ||
      boothFromSubmission(s).toLowerCase().includes(q) ||
      epic.toLowerCase().includes(q) ||
      rollAsm.toLowerCase().includes(q) ||
      (isAdmin && (s.user_name || '').toLowerCase().includes(q)) ||
      (isAdmin && (s.user_mobile || '').includes(searchTerm)) ||
      (isAdmin && (s.submitter_wing || '').toLowerCase().includes(q)) ||
      labelSourceName(s).toLowerCase().includes(q) ||
      labelEpicMode(s.submitted_with_epic).toLowerCase().includes(q) ||
      labelDocumentsConsentPair(s).toLowerCase().includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filteredSubmissions.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const pagedSubmissions = filteredSubmissions.slice(
    (safeCurrentPage - 1) * PAGE_SIZE,
    safeCurrentPage * PAGE_SIZE
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, submissions.length]);

  if (loading) {
    return (
      <div
        className={`${
          embedded ? 'min-h-[40vh]' : 'min-h-screen'
        } bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center`}
      >
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-orange-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading submissions...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        embedded ? 'w-full' : 'min-h-screen bg-gradient-to-br from-orange-50 to-amber-50'
      }
    >
      <div className={`${embedded ? 'max-w-full' : 'max-w-6xl'} mx-auto ${embedded ? '' : 'p-4 py-8'}`}>
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center gap-4 mb-8">
            {onBack && (
              <button
                onClick={onBack}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="h-6 w-6 text-gray-600" />
              </button>
            )}
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-gray-900">
                {isAdmin
                  ? 'All Submissions'
                  : isBlockLevel
                    ? 'My Submissions'
                    : hasAssemblyRight
                      ? 'Assembly Submissions'
                      : 'My Submissions'}
              </h1>
              <p className="text-gray-600">Total entries: {submissions.length}</p>
            </div>
          </div>

          {loadError && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <p className="font-medium">Could not load the list</p>
              <p className="mt-1">{loadError}</p>
              <button
                type="button"
                onClick={() => void loadSubmissions()}
                className="mt-3 text-sm font-semibold text-red-900 underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          )}

          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-3.5 h-5 w-5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={
                  isAdmin
                    ? 'Search by sakhi, user, wing, source, mobile, zone, district, ac, EPIC mode, consent, village...'
                    : 'Search by name, mobile, or village...'
                }
                className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          {isAdmin && (
            <div className="mb-8 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
              <div className="flex flex-col lg:flex-row gap-3 lg:items-end lg:justify-between mb-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Assembly → Booth → Cluster Report</h2>
                  <p className="text-xs text-gray-700">
                    Cluster size is fixed at 100 voters. Each cluster shows sakhi count and name/EPIC/mobile.
                  </p>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={reportAssembly}
                    onChange={(e) => setReportAssembly(e.target.value)}
                    placeholder="Filter assembly (optional)"
                    className="px-3 py-2 border border-indigo-200 rounded-lg bg-white text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => loadBoothClusters(reportAssembly)}
                    disabled={reportLoading}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {reportLoading ? 'Loading...' : 'Load'}
                  </button>
                </div>
              </div>
              {reportError && <p className="text-sm text-red-600 mb-2">{reportError}</p>}
              {reportLoading ? (
                <p className="text-sm text-indigo-900">Preparing booth clusters...</p>
              ) : assemblyReports.length === 0 ? (
                <p className="text-sm text-gray-600">No assembly report found.</p>
              ) : (
                <div className="space-y-4 max-h-[45vh] overflow-y-auto pr-1">
                  {assemblyReports.map((assembly) => (
                    <details key={assembly.assembly} className="rounded-lg border border-indigo-200 bg-white">
                      <summary className="cursor-pointer list-none px-4 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-semibold text-gray-900">{assembly.assembly}</span>
                          <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-1 rounded-full">
                            Booths: {assembly.total_unique_booths}
                          </span>
                          <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-1 rounded-full">
                            Unique Voters: {assembly.total_unique_votes}
                          </span>
                        </div>
                      </summary>
                      <div className="px-4 pb-4 space-y-3">
                        {assembly.booths.map((booth) => (
                          <details key={`${assembly.assembly}-${booth.boothid}`} className="rounded border border-gray-200">
                            <summary className="cursor-pointer list-none px-3 py-2 bg-gray-50">
                              <div className="flex flex-wrap items-center gap-2 text-sm">
                                <span className="font-semibold">Booth {booth.boothid}</span>
                                <span className="text-xs bg-gray-200 px-2 py-0.5 rounded">
                                  Unique Votes: {booth.total_unique_votes}
                                </span>
                              </div>
                            </summary>
                            <div className="p-3 space-y-2">
                              {booth.clusters.map((cluster) => (
                                <div key={`${booth.boothid}-${cluster.cluster_no}`} className="rounded border border-gray-200 p-3">
                                  <div className="flex flex-wrap items-center gap-2 text-sm mb-2">
                                    <span className="font-semibold">
                                      Cluster {cluster.cluster_no} ({cluster.range_start}-{cluster.range_end})
                                    </span>
                                    <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
                                      Sakhi added: {cluster.sakhi_count}
                                    </span>
                                  </div>
                                  {cluster.sakhis.length === 0 ? (
                                    <p className="text-xs text-gray-500">No sakhi mapped in this cluster.</p>
                                  ) : (
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="text-left text-gray-500">
                                            <th className="py-1 pr-2">Name</th>
                                            <th className="py-1 pr-2">EPIC</th>
                                            <th className="py-1 pr-2">Mobile</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {cluster.sakhis.map((s, idx) => (
                                            <tr key={`${s.epic}-${idx}`} className="border-t">
                                              <td className="py-1 pr-2">{s.name || '-'}</td>
                                              <td className="py-1 pr-2">{s.epic || '-'}</td>
                                              <td className="py-1 pr-2">{s.mobile || '-'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </details>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          )}

          {!loadError && filteredSubmissions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-600 text-lg">No submissions found</p>
            </div>
          ) : loadError ? null : (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[1120px] text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium text-gray-600 uppercase">Sakhi</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-600 uppercase">Father</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-600 uppercase">Husband</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-600 uppercase">Mobile</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-600 uppercase">Booth</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-600 uppercase">EPIC</th>
                    <th
                      className="px-2 py-2 text-left font-medium text-gray-600 uppercase max-w-[6rem]"
                      title="Assembly name from electoral roll (voter lookup / e_assemblyname)"
                    >
                      Assembly
                    </th>
                    <th
                      className="px-2 py-2 text-left font-medium text-gray-600 uppercase whitespace-nowrap"
                      title="EPIC search / roll match vs without EPIC (voter ID upload)"
                    >
                      EPIC mode
                    </th>
                    <th className="px-2 py-2 text-left font-medium text-gray-600 uppercase whitespace-nowrap">
                      Source
                    </th>
                    <th
                      className="px-2 py-2 text-left font-medium text-gray-600 uppercase whitespace-nowrap"
                      title="Aadhaar card and Voter ID physically collected"
                    >
                      Docs
                    </th>
                    <th className="px-2 py-2 text-left font-medium text-gray-600 uppercase">Status</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-600 uppercase">Submitted</th>
                    {isAdmin && (
                      <th className="px-2 py-2 text-left font-medium text-gray-600 uppercase">By</th>
                    )}
                    <th className="px-2 py-2 text-left font-medium text-gray-600 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {pagedSubmissions.map((submission) => (
                    <tr key={submission.id} className="hover:bg-gray-50 transition-colors align-top">
                      <td className="px-2 py-2 text-gray-900 font-medium max-w-[8rem] break-words">
                        {submission.sakhi_name}
                      </td>
                      <td className="px-2 py-2 text-gray-800 max-w-[6rem] break-words">{submission.father_name}</td>
                      <td className="px-2 py-2 text-gray-800 max-w-[6rem] break-words">{submission.husband_name}</td>
                      <td className="px-2 py-2 text-gray-900 font-mono whitespace-nowrap">{submission.sakhi_mobile}</td>
                      <td className="px-2 py-2 text-gray-800 font-mono">{boothFromSubmission(submission)}</td>
                      <td className="px-2 py-2 text-gray-800 font-mono max-w-[7rem] break-all">
                        {epicFromOcr(submission.ocr_data)}
                      </td>
                      <td className="px-2 py-2 text-gray-800 max-w-[6rem] break-words" title="Roll assembly (e_assemblyname)">
                        {assemblyRollFromOcr(submission.ocr_data)}
                      </td>
                      <td className="px-2 py-2 text-gray-800 whitespace-nowrap">
                        {labelEpicMode(submission.submitted_with_epic)}
                      </td>
                      <td className="px-2 py-2 text-gray-800 whitespace-nowrap">
                        {labelSourceName(submission)}
                      </td>
                      <td className="px-2 py-2 text-gray-800 whitespace-nowrap">
                        {labelDocumentsConsentPair(submission)}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-800 font-semibold">
                          {submission.status}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-gray-600 whitespace-nowrap">{shortSubmittedAt(submission.created_at)}</td>
                      {isAdmin && (
                        <td className="px-2 py-2 text-gray-800 max-w-[8rem] break-words">
                          <div>{submission.user_name || '—'}</div>
                          <div className="text-xs text-gray-500">{submission.user_mobile || ''}</div>
                          {submission.submitter_wing ? (
                            <div className="text-xs text-indigo-800 mt-0.5 font-medium">
                              Wing: {submission.submitter_wing}
                            </div>
                          ) : null}
                        </td>
                      )}
                      <td className="px-2 py-2 whitespace-nowrap">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            title="View"
                            onClick={() => setSelectedSubmission(submission)}
                            className="text-blue-600 hover:text-blue-900 p-1.5 hover:bg-blue-50 rounded"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <>
                            {(isAdmin || hasVoterLookupBlob(submission.ocr_data)) && (
                              <button
                                type="button"
                                title={
                                  isAdmin
                                    ? 'Edit submission'
                                    : 'Edit EPIC / voter roll fields only'
                                }
                                onClick={() => openEdit(submission)}
                                className="text-amber-700 hover:text-amber-900 p-1.5 hover:bg-amber-50 rounded"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            )}
                            {isAdmin && (
                              <button
                                type="button"
                                title="Remove from list (soft)"
                                onClick={() => void handleSoftDelete(submission.id)}
                                className="text-red-600 hover:text-red-900 p-1.5 hover:bg-red-50 rounded"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loadError && filteredSubmissions.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="text-gray-600">
                Showing {(safeCurrentPage - 1) * PAGE_SIZE + 1}-
                {Math.min(safeCurrentPage * PAGE_SIZE, filteredSubmissions.length)} of{' '}
                {filteredSubmissions.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded border border-gray-300 bg-white text-gray-700 disabled:opacity-50"
                >
                  Prev
                </button>
                <span className="text-gray-700">
                  Page {safeCurrentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-3 py-1.5 rounded border border-gray-300 bg-white text-gray-700 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedSubmission && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Submission Details</h2>
              <button
                onClick={() => setSelectedSubmission(null)}
                className="text-gray-600 hover:text-gray-900 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Sakhi Name</label>
                  <p className="mt-1 text-gray-900">{selectedSubmission.sakhi_name}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Mobile</label>
                  <p className="mt-1 text-gray-900">{selectedSubmission.sakhi_mobile}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Father Name</label>
                  <p className="mt-1 text-gray-900">{selectedSubmission.father_name}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Husband Name</label>
                  <p className="mt-1 text-gray-900">{selectedSubmission.husband_name}</p>
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Location Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Zone</label>
                    <p className="mt-1 text-gray-900">{selectedSubmission.state}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">District</label>
                    <p className="mt-1 text-gray-900">{selectedSubmission.district}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">AC</label>
                    <p className="mt-1 text-gray-900">{selectedSubmission.assembly}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Block</label>
                    <p className="mt-1 text-gray-900">{selectedSubmission.halka}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Village</label>
                    <p className="mt-1 text-gray-900">{selectedSubmission.village}</p>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                {isAdmin && (
                  <div className="mb-3">
                    <label className="block text-sm font-medium text-gray-700">Submitted By</label>
                    <p className="mt-1 text-gray-900">
                      {selectedSubmission.user_name || '-'} ({selectedSubmission.user_mobile || '-'})
                    </p>
                    {selectedSubmission.submitter_wing ? (
                      <p className="mt-1 text-sm text-indigo-900">
                        <span className="font-medium">Wing:</span> {selectedSubmission.submitter_wing}
                      </p>
                    ) : null}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">EPIC mode</label>
                    <p className="mt-1 text-gray-900">{labelEpicMode(selectedSubmission.submitted_with_epic)}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Source</label>
                    <p className="mt-1 text-gray-900">{labelSourceName(selectedSubmission)}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700">Physical document collection</label>
                    <p className="mt-1 text-gray-900 text-sm leading-snug">
                      {labelDocumentsConsentPair(selectedSubmission)}
                    </p>
                  </div>
                </div>
                <label className="block text-sm font-medium text-gray-700">Status</label>
                <p className="mt-1">
                  <span className="px-3 py-1 inline-flex text-sm font-semibold rounded-full bg-green-100 text-green-800">
                    {selectedSubmission.status}
                  </span>
                </p>
              </div>

              <div className="border-t pt-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Attachments</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {selectedSubmission.aadhaar_front_url && (
                    <a
                      href={selectedSubmission.aadhaar_front_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:text-blue-800 underline"
                    >
                      Aadhaar Front
                    </a>
                  )}
                  {selectedSubmission.aadhaar_back_url && (
                    <a
                      href={selectedSubmission.aadhaar_back_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:text-blue-800 underline"
                    >
                      Aadhaar Back
                    </a>
                  )}
                  {selectedSubmission.voter_id_url && (
                    <a
                      href={selectedSubmission.voter_id_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:text-blue-800 underline"
                    >
                      Voter ID
                    </a>
                  )}
                  {selectedSubmission.live_photo_url && (
                    <a
                      href={selectedSubmission.live_photo_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:text-blue-800 underline"
                    >
                      Live Photo
                    </a>
                  )}
                  {!selectedSubmission.aadhaar_front_url &&
                    !selectedSubmission.aadhaar_back_url &&
                    !selectedSubmission.voter_id_url &&
                    !selectedSubmission.live_photo_url && (
                      <p className="text-sm text-gray-500">No attachments</p>
                    )}
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">OCR Details</h3>
                {selectedSubmission.ocr_data && selectedSubmission.ocr_data.length > 0 ? (
                  <div className="space-y-3">
                    {selectedSubmission.ocr_data.map((item, idx) => (
                      <div key={`${item.label}-${idx}`} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">{item.label}</p>
                        <OcrTextBlock text={item.text} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No OCR details</p>
                )}
              </div>

              <div className="border-t pt-4">
                <label className="block text-sm font-medium text-gray-700">Submitted On</label>
                <p className="mt-1 text-gray-900">
                  {new Date(selectedSubmission.created_at).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {editSubmission && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
          <div
            className={`bg-white rounded-2xl shadow-xl w-full max-h-[90vh] overflow-y-auto p-6 ${
              isAdmin ? 'max-w-lg' : 'max-w-2xl'
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">
                {isAdmin ? 'Edit submission' : 'Edit voter / EPIC (roll) details'}
              </h2>
              <button
                type="button"
                onClick={() => setEditSubmission(null)}
                className="text-gray-600 hover:text-gray-900 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            {editError && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{editError}</div>
            )}
            {!isAdmin && (
              <>
                <p className="text-sm text-gray-600 mb-3">
                  Sirf wahi fields badal sakte hain jo EPIC / roll lookup se aate hain. Sakhi naam, mobile, gaon wagairah
                  yahan edit nahi honge.
                </p>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 mb-4 space-y-1">
                  <p>
                    <span className="font-medium text-gray-600">Sakhi:</span> {editSubmission.sakhi_name}
                  </p>
                  <p>
                    <span className="font-medium text-gray-600">Mobile:</span> {editSubmission.sakhi_mobile}
                  </p>
                  <p>
                    <span className="font-medium text-gray-600">Village:</span> {editSubmission.village}
                  </p>
                </div>
              </>
            )}
            {isAdmin ? (
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-gray-600 text-xs">Sakhi name</span>
                <input
                  value={editForm.sakhi_name}
                  onChange={(e) => setEditForm((f) => ({ ...f, sakhi_name: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </label>
              <label className="block">
                <span className="text-gray-600 text-xs">Mobile (10 digit)</span>
                <input
                  value={editForm.sakhi_mobile}
                  onChange={(e) => setEditForm((f) => ({ ...f, sakhi_mobile: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg font-mono"
                  maxLength={10}
                />
              </label>
              <label className="block">
                <span className="text-gray-600 text-xs">Father name</span>
                <input
                  value={editForm.father_name}
                  onChange={(e) => setEditForm((f) => ({ ...f, father_name: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </label>
              <label className="block">
                <span className="text-gray-600 text-xs">Husband name</span>
                <input
                  value={editForm.husband_name}
                  onChange={(e) => setEditForm((f) => ({ ...f, husband_name: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </label>
              <label className="block">
                <span className="text-gray-600 text-xs">Zone</span>
                <input
                  value={editForm.state}
                  onChange={(e) => setEditForm((f) => ({ ...f, state: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </label>
              <label className="block">
                <span className="text-gray-600 text-xs">District</span>
                <input
                  value={editForm.district}
                  onChange={(e) => setEditForm((f) => ({ ...f, district: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </label>
              <label className="block">
                <span className="text-gray-600 text-xs">AC</span>
                <input
                  value={editForm.assembly}
                  onChange={(e) => setEditForm((f) => ({ ...f, assembly: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </label>
              <label className="block">
                <span className="text-gray-600 text-xs">Block</span>
                <input
                  value={editForm.halka}
                  onChange={(e) => setEditForm((f) => ({ ...f, halka: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </label>
              <label className="block">
                <span className="text-gray-600 text-xs">Village</span>
                <input
                  value={editForm.village}
                  onChange={(e) => setEditForm((f) => ({ ...f, village: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </label>
              <label className="block">
                <span className="text-gray-600 text-xs">Booth</span>
                <input
                  value={editForm.booth_number}
                  onChange={(e) => setEditForm((f) => ({ ...f, booth_number: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </label>
              <label className="block">
                <span className="text-gray-600 text-xs">Status</span>
                <input
                  value={editForm.status}
                  onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </label>
            </div>
            ) : (
            <div className="space-y-3 text-sm">
              {VOTER_EDITABLE_KEYS.map((key) => (
                <label key={key} className="block">
                  <span className="text-gray-600 text-xs">{VOTER_FIELD_LABELS[key] ?? key}</span>
                  <input
                    value={editVoterLookup[key] ?? ''}
                    onChange={(e) =>
                      setEditVoterLookup((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </label>
              ))}
            </div>
            )}
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setEditSubmission(null)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={editSaving}
                onClick={() => void saveEdit()}
                className="px-4 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700 disabled:opacity-50"
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
