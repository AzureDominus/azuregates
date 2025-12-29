import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Icon } from '@iconify/react';
import { api, type CreateInviteRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, IconButton, Select, ToggleButton, Badge, Modal } from '../components/ui';

export function GuestInvites() {
  const { isAuthenticated, isGuest } = useAuth();
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: invites, isLoading, error } = useQuery({
    queryKey: ['invites'],
    queryFn: api.getInvites,
    enabled: isAuthenticated && !isGuest,
  });

  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: api.getLocations,
    enabled: isAuthenticated && !isGuest,
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteInvite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invites'] });
    },
  });

  const createMutation = useMutation({
    mutationFn: api.createInvite,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invites'] });
      setShowCreateForm(false);
      // Copy the magic link to clipboard
      if (data.invite.magicLink) {
        navigator.clipboard.writeText(data.invite.magicLink);
        setCopiedId(data.invite.id);
        setTimeout(() => setCopiedId(null), 3000);
      }
    },
  });

  const copyMagicLink = (invite: { id: string; magicLink?: string }) => {
    if (invite.magicLink) {
      navigator.clipboard.writeText(invite.magicLink);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 3000);
    }
  };

  if (!isAuthenticated || isGuest) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="w-16 h-16 rounded-xl bg-danger/10 flex items-center justify-center mb-4 border border-danger/20">
          <Icon icon="ph:warning-fill" className="w-8 h-8 text-danger" />
        </div>
        <p className="text-gray-400 font-mono text-sm">You must be signed in as a regular user to manage guest invites.</p>
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
          <Icon icon="ph:warning-fill" className="w-8 h-8 text-danger" />
        </div>
        <p className="text-gray-400 font-display text-lg">Failed to load invites</p>
      </div>
    );
  }

  // Get all devices for the create form
  const allDevices = locations?.flatMap(l => 
    l.areas?.flatMap(a => 
      a.devices?.map(d => ({ ...d, areaName: a.name, locationName: l.name })) || []
    ) || []
  ) || [];

  const allAreas = locations?.flatMap(l =>
    l.areas?.map(a => ({ ...a, locationName: l.name })) || []
  ) || [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold text-white tracking-tight mb-1">Guest Access</h1>
          <p className="text-gray-400 font-mono text-sm">Create and manage guest invite links</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => setShowCreateForm(true)}
          icon="ph:plus-bold"
        >
          Create Invite
        </Button>
      </div>

      {/* Create Form Modal */}
      {showCreateForm && (
        <CreateInviteForm
          devices={allDevices}
          areas={allAreas}
          locations={locations || []}
          onSubmit={(data) => createMutation.mutate(data)}
          onCancel={() => setShowCreateForm(false)}
          isSubmitting={createMutation.isPending}
          error={createMutation.error}
        />
      )}

      {/* Success message */}
      {copiedId && (
        <div className="glass-panel rounded-xl p-4 border-success/30 flex items-center gap-3 shadow-[0_0_20px_rgba(0,255,157,0.1)] animate-in fade-in slide-in-from-top-4">
          <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center border border-success/20">
            <Icon icon="ph:check-bold" className="w-5 h-5 text-success" />
          </div>
          <p className="text-success font-mono text-sm">Magic link copied to clipboard! Share it with your guest.</p>
        </div>
      )}

      {/* Invites List */}
      {!invites || invites.length === 0 ? (
        <div className="glass-panel rounded-xl p-12 text-center">
          <div className="w-16 h-16 rounded-xl bg-white/5 flex items-center justify-center mx-auto mb-4">
            <Icon icon="ph:link" className="w-8 h-8 text-gray-600" />
          </div>
          <p className="text-gray-400 font-display mb-2">No guest invites yet</p>
          <p className="text-gray-600 font-mono text-sm">
            Create an invite to generate a magic link for temporary guest access.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {invites.map((invite) => {
            const isExpired = new Date(invite.expiresAt) < new Date();
            const isMaxedOut = invite.maxUses && invite.useCount >= invite.maxUses;
            const isActive = !isExpired && !isMaxedOut;

            return (
              <div
                key={invite.id}
                className={`glass-panel rounded-xl p-4 ${
                  isExpired || isMaxedOut ? 'border-white/5 opacity-60' : 'border-white/10'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="font-display font-medium text-white">
                        {invite.scopeType}: {invite.scopeId}
                      </span>
                      {copiedId === invite.id && (
                        <Badge variant="success">
                          <Icon icon="ph:check-bold" className="w-3 h-3 mr-1" /> Copied!
                        </Badge>
                      )}
                      {isExpired && (
                        <Badge variant="danger">Expired</Badge>
                      )}
                      {isMaxedOut && !isExpired && (
                        <Badge variant="warning">Max uses reached</Badge>
                      )}
                    </div>
                    <div className="text-sm font-mono text-gray-500">
                      Actions: <span className="text-gray-400">{invite.allowedActions.join(', ')}</span>
                    </div>
                    <div className="text-xs font-mono text-gray-600 mt-1">
                      Expires: {new Date(invite.expiresAt).toLocaleString()} • Uses: {invite.useCount}{invite.maxUses ? ` / ${invite.maxUses}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isActive && invite.magicLink && (
                      <IconButton
                        icon="ph:copy"
                        label="Copy magic link"
                        onClick={() => copyMagicLink(invite)}
                        variant="ghost"
                        size="sm"
                      />
                    )}
                    <IconButton
                      icon="ph:trash"
                      label="Delete invite"
                      onClick={() => deleteMutation.mutate(invite.id)}
                      disabled={deleteMutation.isPending}
                      variant="ghost"
                      size="sm"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface CreateInviteFormProps {
  devices: any[];
  areas: any[];
  locations: any[];
  onSubmit: (data: CreateInviteRequest) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error: Error | null;
}

function CreateInviteForm({ devices, areas, locations, onSubmit, onCancel, isSubmitting, error }: CreateInviteFormProps) {
  const [scopeType, setScopeType] = useState<'LOCATION' | 'AREA' | 'DEVICE'>('DEVICE');
  const [scopeId, setScopeId] = useState('');
  const [actions, setActions] = useState<string[]>(['open', 'close', 'stop']);
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [maxUses, setMaxUses] = useState<number | undefined>(undefined);

  const scopeOptions = scopeType === 'DEVICE' 
    ? devices 
    : scopeType === 'AREA' 
    ? areas 
    : locations;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scopeId || actions.length === 0) return;

    onSubmit({
      scopeType,
      scopeId,
      allowedActions: actions as any,
      expiresInHours,
      maxUses,
    });
  };

  const toggleAction = (action: string) => {
    setActions(prev => {
      let newActions: string[];
      
      if (prev.includes(action)) {
        // Removing an action
        newActions = prev.filter(a => a !== action);
      } else {
        // Adding an action
        newActions = [...prev, action];
        
        // close requires stop (safety)
        if (action === 'close' && !newActions.includes('stop')) {
          newActions.push('stop');
        }
      }
      
      return newActions;
    });
  };

  // Check if an action is required by another selected action
  const isActionRequired = (action: string): string | null => {
    if (action === 'stop' && actions.includes('close')) {
      return 'Required for safety when close is enabled';
    }
    return null;
  };

  return (
    <Modal onClose={onCancel} title="Create Guest Invite">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Scope Type */}
        <Select
          label="Access Scope"
          value={scopeType}
          onChange={(e) => {
            setScopeType(e.target.value as any);
            setScopeId('');
          }}
        >
          <option value="DEVICE">Single Device</option>
          <option value="AREA">Area (multiple devices)</option>
          <option value="LOCATION">Entire Location</option>
        </Select>

        {/* Scope ID */}
        <Select
          label={scopeType === 'DEVICE' ? 'Device' : scopeType === 'AREA' ? 'Area' : 'Location'}
          value={scopeId}
          onChange={(e) => setScopeId(e.target.value)}
          required
        >
          <option value="">Select...</option>
          {scopeOptions.map((opt: any) => (
            <option key={opt.id} value={opt.id}>
              {opt.name}
              {opt.areaName && ` (${opt.areaName})`}
              {opt.locationName && ` - ${opt.locationName}`}
            </option>
          ))}
        </Select>

        {/* Actions */}
        <div>
          <label className="block text-xs font-mono text-gray-500 mb-2 uppercase tracking-wider">
            Allowed Actions
          </label>
          <div className="flex flex-wrap gap-2">
            {['open', 'close', 'stop', 'on', 'off'].map((action) => {
              const requiredReason = isActionRequired(action);
              return (
                <ToggleButton
                  key={action}
                  active={actions.includes(action)}
                  onClick={() => !requiredReason && toggleAction(action)}
                  disabled={!!requiredReason}
                  title={requiredReason || undefined}
                >
                  {action}
                  {requiredReason && <Icon icon="ph:lock-simple-fill" className="w-3 h-3 ml-1 opacity-60" />}
                </ToggleButton>
              );
            })}
          </div>
          {actions.includes('close') && (
            <p className="text-xs text-yellow-500/80 mt-2 flex items-center gap-1">
              <Icon icon="ph:info-fill" className="w-3.5 h-3.5" />
              Stop is required when close is enabled (safety)
            </p>
          )}
        </div>

        {/* Expiry */}
        <Select
          label="Expires In"
          value={expiresInHours}
          onChange={(e) => setExpiresInHours(parseInt(e.target.value))}
        >
          <option value={1}>1 hour</option>
          <option value={4}>4 hours</option>
          <option value={8}>8 hours</option>
          <option value={24}>24 hours</option>
          <option value={48}>2 days</option>
          <option value={168}>1 week</option>
          <option value={720}>30 days</option>
        </Select>

        {/* Max Uses */}
        <div>
          <label className="block text-xs font-mono text-gray-500 mb-1.5 uppercase tracking-wider">
            Max Uses (optional)
          </label>
          <input
            type="number"
            inputMode="numeric"
            pattern="[0-9]*"
            min="1"
            max="100"
            value={maxUses || ''}
            onChange={(e) => setMaxUses(e.target.value ? parseInt(e.target.value) : undefined)}
            onKeyDown={(e) => {
              if (['e', 'E', '+', '-', '.'].includes(e.key)) {
                e.preventDefault();
              }
            }}
            placeholder="Unlimited"
            className="w-full bg-surfaceHighlight border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 focus:border-secondary/50 focus:outline-none transition-colors hover:border-white/20"
          />
        </div>

        {error && (
          <div className="p-3 bg-danger/10 border border-danger/30 rounded-lg text-danger font-mono text-sm flex items-center gap-2">
            <Icon icon="ph:warning-fill" className="w-4 h-4 flex-shrink-0" />
            {error instanceof Error ? error.message : 'Failed to create invite'}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            onClick={onCancel}
            variant="ghost"
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || !scopeId || actions.length === 0}
            loading={isSubmitting}
            variant="secondary"
            icon="ph:link-bold"
            className="flex-1"
          >
            Create Link
          </Button>
        </div>
      </form>
    </Modal>
  );
}
