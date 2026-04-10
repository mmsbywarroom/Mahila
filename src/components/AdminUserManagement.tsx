import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Search, UserPlus } from 'lucide-react';
import { authUrl, authHeadersJson, parseJsonResponse } from '../lib/api';

interface AdminUserManagementProps {
  onBack?: () => void;
  embedded?: boolean;
}

export default function AdminUserManagement({ onBack, embedded }: AdminUserManagementProps) {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [assemblySearch, setAssemblySearch] = useState('');
  const [selectedAssembly, setSelectedAssembly] = useState('');
  const [showAssemblyList, setShowAssemblyList] = useState(false);
  const [assemblies, setAssemblies] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const loadAssemblies = async () => {
      try {
        const response = await fetch(authUrl('list-assemblies'), {
          method: 'POST',
          headers: authHeadersJson(),
          body: '{}',
        });
        const json = await parseJsonResponse(response);
        if (json.success && Array.isArray(json.assemblies)) {
          setAssemblies(json.assemblies as string[]);
        }
      } catch {
        setAssemblies([]);
      }
    };

    loadAssemblies();
  }, []);

  const filteredAssemblies = useMemo(() => {
    const q = assemblySearch.trim().toLowerCase();
    const base = q ? assemblies.filter((a) => a.toLowerCase().includes(q)) : assemblies;
    return base.slice(0, 10);
  }, [assemblies, assemblySearch]);

  const handleCreateUser = async () => {
    setMessage('');
    setError('');

    if (!name.trim() || !selectedAssembly || mobile.length !== 10) {
      setError('Name, 10 digit mobile, and assembly are required.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(authUrl('admin-create-user'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({
          userId: 'admin',
          password: 'admin@123',
          name: name.trim(),
          mobile,
          preferred_assembly: selectedAssembly,
        }),
      });

      const data = await parseJsonResponse(response);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to create user');
      }

      setMessage('User created/updated successfully.');
      setName('');
      setMobile('');
      setAssemblySearch('');
      setSelectedAssembly('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={embedded ? 'w-full' : 'min-h-screen bg-gradient-to-br from-orange-50 to-amber-50'}>
      <div
        className={`${
          embedded ? 'max-w-[min(100%,80rem)]' : 'max-w-3xl'
        } mx-auto ${embedded ? '' : 'p-4 py-8'}`}
      >
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center gap-4 mb-8">
            {onBack && (
              <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <ArrowLeft className="h-6 w-6 text-gray-600" />
              </button>
            )}
            <div>
              <h1 className="text-3xl font-bold text-gray-900">User Create Module</h1>
              <p className="text-gray-600">Yahan se sirf manual user create/update hoga</p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-800">
              Incharge upload is handled in a separate module. This page is only for single user create/update.
            </div>

            <div id="manual-user-form">
              <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                placeholder="Enter user full name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Mobile Number</label>
              <input
                type="tel"
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                placeholder="Enter 10 digit mobile"
                maxLength={10}
              />
            </div>

            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-2">Assembly</label>
              <Search className="absolute left-3 top-11 h-5 w-5 text-gray-400" />
              <input
                type="text"
                value={assemblySearch}
                onChange={(e) => {
                  setAssemblySearch(e.target.value);
                  setShowAssemblyList(true);
                }}
                onFocus={() => setShowAssemblyList(true)}
                placeholder="Search and select assembly"
                className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              />
              {showAssemblyList && filteredAssemblies.length > 0 && (
                <div className="absolute z-20 mt-2 w-full max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                  {filteredAssemblies.map((assembly) => (
                    <button
                      key={assembly}
                      onClick={() => {
                        setSelectedAssembly(assembly);
                        setAssemblySearch(assembly);
                        setShowAssemblyList(false);
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-orange-50 border-b border-gray-100 last:border-b-0"
                    >
                      {assembly}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">{error}</div>}
            {message && <div className="bg-green-50 text-green-700 px-4 py-3 rounded-lg text-sm">{message}</div>}

            <button
              onClick={handleCreateUser}
              disabled={loading}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <UserPlus className="h-5 w-5" />
              <span>{loading ? 'Saving...' : 'Create / Update User'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
