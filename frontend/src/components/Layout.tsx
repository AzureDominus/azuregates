import { ReactNode, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, Settings, FileText, Shield, LogIn, LogOut, User, Users, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth';

interface LayoutProps {
  children: ReactNode;
}

const navItems = [
  { path: '/', label: 'Dashboard', icon: Home },
  { path: '/invites', label: 'Guest Access', icon: Users, requireAdmin: true },
  { path: '/admin', label: 'Admin', icon: ShieldCheck, requireAdmin: true },
  { path: '/settings', label: 'Settings', icon: Settings, requireAdmin: true },
  { path: '/audit', label: 'Audit Logs', icon: FileText, requireAdmin: true },
];

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, isGuest, isLoading, isPending, isDisabled, login, logout } = useAuth();

  // Redirect pending/disabled accounts to appropriate pages
  useEffect(() => {
    if (isLoading) return;
    
    if (isPending) {
      navigate('/pending-approval', { replace: true });
    } else if (isDisabled) {
      navigate('/account-disabled', { replace: true });
    }
  }, [isPending, isDisabled, isLoading, navigate]);

  // Filter nav items based on auth status
  const visibleNavItems = navItems.filter((item) => {
    // Hide admin-only items from non-admins
    if (item.requireAdmin && !user?.isAdmin) return false;
    return true;
  });

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-xl font-bold">
            <Shield className="w-6 h-6 text-blue-400" />
            <span>Gates</span>
          </Link>
          
          <div className="flex items-center gap-4">
            <nav className="flex gap-2">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            {/* Auth section */}
            <div className="flex items-center gap-2 border-l border-gray-600 pl-4">
              {isLoading ? (
                <span className="text-gray-500 text-sm">...</span>
              ) : isAuthenticated ? (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-4 h-4 text-gray-400" />
                    <span className="hidden md:inline text-gray-300">
                      {user?.displayName || user?.email || 'User'}
                    </span>
                    {isGuest && (
                      <span className="text-xs bg-yellow-600 px-1.5 py-0.5 rounded">Guest</span>
                    )}
                  </div>
                  <button
                    onClick={() => logout()}
                    className="flex items-center gap-1 px-2 py-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                    title="Sign out"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => login()}
                  className="flex items-center gap-2 px-3 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <LogIn className="w-4 h-4" />
                  <span className="hidden sm:inline">Sign in</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 p-4 max-w-7xl mx-auto w-full">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-gray-800 border-t border-gray-700 px-4 py-3 text-center text-sm text-gray-400">
        Gates v0.1.0 • Local Control
      </footer>
    </div>
  );
}
