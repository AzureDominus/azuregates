import { createRouter, createRootRoute, createRoute, lazyRouteComponent, Outlet } from '@tanstack/react-router';
import { Layout } from './components/Layout';

// Root route - wraps everything with Layout for authenticated routes
const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

// Public routes (no layout)
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: lazyRouteComponent(() => import('./pages/Login').then(m => ({ default: m.Login }))),
});

const guestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/guest',
  component: lazyRouteComponent(() => import('./pages/GuestAccess').then(m => ({ default: m.GuestAccess }))),
});

const pendingApprovalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pending-approval',
  component: lazyRouteComponent(() => import('./pages/PendingApproval').then(m => ({ default: m.PendingApproval }))),
});

const accountDisabledRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account-disabled',
  component: lazyRouteComponent(() => import('./pages/AccountDisabled').then(m => ({ default: m.AccountDisabled }))),
});

// Layout wrapper route for authenticated pages
const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'layout',
  component: function LayoutWrapper() {
    return (
      <Layout>
        <Outlet />
      </Layout>
    );
  },
});

// Dashboard (home)
const dashboardRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard }))),
});

// Device control with dynamic param
const deviceControlRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/devices/$deviceId',
  component: lazyRouteComponent(() => import('./pages/GateControl').then(m => ({ default: m.DeviceControl }))),
});

// Admin routes - lazy loaded
const invitesRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/invites',
  component: lazyRouteComponent(() => import('./pages/GuestInvites').then(m => ({ default: m.GuestInvites }))),
});

const adminRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/admin',
  component: lazyRouteComponent(() => import('./pages/Admin').then(m => ({ default: m.Admin }))),
});

const settingsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/settings',
  component: lazyRouteComponent(() => import('./pages/Settings').then(m => ({ default: m.Settings }))),
});

const auditRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/audit',
  component: lazyRouteComponent(() => import('./pages/AuditLogs').then(m => ({ default: m.AuditLogs }))),
});

// Build route tree
const routeTree = rootRoute.addChildren([
  loginRoute,
  guestRoute,
  pendingApprovalRoute,
  accountDisabledRoute,
  layoutRoute.addChildren([
    dashboardRoute,
    deviceControlRoute,
    invitesRoute,
    adminRoute,
    settingsRoute,
    auditRoute,
  ]),
]);

// Create router instance
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

// Type registration for type-safe navigation
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
