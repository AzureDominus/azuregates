import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type User } from './api';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isGuest: boolean;
  isActivated: boolean;
  isPending: boolean;  // Account pending approval (never activated)
  isDisabled: boolean; // Account was activated but now disabled
  login: (returnTo?: string) => void;
  logout: () => Promise<void>;
  refetch: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: api.getCurrentUser,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const logoutMutation = useMutation({
    mutationFn: api.logout,
    onSuccess: (data) => {
      // Redirect to Authentik logout FIRST before updating state
      // This prevents useRequireAuth from triggering login redirect
      if (data.logoutUrl) {
        window.location.href = data.logoutUrl;
      } else {
        queryClient.setQueryData(['auth', 'me'], { authenticated: false, user: null });
        queryClient.invalidateQueries({ queryKey: ['auth'] });
        window.location.href = '/';
      }
    },
  });

  const login = (returnTo?: string) => {
    api.login(returnTo || window.location.pathname);
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
  };

  const user = data?.user ?? null;
  const isAuthenticated = data?.authenticated ?? false;
  const isGuest = user?.isGuest ?? false;
  // Activation status - guests and admins are always considered "activated"
  const isActivated = user?.isGuest || user?.isAdmin || (user?.isActivated ?? false);
  // Account states for non-guest users
  const isPending = isAuthenticated && !isGuest && !user?.isActivated && !user?.wasEverActivated;
  const isDisabled = isAuthenticated && !isGuest && !user?.isActivated && user?.wasEverActivated === true;

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated,
        isGuest,
        isActivated,
        isPending,
        isDisabled,
        login,
        logout,
        refetch: () => refetch(),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Hook to check if we should show auth UI
export function useRequireAuth(redirectToLogin = true): { isReady: boolean } {
  const { isAuthenticated, isLoading, login } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated && redirectToLogin) {
      login();
    }
  }, [isLoading, isAuthenticated, redirectToLogin, login]);

  return { isReady: !isLoading && isAuthenticated };
}
