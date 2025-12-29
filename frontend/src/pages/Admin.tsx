import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Icon } from '@iconify/react';
import { api, type AdminUser } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, IconButton, Select, ToggleButton, Badge, Modal } from '../components/ui';

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
      <div className="flex flex-col items-center justify-center h-64">
        <div className="w-16 h-16 rounded-xl bg-danger/10 flex items-center justify-center mb-4 border border-danger/20">
          <Icon icon="ph:shield-fill" className="w-8 h-8 text-danger" />
        </div>
        <p className="text-gray-400 font-display text-lg">Admin access required</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon icon="ph:spinner" className="w-8 h-8 animate-spin text-secondary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="w-16 h-16 rounded-xl bg-danger/10 flex items-center justify-center mb-4 border border-danger/20">
          <Icon icon="ph:warning-circle-fill" className="w-8 h-8 text-danger" />
        </div>
        <p className="text-gray-400 font-display text-lg">Failed to load users</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-display font-bold text-white tracking-tight mb-1">
            User Management
          </h1>
          <p className="text-gray-400 font-mono text-sm">Manage user access and permissions</p>
        </div>
      </div>

      {/* Pending Users Section */}
      {pendingUsers && pendingUsers.length > 0 && (
        <div className="glass-panel rounded-xl border-primary/30 shadow-[0_0_30px_rgba(255,170,0,0.1)]">
          <div className="p-4 border-b border-primary/20 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon icon="ph:clock-fill" className="w-4 h-4 text-primary" />
            </div>
            <h2 className="font-display font-semibold text-primary">Pending Approval ({pendingUsers.length})</h2>
          </div>
          <div className="divide-y divide-white/5">
            {pendingUsers.map((pu) => (
              <div key={pu.id} className="p-4 hover:bg-white/5 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-medium text-white truncate">{pu.displayName || pu.email || 'Unknown'}</div>
                    <div className="text-sm font-mono text-gray-500 truncate">
                      {pu.email && <span className="hidden sm:inline">{pu.email} • </span>}
                      Signed up {new Date(pu.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      onClick={() => activateUserMutation.mutate(pu.id)}
                      disabled={activateUserMutation.isPending}
                      variant="success"
                      size="sm"
                      icon="ph:check-circle-fill"
                    >
                      Approve
                    </Button>
                    <Button
                      onClick={() => {
                        if (confirm('Delete this pending user? This cannot be undone.')) {
                          deleteUserMutation.mutate(pu.id);
                        }
                      }}
                      disabled={deleteUserMutation.isPending}
                      variant="danger"
                      size="sm"
                      icon="ph:x-circle-fill"
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User List */}
        <div className="glass-panel rounded-xl">
          <div className="p-4 border-b border-white/5">
            <h2 className="font-display font-semibold text-white">Users</h2>
          </div>
          <div className="divide-y divide-white/5">
            {users?.map((u) => (
              <UserRow 
                key={u.id} 
                user={u} 
                isSelected={selectedUserId === u.id}
                onSelect={() => setSelectedUserId(u.id)}
              />
            ))}
            {users?.length === 0 && (
              <div className="p-4 text-gray-500 text-center font-mono text-sm">No users found</div>
            )}
          </div>
        </div>

        {/* User Details */}
        <div className="glass-panel rounded-xl">
          {selectedUserId ? (
            <UserDetails 
              userId={selectedUserId} 
              onGrantPermission={() => setShowGrantModal(true)} 
            />
          ) : (
            <div className="p-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mx-auto mb-3">
                <Icon icon="ph:users" className="w-6 h-6 text-gray-600" />
              </div>
              <p className="text-gray-500 font-mono text-sm">Select a user to view details</p>
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
      className={`p-4 flex items-center justify-between cursor-pointer transition-all duration-200 ${
        isSelected 
          ? 'bg-white/5 border-l-2 border-secondary shadow-[inset_0_0_20px_rgba(0,210,255,0.05)]' 
          : 'hover:bg-white/5 border-l-2 border-transparent'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${
          user.isAdmin 
            ? 'bg-secondary/10 border-secondary/30 text-secondary' 
            : user.isActivated 
              ? 'bg-success/10 border-success/30 text-success' 
              : 'bg-primary/10 border-primary/30 text-primary'
        }`}>
          {user.isAdmin ? (
            <Icon icon="ph:shield-check-fill" className="w-5 h-5" />
          ) : user.isActivated ? (
            <Icon icon="ph:user-check-fill" className="w-5 h-5" />
          ) : (
            <Icon icon="ph:clock-fill" className="w-5 h-5" />
          )}
        </div>
        <div>
          <div className="font-display font-medium text-white">{user.displayName || user.email || 'Unknown'}</div>
          <div className="text-xs font-mono text-gray-500">{user.email}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {!user.isActivated && !user.isAdmin && (
          <Badge variant={user.activatedAt ? 'warning' : 'primary'}>
            {user.activatedAt ? 'Disabled' : 'Pending'}
          </Badge>
        )}
        {user.isAdmin && (
          <Badge variant="secondary">Admin</Badge>
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
        <Icon icon="ph:spinner" className="w-6 h-6 animate-spin text-secondary" />
      </div>
    );
  }

  if (!user) {
    return <div className="p-8 text-center text-gray-500 font-mono text-sm">User not found</div>;
  }

  return (
    <div>
      <div className="p-4 border-b border-white/5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display font-semibold text-white">{user.displayName || 'Unknown'}</h2>
            <p className="text-sm font-mono text-gray-500">{user.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {!user.isActivated && !user.isAdmin && (
              <Badge variant={user.activatedAt ? 'warning' : 'primary'}>
                {user.activatedAt ? 'Disabled' : 'Pending'}
              </Badge>
            )}
            {user.isAdmin && (
              <Badge variant="secondary">Admin</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Account Status Section */}
      {!user.isAdmin && (
        <div className="p-4 border-b border-white/5">
          <h3 className="font-display font-medium text-white mb-3">Account Status</h3>
          <div className="flex items-center justify-between">
            <div className="text-sm">
              {user.isActivated ? (
                <span className="flex items-center gap-2 text-success">
                  <Icon icon="ph:check-circle-fill" className="w-4 h-4" />
                  Active
                </span>
              ) : user.activatedAt ? (
                <span className="flex items-center gap-2 text-danger">
                  <Icon icon="ph:x-circle-fill" className="w-4 h-4" />
                  Disabled
                </span>
              ) : (
                <span className="flex items-center gap-2 text-primary">
                  <Icon icon="ph:clock-fill" className="w-4 h-4" />
                  Pending Approval
                </span>
              )}
            </div>
            <div>
              {user.isActivated ? (
                <Button
                  onClick={() => {
                    if (confirm('Deactivate this user? They will lose access to the system.')) {
                      deactivateUserMutation.mutate(userId);
                    }
                  }}
                  disabled={deactivateUserMutation.isPending}
                  variant="danger"
                  size="sm"
                  icon="ph:user-minus-fill"
                >
                  Deactivate
                </Button>
              ) : (
                <Button
                  onClick={() => activateUserMutation.mutate(userId)}
                  disabled={activateUserMutation.isPending}
                  variant="success"
                  size="sm"
                  icon="ph:user-check-fill"
                >
                  Activate
                </Button>
              )}
            </div>
          </div>
          {user.activatedAt && (
            <div className="mt-2 text-xs font-mono text-gray-600">
              First approved: {new Date(user.activatedAt).toLocaleDateString()}
              {user.activatedByName && ` by ${user.activatedByName}`}
            </div>
          )}
        </div>
      )}

      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-medium text-white">Permissions</h3>
          {!user.isAdmin && (
            <Button
              onClick={onGrantPermission}
              variant="success"
              size="sm"
              icon="ph:plus-bold"
            >
              Grant
            </Button>
          )}
        </div>

        {user.isAdmin ? (
          <div className="text-sm font-mono text-gray-500 italic">
            Admins have full access to all devices
          </div>
        ) : user.permissions.length === 0 ? (
          <div className="text-sm font-mono text-gray-500">No permissions granted</div>
        ) : (
          <div className="space-y-2">
            {user.permissions.map((perm) => (
              <div 
                key={perm.id}
                className="flex items-center gap-2 p-3 bg-surfaceHighlight/50 border border-white/5 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-display font-medium text-white truncate">
                    {perm.scopeType}: {perm.scopeName || perm.scopeId}
                  </div>
                  <div className="text-xs font-mono text-gray-500 truncate">
                    Actions: <span className="text-gray-400">{perm.actions.join(', ')}</span>
                    {perm.expiresAt && (
                      <span className="ml-2">
                        • Expires: {new Date(perm.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <IconButton
                  onClick={() => {
                    if (confirm('Revoke this permission? The user will lose access to the associated devices.')) {
                      revokePermissionMutation.mutate(perm.id);
                    }
                  }}
                  disabled={revokePermissionMutation.isPending}
                  icon="ph:trash-fill"
                  label="Revoke permission"
                  className="text-gray-500 hover:text-danger hover:bg-danger/10"
                />
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
  const [scopeType, setScopeType] = useState<'LOCATION' | 'AREA' | 'DEVICE'>('LOCATION');
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
    DEVICE: scopes.devices,
  }[scopeType] : [];

  const allActions = ['open', 'close', 'stop', 'toggle', 'on', 'off'];

  const toggleAction = (action: string) => {
    setActions(prev => 
      prev.includes(action) 
        ? prev.filter(a => a !== action)
        : [...prev, action]
    );
  };

  return (
    <Modal onClose={onClose} title="Grant Permission">
      <div className="space-y-4">
        {/* Scope Type */}
        <Select
          label="Scope Type"
          value={scopeType}
          onChange={(e) => {
            setScopeType(e.target.value as 'LOCATION' | 'AREA' | 'DEVICE');
            setScopeId('');
          }}
        >
          <option value="LOCATION">Location (all devices in location)</option>
          <option value="AREA">Area (all devices in area)</option>
          <option value="DEVICE">Device (single device)</option>
        </Select>

        {/* Scope Selection */}
        <Select
          label={scopeType === 'LOCATION' ? 'Location' : scopeType === 'AREA' ? 'Area' : 'Device'}
          value={scopeId}
          onChange={(e) => setScopeId(e.target.value)}
        >
          <option value="">Select...</option>
          {scopeOptions?.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>

        {/* Actions */}
        <div>
          <label className="block text-xs font-mono text-gray-500 mb-2 uppercase tracking-wider">Allowed Actions</label>
          <div className="flex flex-wrap gap-2">
            {allActions.map((action) => (
              <ToggleButton
                key={action}
                active={actions.includes(action)}
                onClick={() => toggleAction(action)}
              >
                {action}
              </ToggleButton>
            ))}
          </div>
        </div>

        {grantMutation.error && (
          <div className="p-3 bg-danger/10 border border-danger/30 rounded-lg text-danger font-mono text-sm flex items-center gap-2">
            <Icon icon="ph:warning-fill" className="w-4 h-4 flex-shrink-0" />
            {grantMutation.error instanceof Error ? grantMutation.error.message : 'Failed to grant permission'}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button
            onClick={onClose}
            variant="ghost"
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={() => grantMutation.mutate()}
            disabled={!scopeId || actions.length === 0 || grantMutation.isPending}
            loading={grantMutation.isPending}
            variant="success"
            className="flex-1"
          >
            Grant Permission
          </Button>
        </div>
      </div>
    </Modal>
  );
}
