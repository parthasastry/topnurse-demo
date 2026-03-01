export type JobStatus = 'draft' | 'active' | 'fulfilled';

export type EmploymentType = 'full-time' | 'part-time' | 'per-diem' | 'contract';

export interface Job {
  organizationId: string;
  jobId: string;
  title: string;
  description?: string;
  status: JobStatus;
  location?: string;
  department?: string;
  employmentType?: EmploymentType;
  minYearsExperience?: number;
  skills?: string[];
  remote?: boolean;
  /** Natural-language prompt used to create this job via "Create job with AI". */
  sourceDescription?: string;
  createdAt: string;
  updatedAt: string;
}

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  fulfilled: 'Fulfilled',
};

export const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'full-time', label: 'Full-time' },
  { value: 'part-time', label: 'Part-time' },
  { value: 'per-diem', label: 'Per-diem' },
  { value: 'contract', label: 'Contract' },
];
