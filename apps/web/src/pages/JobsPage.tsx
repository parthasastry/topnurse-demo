import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Users, Send, CheckCircle2, Trash2 } from 'lucide-react';
import { fetchJobs, createJob, updateJob, deleteJob, getJobFromDescription } from '@/lib/api';
import type { Job, JobStatus, EmploymentType } from '@/types/job';
import { JOB_STATUS_LABELS, EMPLOYMENT_TYPES } from '@/types/job';

const SEARCH_DEBOUNCE_MS = 400;
const PAGE_SIZE = 20;

type StatusFilter = 'all' | JobStatus;
const STATUS_OPTIONS: JobStatus[] = ['draft', 'active', 'fulfilled'];

function statusBadgeClass(status: JobStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-gray-100 text-gray-800';
    case 'active':
      return 'bg-green-100 text-green-800';
    case 'fulfilled':
      return 'bg-blue-100 text-blue-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

/** Parse comma-separated or newline-separated skills into string[] */
function parseSkillsInput(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function skillsToInputValue(skills: string[] | undefined): string {
  return skills?.join(', ') ?? '';
}

export function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pagination, setPagination] = useState<{
    hasMore: boolean;
    lastEvaluatedKey: string | null;
  }>({ hasMore: false, lastEvaluatedKey: null });
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createFormInitialValues, setCreateFormInitialValues] = useState<Partial<Job> | null>(null);
  const [createFormSourceDescription, setCreateFormSourceDescription] = useState<string | null>(null);
  const [showAIStep, setShowAIStep] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [jobToDelete, setJobToDelete] = useState<Job | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadJobs = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchJobs({
          status: statusFilter === 'all' ? undefined : statusFilter,
          search: debouncedSearch.trim() || undefined,
          limit: PAGE_SIZE,
          lastEvaluatedKey: reset ? undefined : pagination.lastEvaluatedKey ?? undefined,
        });
        if (reset) {
          setJobs(result.jobs);
        } else {
          setJobs((prev) => [...prev, ...result.jobs]);
        }
        setPagination({
          hasMore: result.hasMore,
          lastEvaluatedKey: result.lastEvaluatedKey,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load jobs');
      } finally {
        setLoading(false);
    }
    },
    [statusFilter, debouncedSearch, pagination.lastEvaluatedKey]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    setPagination((prev) => ({ ...prev, lastEvaluatedKey: null }));
    loadJobs(true);
  }, [debouncedSearch, statusFilter]);

  const handleLoadMore = () => {
    if (pagination.hasMore && !loading) {
      loadJobs(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const title = (form.elements.namedItem('create-title') as HTMLInputElement).value.trim();
    if (!title) return;
    const description = (form.elements.namedItem('create-description') as HTMLTextAreaElement).value.trim();
    const status = (form.elements.namedItem('create-status') as HTMLSelectElement).value as JobStatus;
    const location = (form.elements.namedItem('create-location') as HTMLInputElement).value.trim();
    const department = (form.elements.namedItem('create-department') as HTMLInputElement).value.trim();
    const employmentType = (form.elements.namedItem('create-employmentType') as HTMLSelectElement).value as EmploymentType | '';
    const minYearsStr = (form.elements.namedItem('create-minYearsExperience') as HTMLInputElement).value.trim();
    const skillsStr = (form.elements.namedItem('create-skills') as HTMLTextAreaElement).value;
    const remote = (form.elements.namedItem('create-remote') as HTMLInputElement).checked;

    setSaving(true);
    setError(null);
    try {
      await createJob({
        title,
        description: description || undefined,
        status: status || 'draft',
        location: location || undefined,
        department: department || undefined,
        employmentType: employmentType || undefined,
        minYearsExperience: minYearsStr ? parseInt(minYearsStr, 10) : undefined,
        skills: parseSkillsInput(skillsStr).length ? parseSkillsInput(skillsStr) : undefined,
        remote: remote || undefined,
        sourceDescription: createFormSourceDescription ?? undefined,
      });
      setShowCreateForm(false);
      setCreateFormInitialValues(null);
      setCreateFormSourceDescription(null);
      form.reset();
      await loadJobs(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create job');
    } finally {
      setSaving(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    if (!editingJob) return;
    e.preventDefault();
    const form = e.currentTarget;
    const title = (form.elements.namedItem('edit-title') as HTMLInputElement)?.value.trim();
    if (!title) return;
    const description = (form.elements.namedItem('edit-description') as HTMLTextAreaElement)?.value.trim();
    const status = (form.elements.namedItem('edit-status') as HTMLSelectElement)?.value as JobStatus;
    const location = (form.elements.namedItem('edit-location') as HTMLInputElement)?.value.trim();
    const department = (form.elements.namedItem('edit-department') as HTMLInputElement)?.value.trim();
    const employmentType = (form.elements.namedItem('edit-employmentType') as HTMLSelectElement)?.value as EmploymentType | '';
    const minYearsStr = (form.elements.namedItem('edit-minYearsExperience') as HTMLInputElement)?.value.trim();
    const skillsStr = (form.elements.namedItem('edit-skills') as HTMLTextAreaElement)?.value ?? '';
    const remote = (form.elements.namedItem('edit-remote') as HTMLInputElement)?.checked ?? false;

    setSaving(true);
    setError(null);
    try {
      await updateJob(editingJob.jobId, {
        title,
        description: description || undefined,
        status,
        location: location || undefined,
        department: department || undefined,
        employmentType: employmentType || undefined,
        minYearsExperience: minYearsStr ? parseInt(minYearsStr, 10) : undefined,
        skills: parseSkillsInput(skillsStr).length ? parseSkillsInput(skillsStr) : undefined,
        remote,
      });
      setEditingJob(null);
      await loadJobs(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update job');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitJob = async (job: Job) => {
    if (job.status !== 'draft') return;
    setError(null);
    try {
      await updateJob(job.jobId, { status: 'active' });
      if (editingJob?.jobId === job.jobId) setEditingJob(null);
      await loadJobs(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit job');
    }
  };

  const handleMarkFulfilled = async (job: Job) => {
    setError(null);
    try {
      await updateJob(job.jobId, { status: 'fulfilled' });
      if (editingJob?.jobId === job.jobId) setEditingJob(null);
      await loadJobs(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update job');
    }
  };

  const handleDeleteClick = (job: Job) => {
    setJobToDelete(job);
    setError(null);
  };

  const handleDeleteConfirm = async () => {
    if (!jobToDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteJob(jobToDelete.jobId);
      if (editingJob?.jobId === jobToDelete.jobId) setEditingJob(null);
      setJobToDelete(null);
      await loadJobs(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete job');
    } finally {
      setDeleting(false);
    }
  };

  const renderJobForm = (
    prefix: string,
    job?: Partial<Job>,
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void = () => {},
    onCancel: () => void = () => {},
    submitLabel = 'Save'
  ) => (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label htmlFor={`${prefix}-title`} className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
        <input
          id={`${prefix}-title`}
          name={`${prefix}-title`}
          type="text"
          required
          defaultValue={job?.title}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500"
          placeholder="e.g. Registered Nurse – ICU"
        />
      </div>
      <div>
        <label htmlFor={`${prefix}-description`} className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <textarea
          id={`${prefix}-description`}
          name={`${prefix}-description`}
          rows={3}
          defaultValue={job?.description}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500"
          placeholder="Job description and requirements..."
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${prefix}-location`} className="block text-sm font-medium text-gray-700 mb-1">Location</label>
          <input
            id={`${prefix}-location`}
            name={`${prefix}-location`}
            type="text"
            defaultValue={job?.location}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500"
            placeholder="e.g. San Francisco, CA"
          />
        </div>
        <div>
          <label htmlFor={`${prefix}-department`} className="block text-sm font-medium text-gray-700 mb-1">Department / Unit</label>
          <input
            id={`${prefix}-department`}
            name={`${prefix}-department`}
            type="text"
            defaultValue={job?.department}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500"
            placeholder="e.g. ICU, ER, NICU"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${prefix}-employmentType`} className="block text-sm font-medium text-gray-700 mb-1">Employment type</label>
          <select
            id={`${prefix}-employmentType`}
            name={`${prefix}-employmentType`}
            defaultValue={job?.employmentType ?? ''}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500"
          >
            <option value="">Select...</option>
            {EMPLOYMENT_TYPES.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${prefix}-minYearsExperience`} className="block text-sm font-medium text-gray-700 mb-1">Min. years experience</label>
          <input
            id={`${prefix}-minYearsExperience`}
            name={`${prefix}-minYearsExperience`}
            type="number"
            min={0}
            defaultValue={job?.minYearsExperience ?? ''}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500"
            placeholder="e.g. 2"
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${prefix}-skills`} className="block text-sm font-medium text-gray-700 mb-1">Required skills / certifications</label>
        <textarea
          id={`${prefix}-skills`}
          name={`${prefix}-skills`}
          rows={2}
          defaultValue={skillsToInputValue(job?.skills)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500"
          placeholder="e.g. BLS, ACLS, PALS (comma-separated)"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          id={`${prefix}-remote`}
          name={`${prefix}-remote`}
          type="checkbox"
          defaultChecked={job?.remote ?? false}
          className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
        />
        <label htmlFor={`${prefix}-remote`} className="text-sm text-gray-700">Remote or hybrid OK</label>
      </div>
      {prefix === 'create' ? (
        <div>
          <label htmlFor={`${prefix}-status`} className="block text-sm font-medium text-gray-700 mb-1">Initial status</label>
          <select
            id={`${prefix}-status`}
            name={`${prefix}-status`}
            defaultValue={job?.status ?? 'draft'}
            className="border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
      ) : (
        <div>
          <label htmlFor={`${prefix}-status`} className="block text-sm font-medium text-gray-700 mb-1">Status</label>
          <select
            id={`${prefix}-status`}
            name={`${prefix}-status`}
            defaultValue={job?.status ?? 'draft'}
            className="border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
      )}
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <div className="max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Jobs</h1>
          <p className="text-gray-600 text-sm mt-0.5">
            Create jobs as <strong>Draft</strong>, then <strong>Submit</strong> to make them <strong>Active</strong>. Mark as <strong>Fulfilled</strong> when filled.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => { setCreateFormInitialValues(null); setCreateFormSourceDescription(null); setShowCreateForm(true); }}
            className="px-4 py-2 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700"
          >
            Create job
          </button>
          <button
            type="button"
            onClick={() => { setShowAIStep(true); setAiDescription(''); setError(null); }}
            className="px-4 py-2 rounded-lg border border-amber-600 text-amber-700 font-medium hover:bg-amber-50"
          >
            Create job with AI
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex items-center gap-2">
          <label htmlFor="jobs-status-filter" className="text-sm font-medium text-gray-700">Status:</label>
          <select
            id="jobs-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-amber-500"
          >
            <option value="all">All</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-0">
          <label htmlFor="jobs-search" className="sr-only">Search jobs</label>
          <input
            id="jobs-search"
            type="search"
            placeholder="Search by job title, location, skills and certs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            aria-describedby="jobs-search-hint"
          />
          <p id="jobs-search-hint" className="mt-1 text-sm text-gray-500">
            Matches job title, location, department, and skills/certifications
          </p>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-4" role="alert">{error}</p>
      )}

      {showAIStep && (
        <div className="mb-6 p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
          <h2 className="text-lg font-medium text-gray-900 mb-3">Create job with AI — Step 1</h2>
          <p className="text-sm text-gray-600 mb-3">Describe the job in your own words. We&apos;ll suggest a title, description, and other fields you can edit before creating.</p>
          <textarea
            value={aiDescription}
            onChange={(e) => setAiDescription(e.target.value)}
            placeholder="e.g. We need a full-time RN for our ICU in Boston, 3+ years experience, BLS and ACLS required, remote not available."
            rows={4}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500 mb-3"
            disabled={aiLoading}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                const desc = aiDescription.trim();
                if (!desc) return;
                setAiLoading(true);
                setError(null);
                try {
                  const { suggested } = await getJobFromDescription(desc);
                  setCreateFormInitialValues({ ...suggested, status: suggested.status ?? 'draft' });
                  setCreateFormSourceDescription(desc);
                  setShowAIStep(false);
                  setShowCreateForm(true);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Failed to generate job from description');
                } finally {
                  setAiLoading(false);
                }
              }}
              disabled={aiLoading || !aiDescription.trim()}
              className="px-4 py-2 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-50"
            >
              {aiLoading ? 'Generating…' : 'Fill form from description'}
            </button>
            <button
              type="button"
              onClick={() => { setShowAIStep(false); setAiDescription(''); }}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showCreateForm && (
        <div className="mb-6 p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
          <h2 className="text-lg font-medium text-gray-900 mb-3">New job</h2>
          {renderJobForm('create', createFormInitialValues ?? {}, handleCreateSubmit, () => { setShowCreateForm(false); setCreateFormInitialValues(null); setCreateFormSourceDescription(null); }, 'Create')}
        </div>
      )}

      {loading && jobs.length === 0 && <p className="text-sm text-gray-500">Loading jobs…</p>}
      {!loading && jobs.length === 0 && (
        <p className="text-sm text-gray-500">
          {debouncedSearch.trim()
            ? `No jobs match "${debouncedSearch}".`
            : statusFilter === 'all'
              ? 'No jobs yet. Create one to get started.'
              : `No ${JOB_STATUS_LABELS[statusFilter as JobStatus]} jobs.`}
        </p>
      )}
      {/* Delete confirmation modal */}
      {jobToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden="true"
            onClick={() => !deleting && setJobToDelete(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-lg"
          >
            <h2 id="delete-dialog-title" className="text-lg font-semibold text-gray-900">
              Delete job?
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Are you sure you want to delete <strong>"{jobToDelete.title}"</strong>? This cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => !deleting && setJobToDelete(null)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete job'}
              </button>
            </div>
          </div>
        </div>
      )}

      {jobs.length > 0 && (
        <>
          {!loading && debouncedSearch.trim() && (
            <p className="text-sm text-gray-600 mb-4">
              Showing {jobs.length} job{jobs.length !== 1 ? 's' : ''} for &quot;{debouncedSearch}&quot;
            </p>
          )}
          <ul className="grid grid-cols-1 md:grid-cols-3 gap-4" role="list">
          {jobs.map((job) => (
            <li key={job.jobId} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
              {editingJob?.jobId === job.jobId ? (
                <div>
                  <h3 className="font-medium text-gray-900 mb-3">Edit job</h3>
                  {renderJobForm(
                    'edit',
                    job,
                    handleEditSubmit,
                    () => setEditingJob(null),
                    'Save'
                  )}
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-start gap-2">
                    <h3 className="font-medium text-gray-900">{job.title}</h3>
                    <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass(job.status)}`}>
                      {JOB_STATUS_LABELS[job.status]}
                    </span>
                  </div>
                  {(job.location || job.department) && (
                    <p className="text-sm text-gray-600 mt-1">
                      {[job.department, job.location].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {job.employmentType && (
                    <p className="text-sm text-gray-500 mt-0.5">{EMPLOYMENT_TYPES.find((e) => e.value === job.employmentType)?.label ?? job.employmentType}</p>
                  )}
                  {job.description && (
                    <p className="text-sm text-gray-600 mt-1 line-clamp-2">{job.description}</p>
                  )}
                  {job.skills && job.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {job.skills.slice(0, 3).map((s) => (
                        <span key={s} className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-800">{s}</span>
                      ))}
                      {job.skills.length > 3 && <span className="text-xs text-gray-500">+{job.skills.length - 3}</span>}
                    </div>
                  )}
                  {job.remote && <p className="text-xs text-gray-500 mt-1">Remote OK</p>}
                  <p className="text-xs text-gray-400 mt-2">Updated {new Date(job.updatedAt).toLocaleDateString()}</p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => setEditingJob(job)}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 hover:text-amber-700"
                    >
                      <Pencil className="shrink-0 w-4 h-4" aria-hidden />
                      Edit
                    </button>
                    <Link
                      to={`/jobs/${job.jobId}/candidates`}
                      state={{
                        jobDetails: {
                          title: job.title,
                          location: job.location ?? undefined,
                          description: job.description ?? undefined,
                          department: job.department ?? undefined,
                        },
                      }}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                    >
                      <Users className="shrink-0 w-4 h-4" aria-hidden />
                      Find candidates
                    </Link>
                    {job.status === 'draft' && (
                      <button
                        type="button"
                        onClick={() => handleSubmitJob(job)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                      >
                        <Send className="shrink-0 w-4 h-4" aria-hidden />
                        Submit (make Active)
                      </button>
                    )}
                    {job.status === 'active' && (
                      <button
                        type="button"
                        onClick={() => handleMarkFulfilled(job)}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                      >
                        <CheckCircle2 className="shrink-0 w-4 h-4" aria-hidden />
                        Mark fulfilled
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteClick(job)}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="shrink-0 w-4 h-4" aria-hidden />
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
          </ul>
          {pagination.hasMore && (
            <div className="flex justify-center mt-8">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loading}
                className="px-6 py-2 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
