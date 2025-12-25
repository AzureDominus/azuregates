import { Routes, Route } from 'react-router-dom';
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
import { AuthProvider } from './lib/auth';

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
          <Route path="/invites" element={<GuestInvites />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/audit" element={<AuditLogs />} />
          <Route path="/admin" element={<Admin />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

// Wrapper component for routes that need the Layout
import { Outlet } from 'react-router-dom';

function LayoutWrapper() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

export default App;
