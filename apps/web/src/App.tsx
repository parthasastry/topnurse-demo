import { useRef, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Authenticator } from '@aws-amplify/ui-react';
import { signUp } from 'aws-amplify/auth';
import type { SignUpInput } from 'aws-amplify/auth';
import { SignUpRoleAndHospital } from '@/components/SignUpRoleAndHospital';
import { SignUpFormStateProvider, useSignUpFormState } from '@/context/SignUpFormStateContext';
import { Layout } from '@/components/Layout';
import { HomePage } from '@/pages/HomePage';
import { CandidateProfilePage } from '@/pages/CandidateProfilePage';
import { CandidatesPage } from '@/pages/CandidatesPage';
import { CandidateDetailPage } from '@/pages/CandidateDetailPage';
import { JobsPage } from '@/pages/JobsPage';
import { JobCandidatesPage } from '@/pages/JobCandidatesPage';
import { useCurrentUser } from '@/context/CurrentUserContext';

/** Renders candidate profile only for Candidate role; redirects others to home. */
function CandidateProfileRoute() {
  const user = useCurrentUser();
  if (user?.role !== 'Candidate') return <Navigate to="/" replace />;
  return <CandidateProfilePage />;
}

/** Renders jobs page only for Recruiter role; redirects others to home. */
function JobsRoute() {
  const user = useCurrentUser();
  if (user?.role !== 'Recruiter') return <Navigate to="/" replace />;
  return <JobsPage />;
}

/** Renders find-candidates page for a job (Recruiter only). */
function JobCandidatesRoute() {
  const user = useCurrentUser();
  if (user?.role !== 'Recruiter') return <Navigate to="/" replace />;
  return <JobCandidatesPage />;
}

/** Renders candidates list only for Recruiter role; redirects others to home. */
function CandidatesRoute() {
  const user = useCurrentUser();
  if (user?.role !== 'Recruiter') return <Navigate to="/" replace />;
  return <CandidatesPage />;
}

/** Renders single candidate by email (recruiter only). */
function CandidateDetailRoute() {
  const user = useCurrentUser();
  if (user?.role !== 'Recruiter') return <Navigate to="/" replace />;
  return <CandidateDetailPage />;
}

function AuthenticatorWithStableConfig() {
  const { value: signUpExtra } = useSignUpFormState();
  const signUpExtraRef = useRef(signUpExtra);
  signUpExtraRef.current = signUpExtra;

  const services = useMemo(
    () => ({
      async handleSignUp(input: SignUpInput) {
        const role = signUpExtraRef.current.role;
        if (role !== 'candidate' && role !== 'recruiter') {
          throw new Error('Please select your role.');
        }
        const userAttributes: Record<string, string> = {
          ...(input.options?.userAttributes ?? {}),
          'custom:role': role,
        };
        if (role === 'recruiter' && signUpExtraRef.current.organizationId) {
          userAttributes['custom:organizationId'] = signUpExtraRef.current.organizationId;
        }
        return signUp({
          username: input.username,
          password: input.password,
          options: {
            ...input.options,
            userAttributes,
          },
        });
      },
      async validateCustomSignUp(formData: Record<string, string | undefined>) {
        const current = signUpExtraRef.current;
        const role = (formData['custom:role'] ?? current.role) as string;
        const organizationId = formData['custom:organizationId'] ?? current.organizationId;
        // Only validate hospital when recruiter; role is enforced in handleSignUp so button stays enabled
        if (role === 'recruiter' && !organizationId) {
          return { 'custom:organizationId': 'Please select your hospital.' };
        }
        return undefined;
      },
    }),
    []
  );

  const components = useMemo(
    () => ({
      SignUp: {
        FormFields() {
          return <SignUpRoleAndHospital />;
        },
      },
    }),
    []
  );

  return (
    <Authenticator
      loginMechanisms={['email']}
      components={components}
      services={services}
    >
      {({ signOut, user }) => (
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Layout signOut={signOut} username={user?.username} />}>
              <Route index element={<HomePage />} />
              <Route path="profile" element={<CandidateProfileRoute />} />
              <Route path="jobs" element={<JobsRoute />} />
              <Route path="jobs/:jobId/candidates" element={<JobCandidatesRoute />} />
              <Route path="candidates" element={<CandidatesRoute />} />
              <Route path="candidates/:email" element={<CandidateDetailRoute />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      )}
    </Authenticator>
  );
}

function App() {
  return (
    <SignUpFormStateProvider>
      <AuthenticatorWithStableConfig />
    </SignUpFormStateProvider>
  );
}

export default App;
