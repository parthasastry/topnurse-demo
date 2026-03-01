import { useEffect, useState } from 'react';
import { useParams, useLocation, Link, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getJobMatches } from '@/lib/api';
import type { JobMatch } from '@/lib/api';
import { useCurrentUser } from '@/context/CurrentUserContext';

type JobDetailsFromLink = {
  title?: string;
  location?: string;
  description?: string;
  department?: string;
};

type CachedMatchesState = {
  cachedMatches?: JobMatch[];
  cachedJobTitle?: string | null;
  cachedJobLocation?: string | null;
  cachedJobDescription?: string | null;
  cachedJobDepartment?: string | null;
  jobDetails?: JobDetailsFromLink;
};

/** Recruiter-only: find/match candidates for a job. */
export function JobCandidatesPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const location = useLocation();
  const user = useCurrentUser();
  const state = location.state as CachedMatchesState | null | undefined;
  const hasCache = Array.isArray(state?.cachedMatches) && state?.cachedJobTitle !== undefined;
  const jobDetailsFromLink = state?.jobDetails;

  const [jobTitle, setJobTitle] = useState<string | null>(() =>
    hasCache ? (state!.cachedJobTitle ?? null) : (jobDetailsFromLink?.title ?? null)
  );
  const [jobLocation, setJobLocation] = useState<string | null>(() =>
    hasCache ? (state!.cachedJobLocation ?? null) : (jobDetailsFromLink?.location ?? null)
  );
  const [jobDescription, setJobDescription] = useState<string | null>(() =>
    hasCache ? (state!.cachedJobDescription ?? null) : (jobDetailsFromLink?.description ?? null)
  );
  const [jobDepartment, setJobDepartment] = useState<string | null>(() =>
    hasCache ? (state!.cachedJobDepartment ?? null) : (jobDetailsFromLink?.department ?? null)
  );
  const [matches, setMatches] = useState<JobMatch[]>(() =>
    hasCache ? (state!.cachedMatches ?? []) : []
  );
  const [loading, setLoading] = useState(!hasCache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    if (hasCache) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getJobMatches(jobId, 5)
      .then((data) => {
        if (!cancelled) {
          setJobTitle((prev) => data.jobTitle ?? prev ?? null);
          setJobLocation((prev) => (data.jobLocation != null ? data.jobLocation : prev ?? null));
          setJobDescription((prev) => (data.jobDescription != null ? data.jobDescription : prev ?? null));
          setJobDepartment((prev) => (data.jobDepartment != null ? data.jobDepartment : prev ?? null));
          setMatches(data.matches ?? []);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load matches');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, hasCache]);

  if (user?.role !== 'Recruiter') return <Navigate to="/" replace />;
  if (!jobId) return <Navigate to="/jobs" replace />;

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        <Link
          to="/jobs"
          className="text-sm font-medium text-amber-700 hover:text-amber-800 hover:underline"
        >
          ← Back to jobs
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">
          Find candidates{jobTitle ? ` for ${jobTitle}` : ''}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          AI-ranked candidates with short rationale. Recruiters can contact from the Candidates page.
        </p>
      </div>

      {!loading && matches.length > 0 && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50/60 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Job details</h2>
          <dl className="space-y-1.5 text-sm">
            {jobTitle && (
              <div>
                <dt className="sr-only">Title</dt>
                <dd className="font-medium text-gray-900">{jobTitle}</dd>
              </div>
            )}
            {(jobLocation || jobDepartment) && (
              <div>
                <dt className="sr-only">Location / department</dt>
                <dd className="text-gray-700">
                  {[jobDepartment, jobLocation].filter(Boolean).join(' · ')}
                </dd>
              </div>
            )}
            {jobDescription && (
              <div>
                <dt className="sr-only">Description</dt>
                <dd className="text-gray-600 leading-relaxed">{jobDescription}</dd>
              </div>
            )}
            {!jobTitle && !jobLocation && !jobDepartment && !jobDescription && (
              <dd className="text-gray-500">No additional job details available.</dd>
            )}
          </dl>
        </div>
      )}

      {loading && (
        <div
          className="flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-amber-200 bg-amber-50/80 px-6 py-10"
          role="status"
          aria-live="polite"
          aria-label="Searching for matching candidates"
        >
          <Loader2 className="h-10 w-10 text-amber-600 animate-spin" aria-hidden />
          <div className="text-center">
            <p className="font-semibold text-gray-900">Searching for matching candidates</p>
            <p className="mt-1 text-sm text-gray-600">
              Comparing job requirements with candidate profiles. This may take a few seconds.
            </p>
          </div>
        </div>
      )}

      {!loading && error && (
        <p className="text-sm text-red-600" role="alert">{error}</p>
      )}

      {!loading && !error && matches.length === 0 && (
        <p className="text-sm text-gray-500">No matching candidates.</p>
      )}

      {!loading && matches.length > 0 && (
        <ul className="space-y-3" role="list">
          {matches.map((m) => (
            <li key={m.email} className="p-3 rounded-lg border border-gray-200 bg-gray-50/50">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                  #{m.rank}
                </span>
                <Link
                  to={`/candidates/${encodeURIComponent(m.email)}`}
                  state={{
                    from: 'matches',
                    jobId,
                    cachedMatches: matches,
                    cachedJobTitle: jobTitle,
                    cachedJobLocation: jobLocation,
                    cachedJobDescription: jobDescription,
                    cachedJobDepartment: jobDepartment,
                  }}
                  className="text-sm font-medium text-amber-700 hover:text-amber-800 hover:underline"
                >
                  {m.displayName?.trim()
                    ? `${m.displayName.trim()} (${m.email})`
                    : `— (${m.email})`}
                </Link>
              </div>
              {(m.skills?.length ?? 0) > 0 && (
                <p className="text-xs text-gray-600 mb-1">
                  <span className="font-medium text-gray-700">Skills:</span>{' '}
                  {m.skills?.join(', ')}
                </p>
              )}
              {m.location && (
                <p className="text-xs text-gray-600 mb-1.5">
                  <span className="font-medium text-gray-700">Location:</span> {m.location}
                </p>
              )}
              <p className="text-sm text-gray-600">{m.rationale}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
