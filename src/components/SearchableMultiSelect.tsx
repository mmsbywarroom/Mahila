import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

type Props = {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** single = pick one (searchable); multi = many */
  mode?: 'single' | 'multi';
  disabled?: boolean;
};

export function SearchableMultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'Search and select…',
  mode = 'multi',
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = [...new Set(options)].sort((a, b) => a.localeCompare(b));
    if (!q) return base.slice(0, 400);
    return base.filter((o) => o.toLowerCase().includes(q)).slice(0, 400);
  }, [options, query]);

  const toggle = (opt: string) => {
    if (mode === 'single') {
      onChange(value.includes(opt) ? [] : [opt]);
      setOpen(false);
      setQuery('');
      return;
    }
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  };

  const summary =
    value.length === 0
      ? placeholder
      : mode === 'single'
        ? value[0]
        : `${value.length} selected`;

  return (
    <div className="relative" ref={rootRef}>
      <span className="text-gray-700 font-medium text-sm">{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-900 hover:border-gray-400 disabled:opacity-50"
      >
        <span className={value.length === 0 ? 'text-gray-400' : ''}>{summary}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-gray-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {mode === 'multi' && value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {value.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-900"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== v))}
                className="rounded p-0.5 hover:bg-orange-200"
                aria-label={`Remove ${v}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to filter…"
            className="w-full border-b border-gray-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-200"
            autoFocus
          />
          <ul className="max-h-56 overflow-y-auto py-1 text-sm">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-gray-500">No matches</li>
            ) : (
              filtered.map((opt) => {
                const sel = value.includes(opt);
                return (
                  <li key={opt}>
                    <button
                      type="button"
                      onClick={() => toggle(opt)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-orange-50 ${
                        sel ? 'bg-orange-50/80 font-medium' : ''
                      }`}
                    >
                      {mode === 'multi' && (
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            sel ? 'border-orange-600 bg-orange-600 text-white' : 'border-gray-300'
                          }`}
                        >
                          {sel && <Check className="h-3 w-3" />}
                        </span>
                      )}
                      <span className="truncate">{opt}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
