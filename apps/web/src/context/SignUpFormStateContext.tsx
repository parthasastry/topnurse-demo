import { createContext, useContext, useMemo, useState } from 'react';
import type { SignUpRoleAndHospitalValue } from '@/components/SignUpRoleAndHospital';

const defaultState: SignUpRoleAndHospitalValue = {
  role: '',
  organizationId: '',
};

const SignUpFormStateContext = createContext<{
  value: SignUpRoleAndHospitalValue;
  setValue: React.Dispatch<React.SetStateAction<SignUpRoleAndHospitalValue>>;
} | null>(null);

export function SignUpFormStateProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<SignUpRoleAndHospitalValue>(defaultState);
  const ctx = useMemo(() => ({ value, setValue }), [value]);
  return (
    <SignUpFormStateContext.Provider value={ctx}>
      {children}
    </SignUpFormStateContext.Provider>
  );
}

export function useSignUpFormState() {
  const ctx = useContext(SignUpFormStateContext);
  if (!ctx) throw new Error('useSignUpFormState must be used within SignUpFormStateProvider');
  return ctx;
}
