import { createContext, useContext, type ReactNode } from 'react';
import type { DisplayRole } from '@/hooks/useUserDisplay';

interface CurrentUser {
  email: string;
  role: DisplayRole;
  hospitalName: string | null;
}

const CurrentUserContext = createContext<CurrentUser | null>(null);

export function CurrentUserProvider({
  value,
  children,
}: {
  value: CurrentUser;
  children: ReactNode;
}) {
  return (
    <CurrentUserContext.Provider value={value}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser(): CurrentUser | null {
  return useContext(CurrentUserContext);
}
