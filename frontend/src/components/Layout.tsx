import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { Icon } from '@iconify/react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../lib/auth';
import { usePWAInstall, useServiceWorker } from '../lib/usePWAInstall';
import { APP_NAME, APP_SHORT_NAME, APP_VERSION, COPYRIGHT_TEXT } from '../lib/constants';
import { StatusLight, Button, IconButton } from './ui';

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
  const { showPrompt, promptInstall, dismissPrompt, isIOS, isInstalled } = usePWAInstall();
  const { updateAvailable, applyUpdate } = useServiceWorker();

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

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
      <header className="sticky top-4 z-50 mx-4 mt-4 rounded-2xl glass-panel px-4 sm:px-6 py-4 transition-all duration-300 bg-[#1a1a24]/80 border-secondary/20 shadow-[0_0_20px_rgba(0,210,255,0.1)]">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link 
            to="/" 
            className="flex items-center gap-3 group relative z-10"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-[#1a1a24] border border-white/10 group-hover:border-white/30 transition-colors">
              <Icon icon="ph:garage-fill" className="w-6 h-6 text-gray-400 group-hover:text-white transition-colors" />  
            </div>
            <div className="flex flex-col">
              <span className="font-display font-bold text-2xl tracking-wide text-white leading-none">{APP_SHORT_NAME.toUpperCase()}</span>
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
                    className={`relative flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 group overflow-hidden cursor-pointer ${
                      isActive
                        ? 'bg-secondary/10 text-secondary border border-secondary/20 shadow-[0_0_15px_rgba(0,210,255,0.1)]'
                        : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    <Icon icon={item.icon} className={`w-4 h-4 transition-colors ${isActive ? 'text-secondary' : 'group-hover:text-white'}`} />
                    <span className="font-medium text-sm tracking-wide">{item.label}</span>
                    {isActive && (
                      <div className="absolute bottom-0 left-0 w-full h-[2px] bg-secondary/50" />
                    )}
                  </Link>
                );
              })}
            </nav>

            {/* Auth section */}
            <div className="flex items-center gap-3 sm:gap-4 border-l border-white/10 pl-3 sm:pl-6">
              {isLoading ? (
                <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-primary animate-spin" />
              ) : isAuthenticated ? (
                <>
                  <div className="flex flex-col items-end">
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
                  <div className="hidden md:block">
                    <IconButton
                      icon="ph:sign-out-bold"
                      label="Sign out"
                      onClick={() => logout()}
                      variant="ghost"
                      className="hover:text-danger hover:border-danger/30 hover:bg-danger/10"
                    />
                  </div>
                </>
              ) : (
                <Button
                  onClick={() => login()}
                  variant="primary"
                  icon="ph:sign-in-bold"
                >
                  <span className="hidden sm:inline">Sign in</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile FAB Menu Trigger */}
      <div className="fixed bottom-6 right-6 z-50 md:hidden">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="w-14 h-14 rounded-2xl glass-panel border border-secondary/30 text-secondary shadow-[0_0_20px_rgba(0,210,255,0.2)] flex items-center justify-center active:scale-95 transition-transform hover:bg-secondary/10"
        >
          <Icon icon="ph:list-bold" className="w-7 h-7" />
        </button>
      </div>

      {/* Mobile Bottom Sheet Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-[100] md:hidden">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setMobileMenuOpen(false)}
            />
            
            {/* Bottom Sheet */}
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              drag="y"
              dragConstraints={{ top: 0 }}
              dragElastic={{ top: 0, bottom: 0.5 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 100 || info.velocity.y > 500) {
                  setMobileMenuOpen(false);
                }
              }}
              className="absolute bottom-0 left-0 right-0 glass-panel rounded-t-2xl border-t border-white/10"
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
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
                          ? 'bg-secondary/10 text-secondary border border-secondary/20'
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
                  <Button
                    variant="danger"
                    className="w-full justify-center"
                    icon="ph:sign-out-bold"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      logout();
                    }}
                  >
                    Sign Out
                  </Button>
                </div>
              )}
              
              {/* Safe area padding for phones with home indicators */}
              <div className="h-safe-area-inset-bottom" />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main content */}
      <main className="flex-1 p-4 max-w-7xl mx-auto w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="w-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="glass-panel border-t border-white/5 px-4 py-4 mt-8">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <span className="text-xs font-mono text-gray-500">{COPYRIGHT_TEXT}</span>
          <span className="text-xs font-mono text-gray-600">{APP_NAME} v{APP_VERSION}</span>
        </div>
      </footer>

      {/* PWA Install Prompt */}
      <AnimatePresence>
        {showPrompt && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.95 }}
            className="fixed bottom-20 left-4 right-4 md:left-auto md:right-6 md:w-96 z-[200]"
          >
            <div className="glass-panel rounded-2xl p-4 border border-secondary/20 shadow-[0_0_30px_rgba(0,210,255,0.15)]">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center flex-shrink-0">
                  <Icon icon="ph:download-simple-fill" className="w-6 h-6 text-secondary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-display font-semibold text-white mb-1">Install {APP_NAME}</h3>
                  <p className="text-sm text-gray-400 mb-3">
                    Add to your home screen for quick access and offline support.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={promptInstall}
                      icon="ph:plus-circle-fill"
                    >
                      Install
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={dismissPrompt}
                    >
                      Later
                    </Button>
                  </div>
                </div>
                <button
                  onClick={dismissPrompt}
                  className="text-gray-500 hover:text-white transition-colors p-1"
                >
                  <Icon icon="ph:x" className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* iOS Install Instructions */}
      <AnimatePresence>
        {isIOS && !isInstalled && showPrompt && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-20 left-4 right-4 md:left-auto md:right-6 md:w-96 z-[200]"
          >
            <div className="glass-panel rounded-2xl p-4 border border-secondary/20">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center flex-shrink-0">
                  <Icon icon="ph:share-fat-fill" className="w-6 h-6 text-secondary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-display font-semibold text-white mb-1">Install {APP_NAME}</h3>
                  <p className="text-sm text-gray-400">
                    Tap <Icon icon="ph:share-fat" className="inline w-4 h-4 mx-1" /> then "Add to Home Screen"
                  </p>
                </div>
                <button onClick={dismissPrompt} className="text-gray-500 hover:text-white p-1">
                  <Icon icon="ph:x" className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Update Available Notification */}
      <AnimatePresence>
        {updateAvailable && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-20 left-4 right-4 md:left-auto md:right-6 md:w-80 z-[200]"
          >
            <div className="glass-panel rounded-xl p-3 border border-primary/30 bg-primary/10">
              <div className="flex items-center gap-3">
                <Icon icon="ph:arrow-clockwise-fill" className="w-5 h-5 text-primary flex-shrink-0" />
                <span className="text-sm text-white flex-1">Update available</span>
                <Button variant="primary" size="sm" onClick={applyUpdate}>
                  Refresh
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
