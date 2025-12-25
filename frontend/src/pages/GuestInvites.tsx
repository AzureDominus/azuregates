import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, Link2, Trash2, Plus, Check, Copy } from 'lucide-react';
import { api, type CreateInviteRequest } from '../lib/api';
import { useAuth } from '../lib/auth';

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

  const regenerateMutation = useMutation({
    mutationFn: api.regenerateInviteLink,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invites'] });
      // Copy the new magic link to clipboard
      if (data.invite.magicLink) {
        navigator.clipboard.writeText(data.invite.magicLink);
        setCopiedId(data.invite.id);
        setTimeout(() => setCopiedId(null), 3000);
      }
    },
  });

  if (!isAuthenticated || isGuest) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <AlertCircle className="w-12 h-12 mb-4" />
        <p>You must be signed in as a regular user to manage guest invites.</p>
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
        <p>Failed to load invites</p>
      </div>
    );
  }

  // Get all gates for the create form
  const allGates = locations?.flatMap(l => 
    l.areas?.flatMap(a => 
      a.gates?.map(g => ({ ...g, areaName: a.name, locationName: l.name })) || []
    ) || []
  ) || [];

  const allAreas = locations?.flatMap(l =>
    l.areas?.map(a => ({ ...a, locationName: l.name })) || []
  ) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Guest Access</h1>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Invite
        </button>
      </div>

      {/* Create Form Modal */}
      {showCreateForm && (
        <CreateInviteForm
          gates={allGates}
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
        <div className="bg-green-900/50 border border-green-600 rounded-lg p-4 flex items-center gap-3">
          <Check className="w-5 h-5 text-green-400" />
          <p className="text-green-300">Magic link copied to clipboard! Share it with your guest.</p>
        </div>
      )}

      {/* Invites List */}
      {!invites || invites.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-8 border border-gray-700 text-center">
          <Link2 className="w-12 h-12 text-gray-500 mx-auto mb-4" />
          <p className="text-gray-400 mb-2">No guest invites yet</p>
          <p className="text-gray-500 text-sm">
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
                className={`bg-gray-800 rounded-lg p-4 border ${
                  isExpired || isMaxedOut ? 'border-gray-600 opacity-60' : 'border-gray-700'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {invite.scopeType}: {invite.scopeId}
                      </span>
                      {copiedId === invite.id && (
                        <span className="text-xs bg-green-600 px-2 py-0.5 rounded flex items-center gap-1">
                          <Check className="w-3 h-3" /> Copied!
                        </span>
                      )}
                      {isExpired && (
                        <span className="text-xs bg-red-600 px-2 py-0.5 rounded">Expired</span>
                      )}
                      {isMaxedOut && !isExpired && (
                        <span className="text-xs bg-yellow-600 px-2 py-0.5 rounded">Max uses reached</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-400 mt-1">
                      Actions: {invite.allowedActions.join(', ')}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Expires: {new Date(invite.expiresAt).toLocaleString()} •
                      Uses: {invite.useCount}{invite.maxUses ? ` / ${invite.maxUses}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {isActive && (
                      <button
                        onClick={() => regenerateMutation.mutate(invite.id)}
                        disabled={regenerateMutation.isPending}
                        className="p-2 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded transition-colors"
                        title="Copy link (generates new token)"
                      >
                        {regenerateMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => deleteMutation.mutate(invite.id)}
                      disabled={deleteMutation.isPending}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
                      title="Delete invite"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
  gates: any[];
  areas: any[];
  locations: any[];
  onSubmit: (data: CreateInviteRequest) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error: Error | null;
}

function CreateInviteForm({ gates, areas, locations, onSubmit, onCancel, isSubmitting, error }: CreateInviteFormProps) {
  const [scopeType, setScopeType] = useState<'LOCATION' | 'AREA' | 'GATE'>('GATE');
  const [scopeId, setScopeId] = useState('');
  const [actions, setActions] = useState<string[]>(['open', 'close', 'stop']);
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [maxUses, setMaxUses] = useState<number | undefined>(undefined);

  const scopeOptions = scopeType === 'GATE' 
    ? gates 
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
    setActions(prev => 
      prev.includes(action) 
        ? prev.filter(a => a !== action)
        : [...prev, action]
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">Create Guest Invite</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Scope Type */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Access Scope
            </label>
            <select
              value={scopeType}
              onChange={(e) => {
                setScopeType(e.target.value as any);
                setScopeId('');
              }}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2"
            >
              <option value="GATE">Single Gate</option>
              <option value="AREA">Area (multiple gates)</option>
              <option value="LOCATION">Entire Location</option>
            </select>
          </div>

          {/* Scope ID */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              {scopeType === 'GATE' ? 'Gate' : scopeType === 'AREA' ? 'Area' : 'Location'}
            </label>
            <select
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2"
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
            </select>
          </div>

          {/* Actions */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Allowed Actions
            </label>
            <div className="flex flex-wrap gap-2">
              {['open', 'close', 'stop', 'toggle'].map((action) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => toggleAction(action)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    actions.includes(action)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {action.charAt(0).toUpperCase() + action.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Expiry */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Expires In
            </label>
            <select
              value={expiresInHours}
              onChange={(e) => setExpiresInHours(parseInt(e.target.value))}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2"
            >
              <option value={1}>1 hour</option>
              <option value={4}>4 hours</option>
              <option value={8}>8 hours</option>
              <option value={24}>24 hours</option>
              <option value={48}>2 days</option>
              <option value={168}>1 week</option>
              <option value={720}>30 days</option>
            </select>
          </div>

          {/* Max Uses */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Max Uses (optional)
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={maxUses || ''}
              onChange={(e) => setMaxUses(e.target.value ? parseInt(e.target.value) : undefined)}
              placeholder="Unlimited"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2"
            />
          </div>

          {error && (
            <div className="text-red-400 text-sm">
              {error instanceof Error ? error.message : 'Failed to create invite'}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !scopeId || actions.length === 0}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Link2 className="w-4 h-4" />
              )}
              Create Link
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
