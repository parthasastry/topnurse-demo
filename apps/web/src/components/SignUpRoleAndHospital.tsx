import { Authenticator } from '@aws-amplify/ui-react';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { useHospitals } from '@/hooks/useHospitals';
import { HospitalSearchSelect } from './HospitalSearchSelect';
import { useSignUpFormState } from '@/context/SignUpFormStateContext';

export type SignUpRole = 'candidate' | 'recruiter';

export interface SignUpRoleAndHospitalValue {
  role: SignUpRole | '';
  organizationId: string;
}

export function SignUpRoleAndHospital() {
  const { value, setValue } = useSignUpFormState();
  const { validationErrors, updateForm } = useAuthenticator();
  const { hospitals, isLoading, error } = useHospitals();

  const handleRoleChange = (role: SignUpRoleAndHospitalValue['role']) => {
    const next = {
      ...value,
      role,
      organizationId: role === 'recruiter' ? value.organizationId : '',
    };
    setValue(next);
    updateForm({ name: 'custom:role', value: role });
    if (role !== 'recruiter') {
      updateForm({ name: 'custom:organizationId', value: '' });
    }
  };

  const handleHospitalChange = (organizationId: string) => {
    const next = { ...value, organizationId };
    setValue(next);
    updateForm({ name: 'custom:organizationId', value: organizationId });
  };

  return (
    <>
      <Authenticator.SignUp.FormFields />
      {/* Hidden inputs so Amplify form state includes our fields and re-validates when they change */}
      <input type="hidden" name="custom:role" value={value.role} readOnly aria-hidden />
      <input type="hidden" name="custom:organizationId" value={value.organizationId} readOnly aria-hidden />
      <div className="flex flex-col gap-4 [.amplify-flex]:mt-4">
        <div>
          <label htmlFor="signup-role" className="text-sm font-medium text-gray-700 block mb-2">
            I am signing up as <span className="text-red-500">*</span>
          </label>
          <select
            id="signup-role"
            value={value.role}
            onChange={(e) => handleRoleChange(e.target.value as SignUpRoleAndHospitalValue['role'])}
            required
            aria-required="true"
            aria-invalid={!!(validationErrors['custom:role'] as string | undefined)}
            aria-describedby={validationErrors['custom:role'] ? 'signup-role-error' : undefined}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 invalid:text-gray-500"
          >
            <option value="">
              Select your role
            </option>
            <option value="candidate">Candidate</option>
            <option value="recruiter">Recruiter</option>
          </select>
          {(validationErrors['custom:role'] as string | undefined) && (
            <p id="signup-role-error" className="mt-1 text-sm text-red-600" role="alert">
              {validationErrors['custom:role'] as string}
            </p>
          )}
        </div>
        {value.role === 'recruiter' && (
          <HospitalSearchSelect
            hospitals={hospitals}
            isLoading={isLoading}
            value={value.organizationId}
            onChange={handleHospitalChange}
            label="Hospital"
            placeholder="Search and select your hospital"
            required
            errorMessage={
              (validationErrors['custom:organizationId'] as string | undefined) ?? error ?? undefined
            }
          />
        )}
      </div>
    </>
  );
}
