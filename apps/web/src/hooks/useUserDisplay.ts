import { useEffect, useState } from 'react';
import { fetchUserAttributes } from 'aws-amplify/auth';
import { useHospitals } from './useHospitals';

export type DisplayRole = 'Candidate' | 'Recruiter' | null;

export interface UserDisplayInfo {
  email: string;
  role: DisplayRole;
  hospitalName: string | null;
  isLoading: boolean;
}

/**
 * Fetches current user's email, role (custom:role), and hospital name (for recruiters)
 * for display in the navbar. Uses username as email (email login) and
 * fetchUserAttributes for custom:role and custom:organizationId.
 */
export function useUserDisplay(username: string | undefined): UserDisplayInfo {
  const [email, setEmail] = useState<string>(username ?? '');
  const [role, setRole] = useState<DisplayRole>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [attrsLoading, setAttrsLoading] = useState(true);
  const { hospitals } = useHospitals();

  useEffect(() => {
    if (!username) {
      setEmail('');
      setAttrsLoading(false);
      return;
    }
    let cancelled = false;
    setAttrsLoading(true);
    setEmail(username); // fallback until attributes load
    fetchUserAttributes()
      .then((attrs) => {
        if (cancelled) return;
        const emailAttr = attrs['email'] as string | undefined;
        if (emailAttr) setEmail(emailAttr);
        const r = attrs['custom:role'] as string | undefined;
        const oid = attrs['custom:organizationId'] as string | undefined;
        setRole(r === 'recruiter' ? 'Recruiter' : r === 'candidate' ? 'Candidate' : null);
        setOrganizationId(oid ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setRole(null);
          setOrganizationId(null);
        }
      })
      .finally(() => {
        if (!cancelled) setAttrsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  const hospitalName =
    role === 'Recruiter' && organizationId
      ? hospitals.find((h) => h.hospitalId === organizationId)?.name ?? null
      : null;

  return {
    email,
    role,
    hospitalName,
    isLoading: attrsLoading,
  };
}
