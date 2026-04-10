import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authUrl, authHeadersJson, parseJsonResponse } from '../lib/api';
import { ArrowLeft, Download, FileDown, Pencil, Search, Upload, UserPlus, X } from 'lucide-react';
import { SearchableMultiSelect } from './SearchableMultiSelect';

interface AdminInchargeManagementProps {
  onBack?: () => void;
  embedded?: boolean;
}

type InchargeRow = {
  id: string;
  name: string;
  mobile: string;
  preferred_assembly: string | null;
  profile_data: Record<string, unknown> | null;
};

/** API should return unique users; if duplicates slip in, React list keys break — keep first per id. */
function dedupeInchargesById(rows: InchargeRow[]): InchargeRow[] {
  const map = new Map<string, InchargeRow>();
  for (const row of rows) {
    const id = String(row?.id ?? '').trim();
    if (!id) continue;
    if (!map.has(id)) map.set(id, row);
  }
  return [...map.values()];
}

function parseCsvLine(line: string) {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s/_-]+/g, '');
}

function pickHeaderIndex(headers: string[], aliases: string[]): number {
  const aliasSet = new Set(aliases.map((a) => normalizeHeader(a)));
  return headers.findIndex((h) => aliasSet.has(h));
}

/** Split stored profile values that may use comma / semicolon / pipe */
function parseMultiField(val: unknown): string[] {
  const s = String(val ?? '').trim();
  if (!s) return [];
  return [...new Set(s.split(/[,;|]/).map((x) => x.trim()).filter(Boolean))];
}

function mergeUnique(lists: string[][]): string[] {
  const s = new Set<string>();
  lists.forEach((arr) => arr.forEach((x) => s.add(x)));
  return [...s].sort((a, b) => a.localeCompare(b));
}

/** Matches typical Excel export columns; Designation dropdown merges with values seen in DB */
const DEFAULT_DESIGNATIONS = [
  'Zone Incharge',
  'District Incharge',
  'Halka Coordinator',
  'Block Coordinator',
];

const DEFAULT_WINGS = ['Youth', 'Women', 'General'];

const INCHARGE_PAGE_SIZE = 100;

/** Column order for downloadable template (UTF-8). Required: Name, Contact Number, AC Name; rest optional profile fields. */
const INCHARGE_CSV_TEMPLATE_HEADERS = [
  'Name',
  'Contact Number',
  'AC Name',
  'Wing Name',
  'Zone',
  'District',
  'Designation',
  'Halka/Block',
  'Village/Ward Name',
  'Sr No',
  'Unique',
] as const;

