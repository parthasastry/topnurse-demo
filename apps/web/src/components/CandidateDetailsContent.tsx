import type { CandidateProfile } from '@/types/candidate';
import type { ExperienceItem, EducationItem, LicenseCertItem } from '@/types/candidate';

function formatDateRange(from?: { month?: string; year?: string }, to?: { month?: string; year?: string }): string {
  const f = from?.year ?? from?.month ?? '—';
  const t = to?.year ?? to?.month ?? '—';
  return `${f} – ${t}`;
}

/** Shared candidate profile body (contact, summary, skills, experience, education, licenses). */
export function CandidateDetailsContent({ candidate }: { candidate: CandidateProfile }) {
  const { experience, education, licenses_and_certifications } = candidate;
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">Contact</h3>
        <p className="text-gray-900">{candidate.email}</p>
        {candidate.phone && <p className="text-gray-700">{candidate.phone}</p>}
        {candidate.location && <p className="text-gray-700">{candidate.location}</p>}
        {candidate.address && <p className="text-gray-600 text-sm">{candidate.address}</p>}
      </section>
      {candidate.summary && (
        <section>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">Summary</h3>
          <p className="text-gray-700 whitespace-pre-wrap">{candidate.summary}</p>
        </section>
      )}
      {candidate.skills && candidate.skills.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">Skills</h3>
          <div className="flex flex-wrap gap-1">
            {candidate.skills.map((s) => (
              <span key={s} className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                {s}
              </span>
            ))}
          </div>
        </section>
      )}
      {experience && experience.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">Experience</h3>
          <ul className="space-y-3">
            {experience.map((exp: ExperienceItem, i: number) => (
              <li key={i} className="border-l-2 border-amber-200 pl-3">
                <p className="font-medium text-gray-900">{exp.job_title} at {exp.organization}</p>
                <p className="text-sm text-gray-600">{exp.location} · {formatDateRange(exp.from_date, exp.to_date)}</p>
                {exp.description && <p className="text-sm text-gray-700 mt-1">{exp.description}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {education && education.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">Education</h3>
          <ul className="space-y-3">
            {education.map((ed: EducationItem, i: number) => (
              <li key={i} className="border-l-2 border-amber-200 pl-3">
                <p className="font-medium text-gray-900">{ed.degree}{ed.field_of_study ? `, ${ed.field_of_study}` : ''} · {ed.institution}</p>
                <p className="text-sm text-gray-600">{formatDateRange(ed.from_date, ed.to_date)}</p>
                {ed.description && <p className="text-sm text-gray-700 mt-1">{ed.description}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {licenses_and_certifications && licenses_and_certifications.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">Licenses & certifications</h3>
          <ul className="space-y-2">
            {licenses_and_certifications.map((lic: LicenseCertItem, i: number) => (
              <li key={i} className="text-gray-700">
                {lic.name}
                {lic.institution && ` · ${lic.institution}`}
                {(lic.from_date || lic.to_date) && ` · ${formatDateRange(lic.from_date, lic.to_date)}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
