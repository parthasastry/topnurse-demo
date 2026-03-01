import { useCurrentUser } from '@/context/CurrentUserContext';

export function HomePage() {
  const user = useCurrentUser();
  const role = user?.role ?? null;

  return (
    <div className="max-w-2xl">
      <p className="text-gray-600 mb-4">
        React + Tailwind + Amplify UI — Multi-tenant LinkedIn for Nurses
      </p>
      {role === 'Candidate' && (
        <p className="text-sm text-gray-500">
          Use <strong>My Profile</strong> in the left menu to fill in your nurse details.
        </p>
      )}
      {role === 'Recruiter' && (
        <p className="text-sm text-gray-500">
          Use <strong>Jobs</strong> to create and manage job postings, and <strong>Candidates</strong> to view candidate profiles (read-only).
        </p>
      )}
    </div>
  );
}