function downloadInchargeCsvTemplate() {
  const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const headerLine = INCHARGE_CSV_TEMPLATE_HEADERS.map(escapeCsv).join(',');
  const emptyRow = INCHARGE_CSV_TEMPLATE_HEADERS.map(() => '""').join(',');
  const BOM = '\uFEFF';
  const csv = `${BOM}${headerLine}\n${emptyRow}\n`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'incharge-upload-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

type InchargeFormState = {
  srNo: string;
  unique: string;
  zones: string[];
  districts: string[];
  wing: string;
  designation: string;
  name: string;
  mobile: string;
  halkas: string[];
  villages: string[];
  acNames: string[];
};

const emptyAddForm = (): InchargeFormState => ({
  srNo: '',
  unique: '',
  zones: [],
  districts: [],
  wing: '',
  designation: '',
  name: '',
  mobile: '',
  halkas: [],
  villages: [],
  acNames: [],
});

export default function AdminInchargeManagement({ onBack, embedded }: AdminInchargeManagementProps) {
  const [csvUploading, setCsvUploading] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [addForm, setAddForm] = useState<InchargeFormState>(() => emptyAddForm());
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [incharges, setIncharges] = useState<InchargeRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listSearch, setListSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [listPage, setListPage] = useState(0);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [totalMatching, setTotalMatching] = useState(0);
  const [designationStats, setDesignationStats] = useState<Record<string, number>>({});
  const [exporting, setExporting] = useState(false);
  const [designationFilter, setDesignationFilter] = useState('All Designations');
  const [facets, setFacets] = useState<{
    zones: string[];
    districts: string[];
    assemblies: string[];
    halkas: string[];
    villages: string[];
  }>({ zones: [], districts: [], assemblies: [], halkas: [], villages: [] });

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(listSearch.trim()), 350);
    return () => window.clearTimeout(id);
  }, [listSearch]);

  const debouncedSearchSeen = useRef<string | null>(null);
  useEffect(() => {
    if (debouncedSearchSeen.current === null) {
      debouncedSearchSeen.current = debouncedSearch;
      return;
    }
    if (debouncedSearchSeen.current !== debouncedSearch) {
      debouncedSearchSeen.current = debouncedSearch;
      setListPage(0);
    }
  }, [debouncedSearch]);

  const fetchInchargePage = useCallback(async () => {
    setListLoading(true);
    setError('');
    try {
      const designation =
        designationFilter !== 'All Designations' ? designationFilter : undefined;
      const response = await fetch(authUrl('admin-list-incharges'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({
          userId: 'admin',
          password: 'admin@123',
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(designation ? { designation } : {}),
          limit: INCHARGE_PAGE_SIZE,
          offset: listPage * INCHARGE_PAGE_SIZE,
        }),
      });
      const data = await parseJsonResponse(response);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to load incharges');
      }
      const raw = Array.isArray(data.incharges) ? (data.incharges as InchargeRow[]) : [];
      setIncharges(dedupeInchargesById(raw));
      setTotalMatching(Number(data.total) >= 0 ? Number(data.total) : raw.length);
      if (data.designationStats && typeof data.designationStats === 'object') {
        setDesignationStats(data.designationStats as Record<string, number>);
      } else {
        setDesignationStats({});
      }
    } catch (err) {
      setIncharges([]);
      setTotalMatching(0);
      setDesignationStats({});
      setError(err instanceof Error ? err.message : 'Failed to load incharges');
    } finally {
      setListLoading(false);
    }
  }, [debouncedSearch, designationFilter, listPage]);

  useEffect(() => {
    void fetchInchargePage();
  }, [fetchInchargePage, listRefreshKey]);

  useEffect(() => {
    if (totalMatching === 0) {
      if (listPage !== 0) setListPage(0);
      return;
    }
    const maxPage = Math.max(0, Math.ceil(totalMatching / INCHARGE_PAGE_SIZE) - 1);
    if (listPage > maxPage) setListPage(maxPage);
  }, [totalMatching, listPage]);

  useEffect(() => {
    if (!addModalOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(authUrl('admin-incharge-facets'), {
          method: 'POST',
          headers: authHeadersJson(),
          body: JSON.stringify({ userId: 'admin', password: 'admin@123' }),
        });
        const data = await parseJsonResponse(response);
        if (cancelled || !data?.success) return;
        setFacets({
          zones: Array.isArray(data.zones) ? data.zones : [],
          districts: Array.isArray(data.districts) ? data.districts : [],
          assemblies: Array.isArray(data.assemblies) ? data.assemblies : [],
          halkas: Array.isArray(data.halkas) ? data.halkas : [],
          villages: Array.isArray(data.villages) ? data.villages : [],
        });
      } catch {
        /* locations table may be empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addModalOpen]);

  const profileFieldSamples = useMemo(() => {
    const zones: string[] = [];
    const districts: string[] = [];
    const assemblies: string[] = [];
    const halkas: string[] = [];
    const villages: string[] = [];
    const wings: string[] = [];
    incharges.forEach((row) => {
      const pd = (row.profile_data ?? {}) as Record<string, unknown>;
      zones.push(...parseMultiField(pd.Zone ?? pd.zone));
      districts.push(...parseMultiField(pd.District ?? pd.district));
      assemblies.push(...parseMultiField(row.preferred_assembly ?? pd['AC Name']));
      halkas.push(...parseMultiField(pd.Halka ?? pd.halka ?? pd.Block ?? pd.block));
      villages.push(...parseMultiField(pd['Village/Ward Name'] ?? pd.Village ?? pd.village));
      const wing = String(pd['Wing Name'] ?? pd.Wing ?? pd.wing ?? '').trim();
      if (wing) wings.push(wing);
    });
    return { zones, districts, assemblies, halkas, villages, wings };
  }, [incharges]);

  const zoneOptions = useMemo(
    () => mergeUnique([facets.zones, profileFieldSamples.zones]),
    [facets.zones, profileFieldSamples.zones]
  );
  const districtOptions = useMemo(
    () => mergeUnique([facets.districts, profileFieldSamples.districts]),
    [facets.districts, profileFieldSamples.districts]
  );
  const assemblyOptions = useMemo(
    () => mergeUnique([facets.assemblies, profileFieldSamples.assemblies]),
    [facets.assemblies, profileFieldSamples.assemblies]
  );
  const halkaOptions = useMemo(
    () => mergeUnique([facets.halkas, profileFieldSamples.halkas]),
    [facets.halkas, profileFieldSamples.halkas]
  );
  const villageOptions = useMemo(
    () => mergeUnique([facets.villages, profileFieldSamples.villages]),
    [facets.villages, profileFieldSamples.villages]
  );
  const wingOptions = useMemo(
    () => mergeUnique([DEFAULT_WINGS, profileFieldSamples.wings]),
    [profileFieldSamples.wings]
  );

  const designationOptions = useMemo(() => {
    const fromStats = Object.keys(designationStats).filter(Boolean);
    const rest = [...new Set([...DEFAULT_DESIGNATIONS, ...fromStats])].sort((a, b) =>
      a.localeCompare(b)
    );
    return ['All Designations', ...rest];
  }, [designationStats]);

  const designationChoicesForForm = useMemo(() => {
    const set = new Set<string>(DEFAULT_DESIGNATIONS);
    Object.keys(designationStats).forEach((d) => set.add(d));
    incharges.forEach((row) => {
      const profile = (row.profile_data ?? {}) as Record<string, unknown>;
      const d = profile.Designation ?? profile.designation;
      if (d) set.add(String(d).trim());
    });
    return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [designationStats, incharges]);

  const zoneOptionsForForm = useMemo(
    () => mergeUnique([zoneOptions, addForm.zones]),
    [zoneOptions, addForm.zones]
  );
  const districtOptionsForForm = useMemo(
    () => mergeUnique([districtOptions, addForm.districts]),
    [districtOptions, addForm.districts]
  );
  const assemblyOptionsForForm = useMemo(
    () => mergeUnique([assemblyOptions, addForm.acNames]),
    [assemblyOptions, addForm.acNames]
  );
  const halkaOptionsForForm = useMemo(
    () => mergeUnique([halkaOptions, addForm.halkas]),
    [halkaOptions, addForm.halkas]
  );
  const villageOptionsForForm = useMemo(
    () => mergeUnique([villageOptions, addForm.villages]),
    [villageOptions, addForm.villages]
  );
  const wingOptionsForForm = useMemo(
    () => mergeUnique([wingOptions, addForm.wing ? [addForm.wing] : []]),
    [wingOptions, addForm.wing]
  );
  const designationOptionsForFormField = useMemo(
    () => mergeUnique([designationChoicesForForm, addForm.designation ? [addForm.designation] : []]),
    [designationChoicesForForm, addForm.designation]
  );

  const topDesignationCards = useMemo(
    () =>
      Object.entries(designationStats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3),
    [designationStats]
  );

  const handleCsvUpload = async (file: File | null) => {
    if (!file) return;

    setError('');
    setMessage('Uploading… this may take a few seconds for large files.');
    setCsvUploading(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) throw new Error('CSV is empty');

      const rawHeaders = parseCsvLine(lines[0]).map((h) => h.trim());
      const headers = rawHeaders.map(normalizeHeader);
      const nameIdx = pickHeaderIndex(headers, ['name', 'full name', 'username']);
      const mobileIdx = pickHeaderIndex(headers, [
        'contact number',
        'contact',
        'mobile',
        'mobile number',
        'phone',
        'phone number',
      ]);
      const assemblyIdx = pickHeaderIndex(headers, [
        'ac name',
        'assembly',
        'assembly name',
        'ac',
        'constituency',
      ]);

      const totalDataRows = Math.max(0, lines.length - 1);
      const users = lines.slice(1).map((line) => {
        const cols = parseCsvLine(line);
        const profile_data: Record<string, string> = {};
        rawHeaders.forEach((header, i) => {
          if (!header) return;
          profile_data[header] = (cols[i] ?? '').trim();
        });
        return {
          // Missing columns are treated as blank; backend receives only valid rows.
          name: nameIdx >= 0 ? (cols[nameIdx] || '').trim() : '',
          mobile: mobileIdx >= 0 ? (cols[mobileIdx] || '').replace(/\D/g, '').slice(0, 10) : '',
          preferred_assembly: assemblyIdx >= 0 ? (cols[assemblyIdx] || '').trim() : '',
          profile_data,
        };
      }).filter((u) => u.name && u.mobile.length === 10 && u.preferred_assembly);

      if (users.length === 0) {
        throw new Error(
          'No valid users found. Ensure each row has Name, 10-digit Contact Number, and AC Name. Download the CSV template for the correct column names.'
        );
      }

      // Contact Number is the unique key: keep only one row per mobile (last row wins).
      const uniqueByMobile = new Map<string, (typeof users)[number]>();
      for (const u of users) uniqueByMobile.set(u.mobile, u);
      const dedupedUsers = [...uniqueByMobile.values()];

      const response = await fetch(authUrl('admin-upload-users'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({
          userId: 'admin',
          password: 'admin@123',
          users: dedupedUsers,
        }),
      });

      const data = await parseJsonResponse(response);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Bulk upload failed');
      }

      const created = Number(data.created ?? 0);
      const updated = Number(data.updated ?? 0);
      const sent = dedupedUsers.length;
      const skipped = Math.max(0, totalDataRows - sent);
      const duplicateMobileSkipped = Math.max(0, users.length - dedupedUsers.length);
      const unchanged = Math.max(0, sent - created - updated);
      setMessage(
        `Upload completed. CSV rows: ${totalDataRows}, Valid: ${users.length}, Sent unique (by contact number): ${sent}, Created: ${created}, Updated: ${updated}, Unchanged: ${unchanged}, Skipped invalid: ${skipped}, Skipped duplicate contact numbers: ${duplicateMobileSkipped}.`
      );
      setListPage(0);
      setListRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV upload failed');
    } finally {
      setCsvUploading(false);
    }
  };

  const handleExportVisible = async () => {
    if (totalMatching === 0) return;
    setExporting(true);
    setError('');
    try {
      const designation =
        designationFilter !== 'All Designations' ? designationFilter : undefined;
      const batch = 1000;
      const all: InchargeRow[] = [];
      let offset = 0;
      let total = Infinity;
      while (offset < total && all.length < 100000) {
        const response = await fetch(authUrl('admin-list-incharges'), {
          method: 'POST',
          headers: authHeadersJson(),
          body: JSON.stringify({
            userId: 'admin',
            password: 'admin@123',
            ...(debouncedSearch ? { search: debouncedSearch } : {}),
            ...(designation ? { designation } : {}),
            limit: batch,
            offset,
          }),
        });
        const data = await parseJsonResponse(response);
        if (!response.ok || !data?.success) {
          throw new Error(data?.message || 'Export failed');
        }
        const chunk = Array.isArray(data.incharges) ? (data.incharges as InchargeRow[]) : [];
        total = Number(data.total) >= 0 ? Number(data.total) : chunk.length;
        all.push(...dedupeInchargesById(chunk));
        if (chunk.length < batch) break;
        offset += batch;
      }
      if (all.length === 0) return;
      const headerSet = new Set<string>(['Name', 'Contact Number', 'AC Name', 'Wing Name']);
      all.forEach((row) => {
        Object.keys((row.profile_data ?? {}) as Record<string, unknown>).forEach((k) => headerSet.add(k));
      });
      const headers = Array.from(headerSet);
      const escapeCsv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const rows = all.map((row) => {
        const profile = (row.profile_data ?? {}) as Record<string, unknown>;
        return headers.map((h) => {
          if (h === 'Name') return escapeCsv(row.name);
          if (h === 'Contact Number') return escapeCsv(row.mobile);
          if (h === 'AC Name') return escapeCsv(row.preferred_assembly ?? '');
          if (h === 'Wing Name') return escapeCsv(profile['Wing Name'] ?? profile.Wing ?? '');
          return escapeCsv(profile[h]);
        }).join(',');
      });
      const csv = [headers.map(escapeCsv).join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `incharges-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const closeAddModal = () => {
    setAddModalOpen(false);
    setEditMode(false);
    setEditUserId(null);
    setAddForm(emptyAddForm());
  };

  const openEditIncharge = (row: InchargeRow) => {
    setError('');
    const pd = (row.profile_data ?? {}) as Record<string, unknown>;
    const blockVal = parseMultiField(pd.Halka ?? pd.halka ?? pd.Block ?? pd.block);
    setAddForm({
      srNo: String(pd['Sr No'] ?? pd.srno ?? '').trim(),
      unique: String(pd.Unique ?? pd.unique ?? '').trim(),
      zones: parseMultiField(pd.Zone ?? pd.zone),
      districts: parseMultiField(pd.District ?? pd.district),
      wing: String(pd['Wing Name'] ?? pd.Wing ?? pd.wing ?? '').trim(),
      designation: String(pd.Designation ?? pd.designation ?? '').trim(),
      name: row.name,
      mobile: row.mobile,
      halkas: blockVal.length ? blockVal : parseMultiField(pd.Block),
      villages: parseMultiField(pd['Village/Ward Name'] ?? pd.Village ?? pd.village),
      acNames: parseMultiField(row.preferred_assembly ?? pd['AC Name']),
    });
    setEditMode(true);
    setEditUserId(row.id);
    setAddModalOpen(true);
  };

  const handleAddIncharge = async () => {
    setError('');
    setMessage('');
    const name = addForm.name.trim();
    const mobile = addForm.mobile.replace(/\D/g, '').slice(0, 10);
    const primaryAc = addForm.acNames[0]?.trim() ?? '';
    if (!name || mobile.length !== 10) {
      setError('Name and 10-digit Contact Number are required.');
      return;
    }
    if (!primaryAc) {
      setError('Select at least one AC Name.');
      return;
    }
    if (!addForm.designation.trim()) {
      setError('Please select Designation.');
      return;
    }

    const zoneStr = addForm.zones.join(', ');
    const districtStr = addForm.districts.join(', ');
    const acJoined = addForm.acNames.join(', ');
    const halkaStr = addForm.halkas.join(', ');
    const villageStr = addForm.villages.join(', ');

    const profile_data: Record<string, string> = {
      'Sr No': addForm.srNo.trim(),
      Unique: addForm.unique.trim(),
      Zone: zoneStr,
      District: districtStr,
      'AC Name': acJoined,
      'Wing Name': addForm.wing.trim(),
      Wing: addForm.wing.trim(),
      Designation: addForm.designation.trim(),
      Name: name,
      'Contact Number': mobile,
      Block: halkaStr,
      'Village/Ward Name': villageStr,
      Halka: halkaStr,
    };

    setAddSaving(true);
    try {
      const response = await fetch(authUrl('admin-create-user'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({
          userId: 'admin',
          password: 'admin@123',
          ...(editMode && editUserId ? { targetUserId: editUserId } : {}),
          name,
          mobile,
          preferred_assembly: primaryAc,
          profile_data,
        }),
      });
      const data = await parseJsonResponse(response);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to save incharge');
      }
      setMessage(
        editMode
          ? 'Incharge updated.'
          : 'Incharge saved. Login: mobile OTP · Access: primary AC Name.'
      );
      closeAddModal();
      setListRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setAddSaving(false);
    }
  };

  return (
    <div className={embedded ? 'w-full' : 'min-h-screen bg-gradient-to-br from-orange-50 to-amber-50'}>
      <div className={`${embedded ? 'max-w-[min(100%,80rem)]' : 'max-w-6xl'} mx-auto ${embedded ? '' : 'p-4 py-8'}`}>
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center gap-4 mb-8">
            {onBack && (
              <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <ArrowLeft className="h-6 w-6 text-gray-600" />
              </button>
            )}
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Incharge Management</h1>
              <p className="text-gray-600">Upload incharge sheet and auto-create/update user logins</p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800 mb-2">
                <span className="font-semibold">Required columns:</span> <code className="bg-blue-100 px-1 rounded text-xs">Name</code>,{' '}
                <code className="bg-blue-100 px-1 rounded text-xs">Contact Number</code>,{' '}
                <code className="bg-blue-100 px-1 rounded text-xs">AC Name</code> (first assembly = login scope).{' '}
                <span className="font-semibold">Optional:</span> Wing Name, Zone, District, Designation, Halka/Block, Village/Ward Name, Sr No, Unique — saved in profile as-is.
              </p>
              <p className="text-xs text-blue-700 mb-3">
                Use commas; wrap fields in double quotes if they contain commas. One row per person; duplicate contact numbers keep the last row.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={downloadInchargeCsvTemplate}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-blue-300 rounded-lg text-sm hover:bg-blue-100"
                >
                  <FileDown className="h-4 w-4" />
                  Download CSV template
                </button>
                <label className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-blue-300 rounded-lg text-sm cursor-pointer hover:bg-blue-100">
                  <Upload className="h-4 w-4" />
                  {csvUploading ? 'Uploading...' : 'Upload Incharge CSV'}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => handleCsvUpload(e.target.files?.[0] || null)}
                    disabled={csvUploading}
                    className="hidden"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setEditMode(false);
                    setAddForm(emptyAddForm());
                    setAddModalOpen(true);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                >
                  <UserPlus className="h-4 w-4" />
                  Add Incharge
                </button>
              </div>
            </div>

            <div className="border border-gray-200 rounded-xl p-4 bg-gray-50/80">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Incharges ({totalMatching})</h2>
                <div className="relative flex-1 max-w-md min-w-[220px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={listSearch}
                    onChange={(e) => setListSearch(e.target.value)}
                    placeholder="Search by name, phone, zone, district, wing, AC Name..."
                    className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                  />
                </div>
                <select
                  value={designationFilter}
                  onChange={(e) => {
                    setDesignationFilter(e.target.value);
                    setListPage(0);
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                >
                  {designationOptions.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleExportVisible()}
                  disabled={exporting || listLoading || totalMatching === 0}
                  className="px-4 py-2 bg-white border border-gray-300 text-sm rounded-lg hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  {exporting ? 'Exporting…' : 'Export'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setEditMode(false);
                    setAddForm(emptyAddForm());
                    setAddModalOpen(true);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 flex items-center gap-2"
                >
                  <UserPlus className="h-4 w-4" />
                  Add Incharge
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="rounded-lg bg-white border border-gray-200 p-3 text-center">
                  <div className="text-2xl font-bold text-gray-900">{totalMatching}</div>
                  <div className="text-xs text-gray-500">Total Incharges</div>
                </div>
                {topDesignationCards.map(([designation, count], i) => (
                  <div
                    key={`${designation || 'unknown'}:${i}`}
                    className="rounded-lg bg-white border border-gray-200 p-3 text-center"
                  >
                    <div className="text-2xl font-bold text-gray-900">{count}</div>
                    <div className="text-xs text-gray-500 truncate">{designation}</div>
                  </div>
                ))}
              </div>

              {listLoading ? (
                <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
              ) : incharges.length === 0 ? (
                <p className="text-sm text-gray-500 py-6 text-center">No incharges found.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-700">
                      <tr>
                        <th className="px-3 py-2 text-left">Sr</th>
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="px-3 py-2 text-left">Phone</th>
                        <th className="px-3 py-2 text-left">Designation</th>
                        <th className="px-3 py-2 text-left">Wing Name</th>
                        <th className="px-3 py-2 text-left">Zone</th>
                        <th className="px-3 py-2 text-left">District</th>
                        <th className="px-3 py-2 text-left">Halka/Block</th>
                        <th className="px-3 py-2 text-left">AC Name</th>
                        <th className="px-3 py-2 text-right w-16">Edit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incharges.map((row, index) => {
                        const pd = (row.profile_data ?? {}) as Record<string, unknown>;
                        const displaySr =
                          pd['Sr No'] ?? pd.srno ?? listPage * INCHARGE_PAGE_SIZE + index + 1;
                        return (
                          <tr key={row.id} className="border-t border-gray-100">
                            <td className="px-3 py-2">{String(displaySr)}</td>
                            <td className="px-3 py-2 font-medium text-gray-900">{row.name}</td>
                            <td className="px-3 py-2">{row.mobile}</td>
                            <td className="px-3 py-2">{String(pd.Designation ?? pd.designation ?? '-')}</td>
                            <td className="px-3 py-2">{String(pd['Wing Name'] ?? pd.Wing ?? pd.wing ?? '-')}</td>
                            <td className="px-3 py-2">{String(pd.Zone ?? pd.zone ?? '-')}</td>
                            <td className="px-3 py-2">{String(pd.District ?? pd.district ?? '-')}</td>
                            <td className="px-3 py-2">{String(pd.Halka ?? pd.halka ?? pd.Block ?? pd.block ?? '-')}</td>
                            <td className="px-3 py-2 max-w-[14rem] truncate" title={parseMultiField(row.preferred_assembly ?? pd['AC Name']).join(', ') || undefined}>
                              {parseMultiField(row.preferred_assembly ?? pd['AC Name']).join(', ') || '-'}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => openEditIncharge(row)}
                                className="inline-flex items-center justify-center p-2 rounded-lg text-blue-600 hover:bg-blue-50"
                                title="Edit"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {!listLoading && totalMatching > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-4 text-sm text-gray-600">
                  <span>
                    Showing{' '}
                    {totalMatching === 0
                      ? '0'
                      : `${listPage * INCHARGE_PAGE_SIZE + 1}–${Math.min(
                          (listPage + 1) * INCHARGE_PAGE_SIZE,
                          totalMatching
                        )}`}{' '}
                    of {totalMatching}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setListPage((p) => Math.max(0, p - 1))}
                      disabled={listPage === 0 || listLoading}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-gray-500 tabular-nums">
                      Page {listPage + 1} / {Math.max(1, Math.ceil(totalMatching / INCHARGE_PAGE_SIZE))}
                    </span>
                    <button
                      type="button"
                      onClick={() => setListPage((p) => p + 1)}
                      disabled={
                        listLoading || (listPage + 1) * INCHARGE_PAGE_SIZE >= totalMatching
                      }
                      className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>

            {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">{error}</div>}
            {message && <div className="bg-green-50 text-green-700 px-4 py-3 rounded-lg text-sm">{message}</div>}
          </div>
        </div>
      </div>

      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-900">{editMode ? 'Edit Incharge' : 'Add Incharge'}</h3>
              <button
                type="button"
                onClick={closeAddModal}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4 text-sm">
              <p className="text-gray-600 text-xs">
                Dropdowns use <span className="font-medium">Locations CSV</span> values plus existing incharges. Search to filter; multi-select where multiple values apply. First AC is used as primary login scope.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-gray-700 font-medium">Sr No</span>
                  <input
                    value={addForm.srNo}
                    onChange={(e) => setAddForm((f) => ({ ...f, srNo: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </label>
                <label className="block">
                  <span className="text-gray-700 font-medium">Unique</span>
                  <input
                    value={addForm.unique}
                    onChange={(e) => setAddForm((f) => ({ ...f, unique: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-gray-700 font-medium">Name *</span>
                  <input
                    value={addForm.name}
                    onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-gray-700 font-medium">Contact Number *</span>
                  <input
                    value={addForm.mobile}
                    onChange={(e) => setAddForm((f) => ({ ...f, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                    maxLength={10}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </label>
                <div className="sm:col-span-2">
                  <SearchableMultiSelect
                    label="Designation *"
                    mode="single"
                    options={designationOptionsForFormField}
                    value={addForm.designation ? [addForm.designation] : []}
                    onChange={(v) => setAddForm((f) => ({ ...f, designation: v[0] ?? '' }))}
                    placeholder="Select designation"
                  />
                </div>
                <div className="sm:col-span-2">
                  <SearchableMultiSelect
                    label="Zone"
                    mode="multi"
                    options={zoneOptionsForForm}
                    value={addForm.zones}
                    onChange={(v) => setAddForm((f) => ({ ...f, zones: v }))}
                    placeholder="Search zones…"
                  />
                </div>
                <div className="sm:col-span-2">
                  <SearchableMultiSelect
                    label="District"
                    mode="multi"
                    options={districtOptionsForForm}
                    value={addForm.districts}
                    onChange={(v) => setAddForm((f) => ({ ...f, districts: v }))}
                    placeholder="Search districts…"
                  />
                </div>
                <div className="sm:col-span-2">
                  <SearchableMultiSelect
                    label="Wing Name"
                    mode="single"
                    options={wingOptionsForForm}
                    value={addForm.wing ? [addForm.wing] : []}
                    onChange={(v) => setAddForm((f) => ({ ...f, wing: v[0] ?? '' }))}
                    placeholder="e.g. Youth, Women"
                  />
                </div>
                <div className="sm:col-span-2">
                  <SearchableMultiSelect
                    label="Halka / Block"
                    mode="multi"
                    options={halkaOptionsForForm}
                    value={addForm.halkas}
                    onChange={(v) => setAddForm((f) => ({ ...f, halkas: v }))}
                    placeholder="Search block / halka…"
                  />
                </div>
                <div className="sm:col-span-2">
                  <SearchableMultiSelect
                    label="Village / Ward Name"
                    mode="multi"
                    options={villageOptionsForForm}
                    value={addForm.villages}
                    onChange={(v) => setAddForm((f) => ({ ...f, villages: v }))}
                    placeholder="Search village…"
                  />
                </div>
                <div className="sm:col-span-2">
                  <SearchableMultiSelect
                    label="AC Name * (multi-select; first = primary)"
                    mode="multi"
                    options={assemblyOptionsForForm}
                    value={addForm.acNames}
                    onChange={(v) => setAddForm((f) => ({ ...f, acNames: v }))}
                    placeholder="Search assembly…"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
              <button
                type="button"
                onClick={closeAddModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddIncharge}
                disabled={addSaving}
                className="px-4 py-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg disabled:opacity-50"
              >
                {addSaving ? 'Saving…' : editMode ? 'Save changes' : 'Save Incharge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
