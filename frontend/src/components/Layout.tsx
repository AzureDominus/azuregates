import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { Icon } from '@iconify/react';
import { useAuth } from '../lib/auth';
import { StatusLight } from './ui';

interface LayoutProps {
  children: ReactNode;
}

const navItems = [
  { path: '/', label: 'Dashboard', icon: 'ph:house-fill' },
  { path: '/invites', label: 'Guest Access', icon: 'ph:users-fill', requireAdmin: true },
  { path: '/admin', label: 'Admin', icon: 'ph:shield-check-fill', requireAdmin: true },
  { path: '/settings', label: 'Settings', icon: 'ph:gear-fill', requireAdmin: true },
  { path: '/audit', label: 'Audit Logs', icon: 'ph:file-text-fill', requireAdmin: true },
];

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, isGuest, isLoading, isPending, isDisabled, login, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Redirect pending/disabled accounts to appropriate pages
  useEffect(() => {
    if (isLoading) return;
    
    if (isPending) {
      navigate({ to: '/pending-approval', replace: true });
    } else if (isDisabled) {
      navigate({ to: '/account-disabled', replace: true });
    }
  }, [isPending, isDisabled, isLoading, navigate]);

  // Filter nav items based on auth status
  const visibleNavItems = navItems.filter((item) => {
    // Hide admin-only items from non-admins
    if (item.requireAdmin && !user?.isAdmin) return false;
    return true;
  });

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Ambient Background Glow */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none z-[-1]">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-secondary/5 blur-[120px] animate-pulse-slow" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[120px] animate-pulse-slow" style={{ animationDelay: '1.5s' }} />
      </div>

      {/* Header */}
      <header className="sticky top-4 z-50 mx-4 mt-4 rounded-2xl glass-panel px-4 sm:px-6 py-4 transition-all duration-300">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-surfaceHighlight border border-white/10 group-hover:border-primary/50 transition-colors">
              <Icon icon="ph:shield-fill" className="w-6 h-6 text-primary drop-shadow-[0_0_8px_rgba(255,170,0,0.5)]" />
            </div>
            <div className="flex flex-col">
              <span className="font-display font-bold text-2xl tracking-wide text-white leading-none">GATES</span>
              <span className="text-[10px] font-mono text-gray-400 tracking-[0.2em] uppercase hidden sm:block">System Control</span>
            </div>
          </Link>
          
          <div className="flex items-center gap-4 sm:gap-6">
            {/* Desktop Navigation */}
            <nav className="hidden md:flex gap-1">
              {visibleNavItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`relative flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-300 group overflow-hidden cursor-pointer ${
                      isActive
                        ? 'text-white bg-white/5 border border-white/10 shadow-[0_0_15px_rgba(0,210,255,0.1)]'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icon icon={item.icon} className={`w-4 h-4 transition-colors ${isActive ? 'text-secondary' : 'group-hover:text-secondary'}`} />
                    <span className="font-medium text-sm tracking-wide">{item.label}</span>
                    {isActive && (
                      <div className="absolute bottom-0 left-0 w-full h-[2px] bg-secondary shadow-[0_0_10px_#00d2ff]" />
                    )}
                  </Link>
                );
              })}
            </nav>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg bg-surfaceHighlight border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-all cursor-pointer active:scale-95"
              aria-label="Open menu"
            >
              <Icon icon="ph:list-bold" className="w-5 h-5" />
            </button>

            {/* Auth section */}
            <div className="flex items-center gap-3 sm:gap-4 border-l border-white/10 pl-3 sm:pl-6">
              {isLoading ? (
                <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-primary animate-spin" />
              ) : isAuthenticated ? (
                <>
                  <div className="hidden sm:flex flex-col items-end">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-semibold text-white tracking-wide">
                        {user?.displayName || user?.email?.split('@')[0] || 'User'}
                      </span>
                      {isGuest && (
                        <span className="text-[10px] font-mono bg-primary/20 text-primary border border-primary/30 px-1.5 py-0.5 rounded uppercase tracking-wider">Guest</span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider">
                      {user?.isAdmin ? 'Administrator' : 'Authorized'}
                    </span>
                  </div>
                  <button
                    onClick={() => logout()}
                    className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#1a1a24] border border-white/10 text-gray-400 hover:text-[#ff2a2a] hover:border-[#ff2a2a]/30 hover:bg-[#ff2a2a]/10 transition-all duration-300 cursor-pointer active:scale-95"
                    data-tooltip="Sign out"
                  >
                    <Icon icon="ph:sign-out-bold" className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => login()}
                  className="flex items-center gap-2 px-4 sm:px-5 py-2 bg-[#ffaa00]/10 hover:bg-[#ffaa00]/25 text-[#ffaa00] border border-[#ffaa00]/30 hover:border-[#ffaa00]/60 rounded-lg transition-all duration-300 shadow-[0_0_10px_rgba(255,170,0,0.1)] hover:shadow-[0_0_20px_rgba(255,170,0,0.25)] cursor-pointer active:scale-95"
                >
                  <Icon icon="ph:sign-in-bold" className="w-4 h-4" />
                  <span className="hidden sm:inline font-medium text-sm">Sign in</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Sheet Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[100] md:hidden">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          
          {/* Bottom Sheet */}
          <div className="absolute bottom-0 left-0 right-0 glass-panel rounded-t-2xl border-t border-white/10 slide-up">
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>
            
            {/* User Info (mobile) */}
            {isAuthenticated && (
              <div className="px-6 py-4 border-b border-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-surfaceHighlight border border-white/10 flex items-center justify-center">
                    <Icon icon="ph:user-fill" className="w-5 h-5 text-gray-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-display font-semibold text-white">
                        {user?.displayName || user?.email?.split('@')[0] || 'User'}
                      </span>
                      {isGuest && (
                        <span className="text-[10px] font-mono bg-primary/20 text-primary border border-primary/30 px-1.5 py-0.5 rounded uppercase">Guest</span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 font-mono">
                      {user?.isAdmin ? 'Administrator' : 'Authorized'}
                    </span>
                  </div>
                </div>
              </div>
            )}
            
            {/* Navigation Links */}
            <nav className="px-4 py-4 space-y-1">
              {visibleNavItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all touch-feedback ${
                      isActive
                        ? 'bg-white/5 text-white border border-white/10'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icon icon={item.icon} className={`w-5 h-5 ${isActive ? 'text-secondary' : ''}`} />
                    <span className="font-medium">{item.label}</span>
                    {isActive && <StatusLight variant="info" size="sm" className="ml-auto" />}
                  </Link>
                );
              })}
            </nav>
            
            {/* Logout Button */}
            {isAuthenticated && (
              <div className="px-4 pb-6 pt-2 border-t border-white/5">
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    logout();
                  }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-danger/10 hover:bg-danger/20 text-danger border border-danger/30 rounded-xl transition-all cursor-pointer active:scale-[0.98]"
                >
                  <Icon icon="ph:sign-out-bold" className="w-5 h-5" />
                  <span className="font-medium">Sign Out</span>
                </button>
              </div>
            )}
            
            {/* Safe area padding for phones with home indicators */}
            <div className="h-safe-area-inset-bottom" />
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 p-4 max-w-7xl mx-auto w-full">
        {children}
      </main>

      {/* Footer */}
      <footer className="glass-panel border-t border-white/5 px-4 py-4 mt-8">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <StatusLight variant="success" pulse size="md" />
            <span className="text-xs font-mono text-gray-500 uppercase tracking-widest">System Online</span>
          </div>
          <span className="text-xs font-mono text-gray-600">GATES v0.1.0</span>
        </div>
      </footer>
    </div>
  );
}
