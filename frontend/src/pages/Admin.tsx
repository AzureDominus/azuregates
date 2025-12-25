import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Loader2, 
  AlertCircle, 
  Users, 
  Shield, 
  ShieldCheck, 
  Plus, 
  Trash2, 
  X,
  Clock,
  UserCheck,
  UserX,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { api, type AdminUser } from '../lib/api';
import { useAuth } from '../lib/auth';

export function Admin() {
  const { user } = useAuth();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showGrantModal, setShowGrantModal] = useState(false);
  const queryClient = useQueryClient();

  const { data: users, isLoading, error } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: api.getUsers,
  });

  const { data: pendingUsers } = useQuery({
    queryKey: ['admin', 'users', 'pending'],
    queryFn: api.getPendingUsers,
  });

  const activateUserMutation = useMutation({
    mutationFn: api.activateUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: api.deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setSelectedUserId(null);
    },
  });

  if (!user?.isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-red-400">
        <Shield className="w-12 h-12 mb-4" />
        <p>Admin access required</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-red-400">
        <AlertCircle className="w-12 h-12 mb-4" />
        <p>Failed to load users</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="w-6 h-6" />
          User Management
        </h1>
      </div>

      {/* Pending Users Section */}
      {pendingUsers && pendingUsers.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg">
          <div className="p-4 border-b border-yellow-700 flex items-center gap-2">
            <Clock className="w-5 h-5 text-yellow-400" />
            <h2 className="font-semibold text-yellow-400">Pending Approval ({pendingUsers.length})</h2>
          </div>
          <div className="divide-y divide-yellow-700/50">
            {pendingUsers.map((pu) => (
              <div key={pu.id} className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium">{pu.displayName || pu.email || 'Unknown'}</div>
                  <div className="text-sm text-gray-400">
                    {pu.email && <span>{pu.email} • </span>}
                    Signed up {new Date(pu.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => activateUserMutation.mutate(pu.id)}
                    disabled={activateUserMutation.isPending}
                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded text-sm font-medium transition-colors disabled:opacity-50"
                    title="Approve user"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Approve
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Delete this pending user? This cannot be undone.')) {
                        deleteUserMutation.mutate(pu.id);
                      }
                    }}
                    disabled={deleteUserMutation.isPending}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-sm font-medium transition-colors disabled:opacity-50"
                    title="Reject and delete"
                  >
                    <XCircle className="w-4 h-4" />
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User List */}
        <div className="bg-gray-800 rounded-lg border border-gray-700">
          <div className="p-4 border-b border-gray-700">
            <h2 className="font-semibold">Users</h2>
          </div>
          <div className="divide-y divide-gray-700">
            {users?.map((u) => (
              <UserRow 
                key={u.id} 
                user={u} 
                isSelected={selectedUserId === u.id}
                onSelect={() => setSelectedUserId(u.id)}
              />
            ))}
            {users?.length === 0 && (
              <div className="p-4 text-gray-400 text-center">No users found</div>
            )}
          </div>
        </div>

        {/* User Details */}
        <div className="bg-gray-800 rounded-lg border border-gray-700">
          {selectedUserId ? (
            <UserDetails 
              userId={selectedUserId} 
              onGrantPermission={() => setShowGrantModal(true)} 
            />
          ) : (
            <div className="p-8 text-center text-gray-400">
              Select a user to view details
            </div>
          )}
        </div>
      </div>

      {/* Grant Permission Modal */}
      {showGrantModal && selectedUserId && (
        <GrantPermissionModal
          userId={selectedUserId}
          onClose={() => setShowGrantModal(false)}
        />
      )}
    </div>
  );
}

