import { useCallback, useEffect, useState } from 'react';
import { fetchCandidates } from '@/lib/api';
import type { CandidateProfile } from '@/types/candidate';
import { CandidateDetailsContent } from '@/components/CandidateDetailsContent';

const PAGE_SIZE = 20;

function CandidateDetailsModal({
  candidate,
  onClose,
}: {
  candidate: CandidateProfile;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="details-title">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-start p-4 border-b border-gray-200 shrink-0">
          <h2 id="details-title" className="text-xl font-semibold text-gray-900">
            {candidate.displayName || candidate.email}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 p-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          <CandidateDetailsContent candidate={candidate} />
        </div>
        <div className="p-4 border-t border-gray-200 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 rounded-lg bg-gray-100 text-gray-800 font-medium hover:bg-gray-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const SEARCH_DEBOUNCE_MS = 400;

/**
 * Recruiter-only page: view candidates (read-only) with search (name, location, skills) and pagination.
 */
export function CandidatesPage() {
  const [candidates, setCandidates] = useState<CandidateProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pagination, setPagination] = useState<{
    hasMore: boolean;
    lastEvaluatedKey: string | null;
  }>({ hasMore: false, lastEvaluatedKey: null });
  const [detailsCandidate, setDetailsCandidate] = useState<CandidateProfile | null>(null);

  const loadCandidates = useCallback(async (reset: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCandidates({
        limit: PAGE_SIZE,
        lastEvaluatedKey: reset ? undefined : pagination.lastEvaluatedKey ?? undefined,
        search: debouncedSearch || undefined,
      });
      if (reset) {
        setCandidates(result.candidates);
      } else {
        setCandidates((prev) => [...prev, ...result.candidates]);
      }
      setPagination({
        hasMore: result.hasMore,
        lastEvaluatedKey: result.lastEvaluatedKey,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load candidates');
    } finally {
      setLoading(false);
    }
  }, [pagination.lastEvaluatedKey, debouncedSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    setPagination((prev) => ({ ...prev, lastEvaluatedKey: null }));
    loadCandidates(true);
  }, [debouncedSearch]);

  const handleLoadMore = () => {
    if (pagination.hasMore && !loading) {
      loadCandidates(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-2">Candidates</h1>
      <p className="text-gray-600 mb-4">
        View candidate profiles (read-only). You cannot edit candidate information.
      </p>

      <div className="mb-4">
        <label htmlFor="candidates-search" className="sr-only">
          Search by name, location, or skills
        </label>
        <input
          id="candidates-search"
          type="search"
          placeholder="Search by name, location, or skills..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
          aria-describedby="search-hint"
        />
        <p id="search-hint" className="mt-1 text-sm text-gray-500">
          Search matches display name, location, and skills
        </p>
      </div>

      {loading && candidates.length === 0 && <p className="text-sm text-gray-500">Loading…</p>}
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && candidates.length === 0 && (
        <p className="text-sm text-gray-500">
          {debouncedSearch ? `No candidates match "${debouncedSearch}".` : 'No candidates yet.'}
        </p>
      )}
      {candidates.length > 0 && (
        <>
          {!loading && (
            <p className="text-sm text-gray-600 mb-4">
              Showing {candidates.length} candidate{candidates.length !== 1 ? 's' : ''}
              {debouncedSearch && ` for "${debouncedSearch}"`}
            </p>
          )}
          <ul className="grid grid-cols-1 md:grid-cols-3 gap-4" role="list">
            {candidates.map((c) => (
              <li
                key={c.email}
                className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm"
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900">
                      {c.displayName || c.email}
                    </div>
                    <div className="text-sm text-gray-500 mt-0.5">{c.email}</div>
                    {c.location && (
                      <div className="text-sm text-gray-600 mt-1">Location: {c.location}</div>
                    )}
                    {c.phone && (
                      <div className="text-sm text-gray-600">Phone: {c.phone}</div>
                    )}
                    {c.summary && (
                      <p className="text-sm text-gray-600 mt-2 line-clamp-2">{c.summary}</p>
                    )}
                    {c.skills && c.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {c.skills.slice(0, 5).map((s) => (
                          <span
                            key={s}
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800"
                          >
                            {s}
                          </span>
                        ))}
                        {c.skills.length > 5 && (
                          <span className="text-xs text-gray-500">+{c.skills.length - 5} more</span>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetailsCandidate(c)}
                    className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700"
                  >
                    Details
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {detailsCandidate && (
            <CandidateDetailsModal
              candidate={detailsCandidate}
              onClose={() => setDetailsCandidate(null)}
            />
          )}

          {pagination.hasMore && (
            <div className="flex justify-center mt-8">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loading}
                className="px-6 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
              >
                {loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
