/** Date range used in TopNurse Repo (month/year). */
export interface DateRange {
  month?: string;
  year?: string;
}

export interface ExperienceItem {
  organization: string;
  job_title: string;
  location: string;
  from_date: DateRange;
  to_date: DateRange;
  description: string;
  other?: string;
}

export interface EducationItem {
  institution: string;
  degree: string;
  field_of_study?: string;
  from_date: DateRange;
  to_date: DateRange;
  description?: string;
  honors?: string;
}

export interface LicenseCertItem {
  name: string;
  institution?: string;
  from_date?: DateRange;
  to_date?: DateRange;
  other?: string;
}

export interface CandidateProfile {
  email: string;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
  displayName?: string;
  phone?: string;
  bio?: string;
  address?: string;
  location?: string;
  summary?: string;
  skills?: string[];
  experience?: ExperienceItem[];
  education?: EducationItem[];
  licenses_and_certifications?: LicenseCertItem[];
  resumeKey?: string;
  resumeUploadedAt?: string;
}