function UserRow({ 
  user, 
  isSelected, 
  onSelect 
}: { 
  user: AdminUser; 
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div 
      className={`p-4 flex items-center justify-between cursor-pointer hover:bg-gray-700/50 transition-colors ${
        isSelected ? 'bg-gray-700/50 border-l-2 border-blue-500' : ''
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
          user.isAdmin ? 'bg-blue-600' : user.isActivated ? 'bg-gray-600' : 'bg-yellow-600'
        }`}>
          {user.isAdmin ? (
            <ShieldCheck className="w-4 h-4" />
          ) : user.isActivated ? (
            <UserCheck className="w-4 h-4" />
          ) : (
            <Clock className="w-4 h-4" />
          )}
        </div>
        <div>
          <div className="font-medium">{user.displayName || user.email || 'Unknown'}</div>
          <div className="text-sm text-gray-400">{user.email}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">
          {user._count.permissions} permission{user._count.permissions !== 1 ? 's' : ''}
        </span>
        {!user.isActivated && !user.isAdmin && (
          <span className="px-2 py-1 bg-yellow-600 rounded text-xs font-medium" title="Pending approval or disabled">
            {user.activatedAt ? 'Disabled' : 'Pending'}
          </span>
        )}
        {user.isAdmin && (
          <span className="px-2 py-1 bg-blue-600 rounded text-xs font-medium" title="Managed via Authentik groups">
            Admin
          </span>
        )}
      </div>
    </div>
  );
}

