import { fetchAuthSession } from 'aws-amplify/auth';
import type { CandidateProfile } from '@/types/candidate';
import type { Job, JobStatus, EmploymentType } from '@/types/job';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

/** Returns true if the value looks like a JWT (three base64 parts separated by dots). */
function isJwtString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && (value.split('.').length === 3 || value.startsWith('eyJ'));
}

export async function getAuthHeaders(): Promise<HeadersInit> {
  const session = await fetchAuthSession();
  const idToken = session.tokens?.idToken;
  const token = typeof idToken?.toString === 'function' ? idToken.toString() : undefined;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token && isJwtString(token)) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export interface FetchCandidatesResult {
  candidates: CandidateProfile[];
  lastEvaluatedKey: string | null;
  hasMore: boolean;
}

/** List candidates with optional search (name, location, skills) and pagination (recruiter only). */
export async function fetchCandidates(options?: {
  limit?: number;
  lastEvaluatedKey?: string | null;
  search?: string | null;
}): Promise<FetchCandidatesResult> {
  const params = new URLSearchParams();
  params.set('limit', String(options?.limit ?? 20));
  if (options?.lastEvaluatedKey) {
    params.set('lastEvaluatedKey', options.lastEvaluatedKey);
  }
  if (options?.search && options.search.trim()) {
    params.set('search', options.search.trim());
  }
  const url = `${API_BASE}/candidates?${params}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  const data = await res.json();
  return {
    candidates: data.candidates ?? [],
    lastEvaluatedKey: data.lastEvaluatedKey ?? null,
    hasMore: data.hasMore ?? false,
  };
}

export async function fetchCandidate(): Promise<CandidateProfile | null> {
  const res = await fetch(`${API_BASE}/candidates/me`, {
    method: 'GET',
    headers: await getAuthHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return res.json();
}

/** Fetch one candidate by email (recruiter only). Returns null if not found. */
export async function fetchCandidateByEmail(email: string): Promise<CandidateProfile | null> {
  const res = await fetch(`${API_BASE}/candidates/${encodeURIComponent(email)}`, {
    method: 'GET',
    headers: await getAuthHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return res.json();
}

/** Create or replace my candidate profile (PUT = create if missing, else replace). */
export async function saveCandidate(
  body: Partial<Omit<CandidateProfile, 'email' | 'userId' | 'createdAt' | 'updatedAt'>>
): Promise<CandidateProfile> {
  const res = await fetch(`${API_BASE}/candidates/me`, {
    method: 'PUT',
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return res.json();
}

export interface ResumeUploadUrlResponse {
  uploadUrl: string;
  key: string;
  /** Use this exact value as Content-Type when PUTting to uploadUrl (required for presigned URL). */
  contentType: string;
  uploadId?: string;
  expiresIn: number;
}

/** Get presigned URL to upload a resume (PDF or DOCX). */
export async function getResumeUploadUrl(filename: string): Promise<ResumeUploadUrlResponse> {
  const res = await fetch(`${API_BASE}/candidates/me/resume/upload-url`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ filename }),
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return res.json();
}

/** Record that a resume was uploaded at the given S3 key (call after PUT to presigned URL). */
export async function recordResume(key: string): Promise<{ key: string; resumeUploadedAt: string; candidate: CandidateProfile }> {
  const res = await fetch(`${API_BASE}/candidates/me/resume`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ key }),
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return res.json();
}

/** Parsed resume suggestion shape (matches CandidateProfile subset from OpenAI). */
export interface ParsedResumeSuggestion {
  displayName?: string | null;
  phone?: string | null;
  summary?: string | null;
  skills?: string[];
  experience?: Array<{
    organization?: string;
    job_title?: string;
    location?: string;
    from_date?: { month?: string; year?: string };
    to_date?: { month?: string; year?: string };
    description?: string;
  }>;
  education?: Array<{
    institution?: string;
    degree?: string;
    field_of_study?: string | null;
    from_date?: { month?: string; year?: string };
    to_date?: { month?: string; year?: string };
    description?: string | null;
    honors?: string | null;
  }>;
  licenses_and_certifications?: Array<{
    name?: string;
    institution?: string | null;
    from_date?: { month?: string; year?: string } | null;
    to_date?: { month?: string; year?: string } | null;
  }>;
}

export interface ParseResumeResponse {
  rawText: string;
  suggested: ParsedResumeSuggestion;
}

/** Parse resume on demand: extract text (DOCX/PDF) and run OpenAI to get suggested profile fields. */
export async function parseResume(): Promise<ParseResumeResponse> {
  const res = await fetch(`${API_BASE}/candidates/me/resume/parse`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return res.json();
}

// ——— Jobs (recruiter only) ———

/** List jobs for the recruiter's organization. Optional status filter. */
export async function fetchJobs(params?: { status?: JobStatus }): Promise<Job[]> {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  const url = `${API_BASE}/jobs${search.toString() ? `?${search}` : ''}`;
  const res = await fetch(url, { method: 'GET', headers: await getAuthHeaders() });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  const data = await res.json();
  return data.jobs ?? [];
}

/** Get one job by id */
export async function fetchJob(jobId: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return res.json();
}

/** Create a job */
export interface CreateJobBody {
  title: string;
  description?: string;
  status?: JobStatus;
  location?: string;
  department?: string;
  employmentType?: EmploymentType;
  minYearsExperience?: number;
  skills?: string[];
  remote?: boolean;
  /** Recruiter's natural-language prompt when job was created via "Create job with AI". */
  sourceDescription?: string;
}

export interface UpdateJobBody {
  title?: string;
  description?: string;
  status?: JobStatus;
  location?: string;
  department?: string;
  employmentType?: EmploymentType;
  minYearsExperience?: number;
  skills?: string[];
  remote?: boolean;
  sourceDescription?: string;
}

/** Create a job (default status: draft) */
export async function createJob(body: CreateJobBody): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return res.json();
}

/** Get a suggested job payload from a natural-language description (recruiter-only). */
export async function getJobFromDescription(description: string): Promise<{ suggested: CreateJobBody }> {
  const res = await fetch(`${API_BASE}/jobs/from-description`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ description: description.trim() }),
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return res.json();
}

/** Update a job */
export async function updateJob(jobId: string, body: UpdateJobBody): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}`, {
    method: 'PUT',
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return res.json();
}

/** Delete a job */
export async function deleteJob(jobId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
}

/** Match candidates for a job (Option C: embedding shortlist + LLM rationale). Recruiter-only. */
export interface JobMatch {
  email: string;
  displayName?: string;
  rank: number;
  rationale: string;
  skills?: string[];
  location?: string;
}

export interface JobMatchesResponse {
  matches: JobMatch[];
  jobTitle: string;
  jobLocation?: string;
  jobDescription?: string;
  jobDepartment?: string;
}

export async function getJobMatches(
  jobId: string,
  limit?: number
): Promise<JobMatchesResponse> {
  const params = limit != null ? `?limit=${limit}` : '';
  const res = await fetch(
    `${API_BASE}/jobs/${encodeURIComponent(jobId)}/matches${params}`,
    { method: 'GET', headers: await getAuthHeaders() }
  );
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return res.json();
}
