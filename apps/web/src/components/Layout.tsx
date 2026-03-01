import { Outlet, NavLink } from 'react-router-dom';
import { useUserDisplay } from '@/hooks/useUserDisplay';
import { CurrentUserProvider } from '@/context/CurrentUserContext';

interface LayoutProps {
  signOut: (() => void) | undefined;
  username: string | undefined;
}

export function Layout({ signOut, username }: LayoutProps) {
  const { email, role, hospitalName, isLoading } = useUserDisplay(username);
  const roleLabel = role ?? 'User';
  const displayText = isLoading
    ? email || '…'
    : email
      ? hospitalName
        ? `${email} (${roleLabel}) ${hospitalName}`
        : `${email} (${roleLabel})`
      : '';

  const navItems =
    role === 'Candidate'
      ? [{ to: '/', label: 'Home' }, { to: '/profile', label: 'My Profile' }]
      : role === 'Recruiter'
        ? [
            { to: '/', label: 'Home' },
            { to: '/jobs', label: 'Jobs' },
            { to: '/candidates', label: 'Candidates' },
          ]
        : [{ to: '/', label: 'Home' }];

  const currentUser = { email, role, hospitalName };

  return (
    <CurrentUserProvider value={currentUser}>
      <div className="min-h-screen bg-gray-50 flex">
        <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">
          <div className="p-4 border-b border-gray-200">
            <NavLink to="/" className="flex items-center gap-2 text-xl font-semibold text-gray-900">
              <img src="/favicon.svg" alt="" className="w-7 h-7 shrink-0" aria-hidden />
              TopNurse
            </NavLink>
          </div>
          <nav className="p-2 flex flex-col gap-1">
            {navItems.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-amber-50 text-amber-800'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto p-4 border-t border-gray-200">
            <span className="text-xs text-gray-500 block truncate" title={displayText}>
              {displayText}
            </span>
            <button
              type="button"
              onClick={() => signOut?.()}
              className="mt-2 text-sm font-medium text-red-600 hover:text-red-700"
            >
              Sign out
            </button>
          </div>
        </aside>
        <div className="flex-1 flex flex-col min-w-0">
          <header className="bg-white border-b border-gray-200 px-6 py-3 shrink-0">
            <span className="text-sm text-gray-600 truncate block">{displayText}</span>
          </header>
          <main className="flex-1 overflow-auto p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </CurrentUserProvider>
  );
}