function UserDetails({ userId, onGrantPermission }: { userId: string; onGrantPermission: () => void }) {
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery({
    queryKey: ['admin', 'users', userId],
    queryFn: () => api.getUser(userId),
  });

  const revokePermissionMutation = useMutation({
    mutationFn: api.revokePermission,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  const activateUserMutation = useMutation({
    mutationFn: api.activateUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  const deactivateUserMutation = useMutation({
    mutationFn: api.deactivateUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
      </div>
    );
  }

  if (!user) {
    return <div className="p-8 text-center text-gray-400">User not found</div>;
  }

  return (
    <div>
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">{user.displayName || 'Unknown'}</h2>
            <p className="text-sm text-gray-400">{user.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {!user.isActivated && !user.isAdmin && (
              <span className="px-2 py-1 bg-yellow-600 rounded text-xs font-medium">
                {user.activatedAt ? 'Disabled' : 'Pending'}
              </span>
            )}
            {user.isAdmin && (
              <span className="px-2 py-1 bg-blue-600 rounded text-xs font-medium">Admin</span>
            )}
          </div>
        </div>
      </div>

      {/* Account Status Section */}
      {!user.isAdmin && (
        <div className="p-4 border-b border-gray-700">
          <h3 className="font-medium mb-3">Account Status</h3>
          <div className="flex items-center justify-between">
            <div className="text-sm">
              {user.isActivated ? (
                <span className="flex items-center gap-2 text-green-400">
                  <CheckCircle className="w-4 h-4" />
                  Active
                </span>
              ) : user.activatedAt ? (
                <span className="flex items-center gap-2 text-red-400">
                  <XCircle className="w-4 h-4" />
                  Disabled
                </span>
              ) : (
                <span className="flex items-center gap-2 text-yellow-400">
                  <Clock className="w-4 h-4" />
                  Pending Approval
                </span>
              )}
            </div>
            <div>
              {user.isActivated ? (
                <button
                  onClick={() => {
                    if (confirm('Deactivate this user? They will lose access to the system.')) {
                      deactivateUserMutation.mutate(userId);
                    }
                  }}
                  disabled={deactivateUserMutation.isPending}
                  className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-sm transition-colors disabled:opacity-50"
                >
                  <UserX className="w-4 h-4" />
                  Deactivate
                </button>
              ) : (
                <button
                  onClick={() => activateUserMutation.mutate(userId)}
                  disabled={activateUserMutation.isPending}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded text-sm transition-colors disabled:opacity-50"
                >
                  <UserCheck className="w-4 h-4" />
                  Activate
                </button>
              )}
            </div>
          </div>
          {user.activatedAt && (
            <div className="mt-2 text-xs text-gray-500">
              First approved: {new Date(user.activatedAt).toLocaleDateString()}
              {user.activatedBy && ` by ${user.activatedBy}`}
            </div>
          )}
        </div>
      )}

      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">Permissions</h3>
          {!user.isAdmin && (
            <button
              onClick={onGrantPermission}
              className="flex items-center gap-1 px-2 py-1 bg-green-600 hover:bg-green-500 rounded text-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              Grant
            </button>
          )}
        </div>

        {user.isAdmin ? (
          <div className="text-sm text-gray-400 italic">
            Admins have full access to all gates
          </div>
        ) : user.permissions.length === 0 ? (
          <div className="text-sm text-gray-400">No permissions granted</div>
        ) : (
          <div className="space-y-2">
            {user.permissions.map((perm) => (
              <div 
                key={perm.id}
                className="flex items-center justify-between p-2 bg-gray-700/50 rounded"
              >
                <div>
                  <div className="text-sm font-medium">
                    {perm.scopeType}: {perm.scopeName || perm.scopeId}
                  </div>
                  <div className="text-xs text-gray-400">
                    Actions: {perm.actions.join(', ')}
                    {perm.expiresAt && (
                      <span className="ml-2">
                        • Expires: {new Date(perm.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => revokePermissionMutation.mutate(perm.id)}
                  disabled={revokePermissionMutation.isPending}
                  className="p-1 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
                  title="Revoke permission"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GrantPermissionModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [scopeType, setScopeType] = useState<'LOCATION' | 'AREA' | 'GATE'>('LOCATION');
  const [scopeId, setScopeId] = useState('');
  const [actions, setActions] = useState<string[]>([]);

  const { data: scopes } = useQuery({
    queryKey: ['admin', 'scopes'],
    queryFn: api.getScopes,
  });

  const grantMutation = useMutation({
    mutationFn: () => api.grantPermission(userId, { scopeType, scopeId, actions }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      onClose();
    },
  });

  const scopeOptions = scopes ? {
    LOCATION: scopes.locations,
    AREA: scopes.areas,
    GATE: scopes.gates,
  }[scopeType] : [];

  const allActions = ['open', 'close', 'stop', 'toggle'];

  const toggleAction = (action: string) => {
    setActions(prev => 
      prev.includes(action) 
        ? prev.filter(a => a !== action)
        : [...prev, action]
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg border border-gray-700 w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="font-semibold">Grant Permission</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Scope Type */}
          <div>
            <label className="block text-sm font-medium mb-1">Scope Type</label>
            <select
              value={scopeType}
              onChange={(e) => {
                setScopeType(e.target.value as 'LOCATION' | 'AREA' | 'GATE');
                setScopeId('');
              }}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2"
            >
              <option value="LOCATION">Location (all gates in location)</option>
              <option value="AREA">Area (all gates in area)</option>
              <option value="GATE">Gate (single gate)</option>
            </select>
          </div>

          {/* Scope Selection */}
          <div>
            <label className="block text-sm font-medium mb-1">
              {scopeType === 'LOCATION' ? 'Location' : scopeType === 'AREA' ? 'Area' : 'Gate'}
            </label>
            <select
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2"
            >
              <option value="">Select...</option>
              {scopeOptions?.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div>
            <label className="block text-sm font-medium mb-1">Allowed Actions</label>
            <div className="flex flex-wrap gap-2">
              {allActions.map((action) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => toggleAction(action)}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    actions.includes(action)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => grantMutation.mutate()}
            disabled={!scopeId || actions.length === 0 || grantMutation.isPending}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {grantMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Grant Permission'
            )}
          </button>
        </div>

        {grantMutation.error && (
          <div className="px-4 pb-4 text-red-400 text-sm">
            {grantMutation.error instanceof Error ? grantMutation.error.message : 'Failed to grant permission'}
          </div>
        )}
      </div>
    </div>
  );
}
