import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, LogIn, AlertCircle } from 'lucide-react';
import { useAuth } from '../lib/auth';

export function Login() {
  const { isAuthenticated, isLoading, login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo') || '/';
  const error = searchParams.get('error');

  // If already authenticated, redirect
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate(returnTo, { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, returnTo]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white">Gate Control</h1>
          <p className="mt-2 text-gray-400">Sign in to access your gates</p>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-600 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <p className="text-red-300 text-sm">
              {error === 'auth_failed'
                ? 'Authentication failed. Please try again.'
                : 'An error occurred. Please try again.'}
            </p>
          </div>
        )}

        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <button
            onClick={() => login(returnTo)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
          >
            <LogIn className="w-5 h-5" />
            Sign in with Authentik
          </button>

          <div className="mt-6 text-center text-sm text-gray-500">
            <p>Protected by local authentication</p>
          </div>
        </div>
      </div>
    </div>
  );
}
