import { useEffect, useState } from 'react';

export interface Hospital {
  hospitalId: string;
  name: string;
}

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

async function fetchHospitalsFromApi(): Promise<Hospital[]> {
  const base = API_URL?.replace(/\/$/, '') ?? '';
  if (!base) {
    return [];
  }
  const res = await fetch(`${base}/hospitals`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Hospitals API error: ${res.status}`);
  }
  const data = (await res.json()) as { hospitals: Hospital[] };
  return data.hospitals ?? [];
}

export function useHospitals(): { hospitals: Hospital[]; isLoading: boolean; error: string | null } {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (!API_URL) {
      setHospitals([]);
      setIsLoading(false);
      return;
    }
    fetchHospitalsFromApi()
      .then((list) => {
        if (!cancelled) {
          setHospitals(list);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load hospitals');
          setHospitals([]);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { hospitals, isLoading, error };
}
