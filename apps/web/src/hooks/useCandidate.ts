import { useCallback, useEffect, useState } from 'react';
import { fetchCandidate, saveCandidate } from '@/lib/api';
import type { CandidateProfile } from '@/types/candidate';

export function useCandidate(): {
  candidate: CandidateProfile | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  saveProfile: (body: Partial<CandidateProfile>) => Promise<void>;
} {
  const [candidate, setCandidate] = useState<CandidateProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCandidate();
      setCandidate(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile');
      setCandidate(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const saveProfile = useCallback(
    async (body: Partial<CandidateProfile>) => {
      setError(null);
      const saved = await saveCandidate(body);
      setCandidate(saved);
    },
    []
  );

  return { candidate, loading, error, refetch, saveProfile };
}
