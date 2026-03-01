import { useEffect, useRef, useState } from 'react';
import { useCandidate } from '@/hooks/useCandidate';
import { useCurrentUser } from '@/context/CurrentUserContext';
import { getResumeUploadUrl, recordResume, parseResume, type ParsedResumeSuggestion } from '@/lib/api';
import type {
  CandidateProfile,
  ExperienceItem,
  EducationItem,
  LicenseCertItem,
  DateRange,
} from '@/types/candidate';

const emptyDateRange: DateRange = { month: '', year: '' };

const emptyExperience: ExperienceItem = {
  organization: '',
  job_title: '',
  location: '',
  from_date: { ...emptyDateRange },
  to_date: { ...emptyDateRange },
  description: '',
};

const emptyEducation: EducationItem = {
  institution: '',
  degree: '',
  field_of_study: '',
  from_date: { ...emptyDateRange },
  to_date: { ...emptyDateRange },
  description: '',
  honors: '',
};

const emptyLicense: LicenseCertItem = {
  name: '',
  institution: '',
  from_date: undefined,
  to_date: undefined,
};

const MAX_LENGTHS = {
  displayName: 200,
  phone: 30,
  location: 200,
  address: 500,
  summary: 2000,
  bio: 1000,
  skill: 100,
  organization: 200,
  job_title: 200,
  description: 2000,
  institution: 200,
  degree: 200,
  field_of_study: 200,
  licenseName: 200,
} as const;

const YEAR_REGEX = /^\d{4}$/;

const NOMINATIM_DELAY_MS = 400;
const NOMINATIM_MIN_QUERY = 2;

