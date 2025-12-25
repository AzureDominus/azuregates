import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { GateControl } from './pages/GateControl';
import { Settings } from './pages/Settings';
import { AuditLogs } from './pages/AuditLogs';
import { Login } from './pages/Login';
import { GuestAccess } from './pages/GuestAccess';
import { GuestInvites } from './pages/GuestInvites';
import { Admin } from './pages/Admin';
import { PendingApproval } from './pages/PendingApproval';
import { AccountDisabled } from './pages/AccountDisabled';
import { AuthProvider, useAuth } from './lib/auth';

function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public routes without layout */}
        <Route path="/login" element={<Login />} />
        <Route path="/guest" element={<GuestAccess />} />
        <Route path="/pending-approval" element={<PendingApproval />} />
        <Route path="/account-disabled" element={<AccountDisabled />} />
        
        {/* Routes with layout */}
        <Route element={<LayoutWrapper />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/gates/:gateId" element={<GateControl />} />
          {/* Admin-only routes - redirect non-admins to dashboard */}
          <Route path="/invites" element={<AdminRoute><GuestInvites /></AdminRoute>} />
          <Route path="/settings" element={<AdminRoute><Settings /></AdminRoute>} />
          <Route path="/audit" element={<AdminRoute><AuditLogs /></AdminRoute>} />
          <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

// Wrapper component for routes that need the Layout
import { Outlet } from 'react-router-dom';
import { ReactNode } from 'react';

function LayoutWrapper() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

// Wrapper for admin-only routes - redirects non-admins to dashboard
function AdminRoute({ children }: { children: ReactNode }) {
  const { user, isLoading, isAuthenticated } = useAuth();
  
  // Wait for auth to load
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }
  
  // Not authenticated - will be handled by Layout
  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  
  // Not an admin - redirect to dashboard
  if (!user?.isAdmin) {
    return <Navigate to="/" replace />;
  }
  
  return <>{children}</>;
}

export default App;
