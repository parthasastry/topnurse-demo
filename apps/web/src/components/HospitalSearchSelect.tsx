import { useRef, useState, useId, useEffect } from 'react';
import type { Hospital } from '@/hooks/useHospitals';

interface HospitalSearchSelectProps {
  hospitals: Hospital[];
  isLoading: boolean;
  value: string;
  onChange: (hospitalId: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  errorMessage?: string;
}

export function HospitalSearchSelect({
  hospitals,
  isLoading,
  value,
  onChange,
  label = 'Hospital',
  placeholder = 'Search hospitals...',
  required = false,
  errorMessage,
}: HospitalSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const listId = useId();
  const inputId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedHospital = hospitals.find((h) => h.hospitalId === value);
  const filtered = search.trim()
    ? hospitals.filter((h) =>
        h.name.toLowerCase().includes(search.toLowerCase())
      )
    : hospitals;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? undefined : undefined}
          value={open ? search : (selectedHospital?.name ?? value ?? '')}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
            if (!open) onChange('');
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder={placeholder}
          disabled={isLoading}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:bg-gray-100"
        />
        {open && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-500">No hospitals found</li>
            ) : (
              filtered.map((h) => (
                <li
                  key={h.hospitalId}
                  role="option"
                  aria-selected={value === h.hospitalId}
                  onClick={() => {
                    onChange(h.hospitalId);
                    setSearch('');
                    setOpen(false);
                  }}
                  className={`cursor-pointer px-3 py-2 text-sm hover:bg-amber-50 ${value === h.hospitalId ? 'bg-amber-100' : ''}`}
                >
                  {h.name}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {errorMessage && (
        <p className="text-sm text-red-600">{errorMessage}</p>
      )}
    </div>
  );
}
