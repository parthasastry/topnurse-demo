import { useEffect, useState } from 'react';
import { useParams, useLocation, Link, Navigate } from 'react-router-dom';
import { fetchCandidateByEmail } from '@/lib/api';
import type { CandidateProfile } from '@/types/candidate';
import type { JobMatch } from '@/lib/api';
import { CandidateDetailsContent } from '@/components/CandidateDetailsContent';
import { useCurrentUser } from '@/context/CurrentUserContext';

type LocationState = {
  from?: 'matches';
  jobId?: string;
  cachedMatches?: JobMatch[];
  cachedJobTitle?: string | null;
  cachedJobLocation?: string | null;
  cachedJobDescription?: string | null;
  cachedJobDepartment?: string | null;
} | null;

/** Recruiter-only: view a single candidate by email (e.g. from job match link). */
export function CandidateDetailPage() {
  const { email: rawEmail } = useParams<{ email: string }>();
  const location = useLocation();
  const state = location.state as LocationState | undefined;
  const fromMatches = state?.from === 'matches' && state?.jobId;
  const backToMatchesPath = fromMatches ? `/jobs/${state.jobId}/candidates` : null;
  const backToMatchesState =
    fromMatches && state
      ? {
          cachedMatches: state.cachedMatches,
          cachedJobTitle: state.cachedJobTitle,
          cachedJobLocation: state.cachedJobLocation,
          cachedJobDescription: state.cachedJobDescription,
          cachedJobDepartment: state.cachedJobDepartment,
        }
      : undefined;
  let email: string | undefined;
  try {
    email = rawEmail ? decodeURIComponent(rawEmail) : undefined;
  } catch {
    email = rawEmail ?? undefined;
  }
  const user = useCurrentUser();
  const [candidate, setCandidate] = useState<CandidateProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    setCandidate(undefined);
    setError(null);
    fetchCandidateByEmail(email)
      .then((c) => {
        if (!cancelled) setCandidate(c ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load candidate');
      });
    return () => {
      cancelled = true;
    };
  }, [email]);

  if (user?.role !== 'Recruiter') return <Navigate to="/" replace />;
  if (!email) return <Navigate to="/candidates" replace />;

  if (candidate === undefined && !error) {
    return (
      <div className="max-w-2xl">
        <p className="text-sm text-gray-500">Loading candidate…</p>
      </div>
    );
  }

  const backLink = backToMatchesPath ? (
    <Link
      to={backToMatchesPath}
      state={backToMatchesState}
      className="text-sm text-amber-700 hover:underline"
    >
      ← Back to matches
    </Link>
  ) : (
    <Link to="/candidates" className="text-sm text-amber-700 hover:underline">
      ← Back to candidates
    </Link>
  );

  if (error) {
    return (
      <div className="max-w-2xl">
        <p className="text-sm text-red-600" role="alert">{error}</p>
        <span className="mt-2 inline-block">{backLink}</span>
      </div>
    );
  }

  if (candidate === null) {
    return (
      <div className="max-w-2xl">
        <p className="text-sm text-gray-600">Candidate not found.</p>
        <span className="mt-2 inline-block">{backLink}</span>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        {backLink}
      </div>
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-semibold text-gray-900">
            {candidate.displayName || candidate.email}
          </h1>
        </div>
        <div className="p-4 overflow-y-auto">
          <CandidateDetailsContent candidate={candidate} />
        </div>
      </div>
    </div>
  );
}