/** Fetch city/state suggestions from Nominatim (OpenStreetMap). Usage policy: 1 req/sec, set User-Agent. */
async function fetchLocationSuggestions(query: string): Promise<string[]> {
  const q = query.trim();
  if (q.length < NOMINATIM_MIN_QUERY) return [];
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=8`;
  const res = await fetch(url, {
    headers: { 'Accept-Language': 'en', 'User-Agent': 'TopNurse/1.0 (Candidate Profile)' },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{ address?: { city?: string; town?: string; village?: string; state?: string; country?: string } }>;
  const seen = new Set<string>();
  return data
    .map((item) => {
      const a = item.address;
      if (!a) return '';
      const city = a.city ?? a.town ?? a.village ?? '';
      const stateOrCountry = a.state ?? a.country ?? '';
      if (!city && !stateOrCountry) return '';
      const label = stateOrCountry ? `${city}, ${stateOrCountry}` : city;
      return label.trim();
    })
    .filter((label) => label && !seen.has(label) && (seen.add(label), true));
}

/** Returns field key -> error message. Empty object means valid. */
function validateForm(form: Partial<CandidateProfile>): Record<string, string> {
  const errors: Record<string, string> = {};
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  const displayName = s(form.displayName);
  if (!displayName) errors.displayName = 'Full name is required.';
  else if (displayName.length > MAX_LENGTHS.displayName) errors.displayName = `Must be ${MAX_LENGTHS.displayName} characters or fewer.`;

  const phone = s(form.phone);
  if (phone && phone.length > MAX_LENGTHS.phone) errors.phone = `Must be ${MAX_LENGTHS.phone} characters or fewer.`;

  const location = s(form.location);
  if (!location) errors.location = 'Location is required.';
  else if (location.length > MAX_LENGTHS.location) errors.location = `Must be ${MAX_LENGTHS.location} characters or fewer.`;

  const address = s(form.address);
  if (address && address.length > MAX_LENGTHS.address) errors.address = `Must be ${MAX_LENGTHS.address} characters or fewer.`;

  const summary = s(form.summary);
  if (summary && summary.length > MAX_LENGTHS.summary) errors.summary = `Must be ${MAX_LENGTHS.summary} characters or fewer.`;

  const bio = s(form.bio);
  if (bio && bio.length > MAX_LENGTHS.bio) errors.bio = `Must be ${MAX_LENGTHS.bio} characters or fewer.`;

  (form.skills ?? []).forEach((skill, i) => {
    const t = s(skill);
    if (t && t.length > MAX_LENGTHS.skill) errors[`skills.${i}`] = `Skill must be ${MAX_LENGTHS.skill} characters or fewer.`;
  });

  (form.experience ?? []).forEach((exp, i) => {
    const org = s(exp.organization);
    const title = s(exp.job_title);
    const hasAny = org || title || s(exp.location) || s(exp.description) || s(exp.from_date?.year) || s(exp.to_date?.year);
    if (hasAny && !org && !title) errors[`experience.${i}`] = 'Enter at least organization or job title.';
    const fromYear = s(exp.from_date?.year);
    if (fromYear && !YEAR_REGEX.test(fromYear)) errors[`experience.${i}.fromYear`] = 'Year must be 4 digits.';
    const toYear = s(exp.to_date?.year);
    if (toYear && !YEAR_REGEX.test(toYear)) errors[`experience.${i}.toYear`] = 'Year must be 4 digits.';
  });

  (form.education ?? []).forEach((edu, i) => {
    const inst = s(edu.institution);
    const degree = s(edu.degree);
    const hasAny = inst || degree || s(edu.field_of_study) || s(edu.description) || s(edu.from_date?.year) || s(edu.to_date?.year);
    if (hasAny && !inst && !degree) errors[`education.${i}`] = 'Enter at least institution or degree.';
    const fromYear = s(edu.from_date?.year);
    if (fromYear && !YEAR_REGEX.test(fromYear)) errors[`education.${i}.fromYear`] = 'Year must be 4 digits.';
    const toYear = s(edu.to_date?.year);
    if (toYear && !YEAR_REGEX.test(toYear)) errors[`education.${i}.toYear`] = 'Year must be 4 digits.';
  });

  (form.licenses_and_certifications ?? []).forEach((lic, i) => {
    const name = s(lic.name);
    if (name && name.length > MAX_LENGTHS.licenseName) errors[`licenses.${i}.name`] = `Must be ${MAX_LENGTHS.licenseName} characters or fewer.`;
    if (name) {
      const expiryYear = s(lic.to_date?.year);
      if (!expiryYear) errors[`licenses.${i}.expiry`] = 'Expiry date is required.';
      else if (!YEAR_REGEX.test(expiryYear)) errors[`licenses.${i}.expiry`] = 'Expiry year must be 4 digits.';
    }
  });

  return errors;
}

/** Merge AI-suggested fields into form state (overwrite with suggested values). */
function mergeSuggestedIntoForm(
  prev: Partial<CandidateProfile>,
  s: ParsedResumeSuggestion
): Partial<CandidateProfile> {
  return {
    ...prev,
    ...(s.displayName != null && { displayName: String(s.displayName) }),
    ...(s.phone != null && { phone: String(s.phone) }),
    ...(s.summary != null && { summary: String(s.summary) }),
    ...(Array.isArray(s.skills) && { skills: s.skills.filter((x): x is string => typeof x === 'string') }),
    ...(Array.isArray(s.experience) && {
      experience: s.experience.map((e) => ({
        ...emptyExperience,
        organization: e.organization ?? '',
        job_title: e.job_title ?? '',
        location: e.location ?? '',
        from_date: { ...emptyDateRange, ...e.from_date },
        to_date: { ...emptyDateRange, ...e.to_date },
        description: e.description ?? '',
      })),
    }),
    ...(Array.isArray(s.education) && {
      education: s.education.map((e) => ({
        ...emptyEducation,
        institution: e.institution ?? '',
        degree: e.degree ?? '',
        field_of_study: e.field_of_study ?? '',
        from_date: { ...emptyDateRange, ...e.from_date },
        to_date: { ...emptyDateRange, ...e.to_date },
        description: e.description ?? '',
        honors: e.honors ?? '',
      })),
    }),
    ...(Array.isArray(s.licenses_and_certifications) && {
      licenses_and_certifications: s.licenses_and_certifications.map((l) => ({
        ...emptyLicense,
        name: l.name ?? '',
        institution: l.institution ?? undefined,
        from_date: l.from_date ? { ...emptyDateRange, ...l.from_date } : undefined,
        to_date: l.to_date ? { ...emptyDateRange, ...l.to_date } : undefined,
      })),
    }),
  };
}

export function CandidateProfilePage() {
  const currentUser = useCurrentUser();
  const { candidate, loading, error, saveProfile, refetch } = useCandidate();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseSuccess, setParseSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const locationJustSelectedRef = useRef(false);
  const locationWrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const displayEmail = candidate?.email ?? currentUser?.email ?? '';
  const [form, setForm] = useState<Partial<CandidateProfile>>({
    displayName: '',
    phone: '',
    bio: '',
    address: '',
    location: '',
    summary: '',
    skills: [],
    experience: [],
    education: [],
    licenses_and_certifications: [],
  });

  useEffect(() => {
    const query = (form.location ?? '').trim();
    if (query.length < NOMINATIM_MIN_QUERY) {
      setLocationSuggestions([]);
      setLocationDropdownOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      setLocationLoading(true);
      try {
        const list = await fetchLocationSuggestions(query);
        setLocationSuggestions(list);
        if (!locationJustSelectedRef.current) setLocationDropdownOpen(true);
      } finally {
        setLocationLoading(false);
      }
    }, NOMINATIM_DELAY_MS);
    return () => clearTimeout(t);
  }, [form.location]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (locationWrapperRef.current && !locationWrapperRef.current.contains(e.target as Node)) {
        setLocationDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!candidate) return;
    setForm({
      displayName: candidate.displayName ?? '',
      phone: candidate.phone ?? '',
      bio: candidate.bio ?? '',
      address: candidate.address ?? '',
      location: candidate.location ?? '',
      summary: candidate.summary ?? '',
      skills: candidate.skills?.length ? [...candidate.skills] : [],
      experience:
        candidate.experience?.length ?
          candidate.experience.map((e) => ({
            ...emptyExperience,
            ...e,
            from_date: { ...emptyDateRange, ...e.from_date },
            to_date: { ...emptyDateRange, ...e.to_date },
          }))
        : [],
      education:
        candidate.education?.length ?
          candidate.education.map((e) => ({
            ...emptyEducation,
            ...e,
            from_date: { ...emptyDateRange, ...e.from_date },
            to_date: { ...emptyDateRange, ...e.to_date },
          }))
        : [],
      licenses_and_certifications:
        candidate.licenses_and_certifications?.length ?
          candidate.licenses_and_certifications.map((l) => ({ ...emptyLicense, ...l }))
        : [],
    });
  }, [candidate]);

  const update = (key: keyof CandidateProfile, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    const k = key as string;
    if (validationErrors[k]) {
      setValidationErrors((e) => {
        const next = { ...e };
        delete next[k];
        return next;
      });
    }
  };

  const selectLocation = (value: string) => {
    update('location', value);
    locationJustSelectedRef.current = true;
    setLocationDropdownOpen(false);
    setLocationSuggestions([]);
    setTimeout(() => { locationJustSelectedRef.current = false; }, 100);
  };

  const handleSave = async () => {
    const errors = validateForm(form);
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSaveError('Please fix the errors below before saving.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await saveProfile(form);
      await refetch();
      setParseSuccess(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleFillFromResume = async () => {
    setParseError(null);
    setParseSuccess(false);
    setParsing(true);
    try {
      const { suggested } = await parseResume();
      setForm((prev) => mergeSuggestedIntoForm(prev, suggested));
      setParseSuccess(true);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Parse failed');
    } finally {
      setParsing(false);
    }
  };

  const handleResumeFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith('.pdf') && !name.endsWith('.docx')) {
      setUploadError('Please select a PDF or DOCX file.');
      return;
    }
    setUploadError(null);
    setUploadSuccess(false);
    setUploading(true);
    try {
      const { uploadUrl, key, contentType } = await getResumeUploadUrl(file.name);
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': contentType },
      });
      if (!putRes.ok) throw new Error('Upload failed');
      await recordResume(key);
      await refetch();
      setUploadSuccess(true);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const addExperience = () => {
    update('experience', [...(form.experience ?? []), { ...emptyExperience }]);
  };
  const removeExperience = (index: number) => {
    update(
      'experience',
      form.experience?.filter((_, i) => i !== index) ?? []
    );
  };
  const updateExperience = (index: number, field: keyof ExperienceItem, value: unknown) => {
    const list = [...(form.experience ?? [])];
    if (!list[index]) return;
    (list[index] as unknown as Record<string, unknown>)[field] = value;
    update('experience', list);
    setValidationErrors((e) => {
      const next = { ...e };
      Object.keys(next).filter((k) => k.startsWith(`experience.${index}`)).forEach((k) => delete next[k]);
      return next;
    });
  };

  const addEducation = () => {
    update('education', [...(form.education ?? []), { ...emptyEducation }]);
  };
  const removeEducation = (index: number) => {
    update('education', form.education?.filter((_, i) => i !== index) ?? []);
  };
  const updateEducation = (index: number, field: keyof EducationItem, value: unknown) => {
    const list = [...(form.education ?? [])];
    if (!list[index]) return;
    (list[index] as unknown as Record<string, unknown>)[field] = value;
    update('education', list);
    setValidationErrors((e) => {
      const next = { ...e };
      Object.keys(next).filter((k) => k.startsWith(`education.${index}`)).forEach((k) => delete next[k]);
      return next;
    });
  };

  const addLicense = () => {
    update('licenses_and_certifications', [
      ...(form.licenses_and_certifications ?? []),
      { ...emptyLicense },
    ]);
  };
  const removeLicense = (index: number) => {
    update(
      'licenses_and_certifications',
      form.licenses_and_certifications?.filter((_, i) => i !== index) ?? []
    );
  };
  const updateLicense = (index: number, field: keyof LicenseCertItem, value: unknown) => {
    const list = [...(form.licenses_and_certifications ?? [])];
    if (!list[index]) return;
    (list[index] as unknown as Record<string, unknown>)[field] = value;
    update('licenses_and_certifications', list);
    setValidationErrors((e) => {
      const next = { ...e };
      Object.keys(next).filter((k) => k.startsWith(`licenses.${index}`)).forEach((k) => delete next[k]);
      return next;
    });
  };

  const addSkill = () => {
    update('skills', [...(form.skills ?? []), '']);
  };
  const removeSkill = (index: number) => {
    update('skills', form.skills?.filter((_, i) => i !== index) ?? []);
  };
  const updateSkill = (index: number, value: string) => {
    const list = [...(form.skills ?? [])];
    list[index] = value;
    update('skills', list);
    if (validationErrors[`skills.${index}`]) {
      setValidationErrors((e) => {
        const next = { ...e };
        delete next[`skills.${index}`];
        return next;
      });
    }
  };

  const MONTHS = [
    '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  if (loading && !candidate) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-500">Loading profile…</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {(error || saveError) && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error ?? saveError}
        </div>
      )}

      {/* Resume upload */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Resume</h2>
        {candidate?.resumeUploadedAt && (
          <p className="text-sm text-gray-600 mb-3">
            Resume uploaded on {new Date(candidate.resumeUploadedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
          </p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx"
          onChange={handleResumeFileChange}
          className="hidden"
          aria-label="Select resume file"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : candidate?.resumeUploadedAt ? 'Replace resume' : 'Upload resume (PDF or DOCX)'}
          </button>
          {candidate?.resumeUploadedAt && (
            <button
              type="button"
              onClick={handleFillFromResume}
              disabled={parsing}
              className="px-4 py-2 bg-gray-700 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50"
            >
              {parsing ? 'Parsing…' : 'Fill from resume'}
            </button>
          )}
        </div>
        {uploadError && (
          <p className="mt-2 text-sm text-red-600" role="alert">{uploadError}</p>
        )}
        {uploadSuccess && (
          <p className="mt-2 text-sm text-green-600">Resume uploaded successfully.</p>
        )}
        {parseError && (
          <p className="mt-2 text-sm text-red-600" role="alert">{parseError}</p>
        )}
        {parseSuccess && (
          <p className="mt-2 text-sm text-green-600">Profile filled from resume. Review and save when ready.</p>
        )}
      </section>

      {/* Contact */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Contact</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full name <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.displayName ?? ''}
              onChange={(e) => update('displayName', e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm ${validationErrors.displayName ? 'border-red-500' : 'border-gray-300'}`}
              placeholder="Your name"
              aria-invalid={!!validationErrors.displayName}
              aria-describedby={validationErrors.displayName ? 'err-displayName' : undefined}
            />
            {validationErrors.displayName && (
              <p id="err-displayName" className="mt-1 text-sm text-red-600" role="alert">{validationErrors.displayName}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={displayEmail}
              readOnly
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              value={form.phone ?? ''}
              onChange={(e) => update('phone', e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm ${validationErrors.phone ? 'border-red-500' : 'border-gray-300'}`}
              placeholder="+1 234 567 8900"
              aria-invalid={!!validationErrors.phone}
            />
            {validationErrors.phone && (
              <p className="mt-1 text-sm text-red-600" role="alert">{validationErrors.phone}</p>
            )}
          </div>
          <div ref={locationWrapperRef} className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Location <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.location ?? ''}
              onChange={(e) => {
                update('location', e.target.value);
                locationJustSelectedRef.current = false;
              }}
              onFocus={() => {
                if (locationSuggestions.length > 0) setLocationDropdownOpen(true);
              }}
              className={`w-full rounded-lg border px-3 py-2 text-sm ${validationErrors.location ? 'border-red-500' : 'border-gray-300'}`}
              placeholder="Start typing city, state (e.g. Austin, TX)"
              aria-invalid={!!validationErrors.location}
              aria-autocomplete="list"
              aria-controls="location-listbox"
              aria-expanded={locationDropdownOpen}
              role="combobox"
            />
            {locationDropdownOpen && (locationSuggestions.length > 0 || locationLoading) && (
              <ul
                id="location-listbox"
                role="listbox"
                className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white py-1 shadow-lg max-h-48 overflow-auto"
              >
                {locationLoading && locationSuggestions.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-gray-500">Searching…</li>
                ) : (
                  locationSuggestions.map((suggestion, i) => (
                    <li
                      key={`${suggestion}-${i}`}
                      role="option"
                      tabIndex={-1}
                      className="cursor-pointer px-3 py-2 text-sm text-gray-900 hover:bg-amber-50 focus:bg-amber-50"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectLocation(suggestion);
                      }}
                    >
                      {suggestion}
                    </li>
                  ))
                )}
              </ul>
            )}
            {validationErrors.location && (
              <p className="mt-1 text-sm text-red-600" role="alert">{validationErrors.location}</p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input
              type="text"
              value={form.address ?? ''}
              onChange={(e) => update('address', e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm ${validationErrors.address ? 'border-red-500' : 'border-gray-300'}`}
              placeholder="Street address"
              aria-invalid={!!validationErrors.address}
            />
            {validationErrors.address && (
              <p className="mt-1 text-sm text-red-600" role="alert">{validationErrors.address}</p>
            )}
          </div>
        </div>
      </section>

      {/* Professional Summary */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Professional Summary</h2>
        <textarea
          value={form.summary ?? ''}
          onChange={(e) => update('summary', e.target.value)}
          rows={4}
          className={`w-full rounded-lg border px-3 py-2 text-sm ${validationErrors.summary ? 'border-red-500' : 'border-gray-300'}`}
          placeholder="Brief summary of your experience and goals"
          aria-invalid={!!validationErrors.summary}
        />
        {validationErrors.summary && (
          <p className="mt-1 text-sm text-red-600" role="alert">{validationErrors.summary}</p>
        )}
      </section>

      {/* Skills */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Skills</h2>
        <div className="space-y-2">
          {(form.skills ?? []).map((skill, i) => (
            <div key={i} className="flex gap-2">
              <div className="flex-1">
                <input
                  type="text"
                  value={skill}
                  onChange={(e) => updateSkill(i, e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm ${validationErrors[`skills.${i}`] ? 'border-red-500' : 'border-gray-300'}`}
                  placeholder="Skill"
                  aria-invalid={!!validationErrors[`skills.${i}`]}
                />
                {validationErrors[`skills.${i}`] && (
                  <p className="mt-1 text-sm text-red-600" role="alert">{validationErrors[`skills.${i}`]}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeSkill(i)}
                className="text-red-600 hover:text-red-700 p-2"
                aria-label="Remove skill"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addSkill}
          className="mt-2 text-sm text-amber-600 hover:text-amber-700 font-medium"
        >
          + Add skill
        </button>
      </section>

      {/* Experience */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Experience</h2>
        <div className="space-y-4">
          {(form.experience ?? []).map((exp, i) => (
            <div key={i} className={`border rounded-lg p-4 space-y-3 ${validationErrors[`experience.${i}`] || validationErrors[`experience.${i}.fromYear`] || validationErrors[`experience.${i}.toYear`] ? 'border-red-300 bg-red-50/50' : 'border-gray-200'}`}>
              <div className="flex justify-between">
                <span className="text-sm font-medium text-gray-500">Experience #{i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeExperience(i)}
                  className="text-red-600 hover:text-red-700 text-sm"
                >
                  Remove
                </button>
              </div>
              {(validationErrors[`experience.${i}`] || validationErrors[`experience.${i}.fromYear`] || validationErrors[`experience.${i}.toYear`]) && (
                <p className="text-sm text-red-600" role="alert">
                  {validationErrors[`experience.${i}`] ?? validationErrors[`experience.${i}.fromYear`] ?? validationErrors[`experience.${i}.toYear`]}
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Organization</label>
                  <input
                    type="text"
                    value={exp.organization}
                    onChange={(e) => updateExperience(i, 'organization', e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Job title</label>
                  <input
                    type="text"
                    value={exp.job_title}
                    onChange={(e) => updateExperience(i, 'job_title', e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-500 mb-0.5">Location</label>
                  <input
                    type="text"
                    value={exp.location}
                    onChange={(e) => updateExperience(i, 'location', e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">From (month / year)</label>
                  <div className="flex gap-2">
                    <select
                      value={exp.from_date?.month ?? ''}
                      onChange={(e) =>
                        updateExperience(i, 'from_date', {
                          ...exp.from_date,
                          month: e.target.value,
                          year: exp.from_date?.year,
                        })
                      }
                      className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      {MONTHS.map((m, j) => (
                        <option key={j} value={j === 0 ? '' : String(j)}>{m || '—'}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={exp.from_date?.year ?? ''}
                      onChange={(e) =>
                        updateExperience(i, 'from_date', {
                          ...exp.from_date,
                          year: e.target.value,
                          month: exp.from_date?.month,
                        })
                      }
                      placeholder="Year"
                      className="w-20 rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">To (month / year)</label>
                  <div className="flex gap-2">
                    <select
                      value={exp.to_date?.month ?? ''}
                      onChange={(e) =>
                        updateExperience(i, 'to_date', {
                          ...exp.to_date,
                          month: e.target.value,
                          year: exp.to_date?.year,
                        })
                      }
                      className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      {MONTHS.map((m, j) => (
                        <option key={j} value={j === 0 ? '' : String(j)}>{m || '—'}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={exp.to_date?.year ?? ''}
                      onChange={(e) =>
                        updateExperience(i, 'to_date', {
                          ...exp.to_date,
                          year: e.target.value,
                          month: exp.to_date?.month,
                        })
                      }
                      placeholder="Year"
                      className="w-20 rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-500 mb-0.5">Description</label>
                  <textarea
                    value={exp.description}
                    onChange={(e) => updateExperience(i, 'description', e.target.value)}
                    rows={2}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addExperience}
          className="mt-2 text-sm text-amber-600 hover:text-amber-700 font-medium"
        >
          + Add experience
        </button>
      </section>

      {/* Education */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Education</h2>
        <div className="space-y-4">
          {(form.education ?? []).map((edu, i) => (
            <div key={i} className={`border rounded-lg p-4 space-y-3 ${validationErrors[`education.${i}`] || validationErrors[`education.${i}.fromYear`] || validationErrors[`education.${i}.toYear`] ? 'border-red-300 bg-red-50/50' : 'border-gray-200'}`}>
              <div className="flex justify-between">
                <span className="text-sm font-medium text-gray-500">Education #{i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeEducation(i)}
                  className="text-red-600 hover:text-red-700 text-sm"
                >
                  Remove
                </button>
              </div>
              {(validationErrors[`education.${i}`] || validationErrors[`education.${i}.fromYear`] || validationErrors[`education.${i}.toYear`]) && (
                <p className="text-sm text-red-600" role="alert">
                  {validationErrors[`education.${i}`] ?? validationErrors[`education.${i}.fromYear`] ?? validationErrors[`education.${i}.toYear`]}
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Institution</label>
                  <input
                    type="text"
                    value={edu.institution}
                    onChange={(e) => updateEducation(i, 'institution', e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Degree</label>
                  <input
                    type="text"
                    value={edu.degree}
                    onChange={(e) => updateEducation(i, 'degree', e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Field of study</label>
                  <input
                    type="text"
                    value={edu.field_of_study ?? ''}
                    onChange={(e) => updateEducation(i, 'field_of_study', e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Honors</label>
                  <input
                    type="text"
                    value={edu.honors ?? ''}
                    onChange={(e) => updateEducation(i, 'honors', e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">From (month / year)</label>
                  <div className="flex gap-2">
                    <select
                      value={edu.from_date?.month ?? ''}
                      onChange={(e) =>
                        updateEducation(i, 'from_date', {
                          ...edu.from_date,
                          month: e.target.value,
                          year: edu.from_date?.year,
                        })
                      }
                      className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      {MONTHS.map((m, j) => (
                        <option key={j} value={j === 0 ? '' : String(j)}>{m || '—'}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={edu.from_date?.year ?? ''}
                      onChange={(e) =>
                        updateEducation(i, 'from_date', {
                          ...edu.from_date,
                          year: e.target.value,
                          month: edu.from_date?.month,
                        })
                      }
                      placeholder="Year"
                      className="w-20 rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">To (month / year)</label>
                  <div className="flex gap-2">
                    <select
                      value={edu.to_date?.month ?? ''}
                      onChange={(e) =>
                        updateEducation(i, 'to_date', {
                          ...edu.to_date,
                          month: e.target.value,
                          year: edu.to_date?.year,
                        })
                      }
                      className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      {MONTHS.map((m, j) => (
                        <option key={j} value={j === 0 ? '' : String(j)}>{m || '—'}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={edu.to_date?.year ?? ''}
                      onChange={(e) =>
                        updateEducation(i, 'to_date', {
                          ...edu.to_date,
                          year: e.target.value,
                          month: edu.to_date?.month,
                        })
                      }
                      placeholder="Year"
                      className="w-20 rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-500 mb-0.5">Description</label>
                  <textarea
                    value={edu.description ?? ''}
                    onChange={(e) => updateEducation(i, 'description', e.target.value)}
                    rows={2}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addEducation}
          className="mt-2 text-sm text-amber-600 hover:text-amber-700 font-medium"
        >
          + Add education
        </button>
      </section>

      {/* Licenses & Certifications */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Licenses & Certifications</h2>
        <div className="space-y-4">
          {(form.licenses_and_certifications ?? []).map((lic, i) => (
            <div key={i} className={`border rounded-lg p-4 flex flex-col gap-3 ${validationErrors[`licenses.${i}.name`] || validationErrors[`licenses.${i}.expiry`] ? 'border-red-300 bg-red-50/50' : 'border-gray-200'}`}>
              {(validationErrors[`licenses.${i}.name`] || validationErrors[`licenses.${i}.expiry`]) && (
                <p className="text-sm text-red-600" role="alert">
                  {validationErrors[`licenses.${i}.name`] ?? validationErrors[`licenses.${i}.expiry`]}
                </p>
              )}
              <div className="flex gap-3 flex-wrap items-end">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-xs text-gray-500 mb-0.5">Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={lic.name}
                    onChange={(e) => updateLicense(i, 'name', e.target.value)}
                    placeholder="Name of license or certification"
                    className={`w-full rounded border px-2 py-1.5 text-sm ${validationErrors[`licenses.${i}.name`] ? 'border-red-500' : 'border-gray-300'}`}
                    aria-invalid={!!validationErrors[`licenses.${i}.name`]}
                  />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-xs text-gray-500 mb-0.5">Issuing institution</label>
                  <input
                    type="text"
                    value={lic.institution ?? ''}
                    onChange={(e) => updateLicense(i, 'institution', e.target.value)}
                    placeholder="Issuing institution"
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Expiry date <span className="text-red-500">*</span></label>
                  <div className="flex gap-2">
                    <select
                      value={lic.to_date?.month ?? ''}
                      onChange={(e) =>
                        updateLicense(i, 'to_date', {
                          ...lic.to_date,
                          month: e.target.value,
                          year: lic.to_date?.year,
                        })
                      }
                      className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      {MONTHS.map((m, j) => (
                        <option key={j} value={j === 0 ? '' : String(j)}>{m || '—'}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={lic.to_date?.year ?? ''}
                      onChange={(e) =>
                        updateLicense(i, 'to_date', {
                          ...lic.to_date,
                          year: e.target.value,
                          month: lic.to_date?.month,
                        })
                      }
                      placeholder="Year"
                      className="w-20 rounded border border-gray-300 px-2 py-1.5 text-sm"
                      aria-invalid={!!validationErrors[`licenses.${i}.expiry`]}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeLicense(i)}
                  className="text-red-600 hover:text-red-700 text-sm"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addLicense}
          className="mt-2 text-sm text-amber-600 hover:text-amber-700 font-medium"
        >
          + Add license or certification
        </button>
      </section>
    </div>
  );
}
