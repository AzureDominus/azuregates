import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldX, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '../lib/auth';

export function AccountDisabled() {
  const { user, logout, isActivated, refetch } = useAuth();
  const navigate = useNavigate();

  // Redirect to dashboard if user becomes re-activated
  useEffect(() => {
    if (isActivated) {
      navigate('/', { replace: true });
    }
  }, [isActivated, navigate]);

  // Poll for activation status every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
    }, 10000);

    return () => clearInterval(interval);
  }, [refetch]);

  const handleLogout = async () => {
    await logout();
  };

  const handleRefresh = () => {
    refetch();
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center">
            <ShieldX className="w-8 h-8 text-red-400" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">Account Disabled</h1>
        
        <p className="text-gray-400 mb-6">
          Your account has been disabled by an administrator. Please contact an admin if you believe this is a mistake.
        </p>

        <div className="bg-gray-700/50 rounded-lg p-4 mb-6">
          <div className="text-sm text-gray-400 mb-1">Signed in as</div>
          <div className="font-medium text-white">{user?.displayName || user?.email || 'Unknown'}</div>
          {user?.email && user?.displayName && (
            <div className="text-sm text-gray-400">{user.email}</div>
          )}
        </div>

        <div className="text-xs text-gray-600 mb-6">
          This page checks for re-activation every 10 seconds.
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleRefresh}
            className="flex items-center justify-center gap-2 flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors text-white"
          >
            <RefreshCw className="w-4 h-4" />
            Check Now
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-gray-300"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
