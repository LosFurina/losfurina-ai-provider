// public/components/command-registry.js
import { api } from '/lib/api.js';
import { navigate } from '/lib/router.js';

const STATIC = [
  { id: 'nav-overview', section: 'Navigate', icon: '📊', title: 'Go to Overview', action: () => navigate('/overview') },
  { id: 'nav-logs', section: 'Navigate', icon: '📋', title: 'Go to Logs', action: () => navigate('/logs') },
  { id: 'nav-analytics', section: 'Navigate', icon: '📈', title: 'Go to Analytics', action: () => navigate('/analytics') },
  { id: 'nav-playground', section: 'Navigate', icon: '🧪', title: 'Go to Playground', action: () => navigate('/playground') },
  { id: 'nav-health', section: 'Navigate', icon: '💚', title: 'Go to Health', action: () => navigate('/health') },
  { id: 'nav-settings', section: 'Navigate', icon: '⚙', title: 'Go to Settings', action: () => navigate('/settings') },

  { id: 'logs-errors', section: 'Filters', icon: '🔴', title: 'Show errors only', subtitle: 'in Logs', action: () => {
      navigate('/logs');
      setTimeout(() => { window.dispatchEvent(new CustomEvent('cmdk:apply-filter', { detail: { status: '4xx' } })); }, 50);
  }},
  { id: 'logs-1h', section: 'Filters', icon: '⏱', title: 'Last 1 hour', subtitle: 'in Logs', action: () => {
      navigate('/logs');
      setTimeout(() => { window.dispatchEvent(new CustomEvent('cmdk:apply-filter', { detail: { hours: 1 } })); }, 50);
  }},
  { id: 'logs-24h', section: 'Filters', icon: '⏱', title: 'Last 24 hours', subtitle: 'in Logs', action: () => {
      navigate('/logs');
      setTimeout(() => { window.dispatchEvent(new CustomEvent('cmdk:apply-filter', { detail: { hours: 24 } })); }, 50);
  }},

  { id: 'probe-now', section: 'Actions', icon: '🔄', title: 'Probe all providers now', action: async () => {
      try { await api('/api/providers/probe', { method: 'POST' }); }
      catch (e) { alert(e.message); }
  }},
];

export function getStaticCommands() { return STATIC; }

export async function getDynamicCommands(query) {
  if (!query || query.length < 2) return [];
  const results = [];

  // Model lookups via /v1/models
  try {
    const models = await api('/v1/models');
    const matches = (models.data || []).filter(m => m.id.toLowerCase().includes(query.toLowerCase()));
    for (const m of matches.slice(0, 5)) {
      results.push({
        id: 'model-' + m.id,
        section: 'Models',
        icon: '🤖',
        title: `Filter logs by ${m.id}`,
        subtitle: `provided by ${m.owned_by}`,
        action: () => {
          navigate('/logs');
          setTimeout(() => window.dispatchEvent(new CustomEvent('cmdk:apply-filter', { detail: { models: [m.id], search: '' } })), 50);
        },
      });
    }
  } catch {}

  // Free-text search command
  results.push({
    id: 'search-' + query,
    section: 'Search',
    icon: '🔍',
    title: `Search logs for "${query}"`,
    action: () => {
      navigate('/logs');
      setTimeout(() => window.dispatchEvent(new CustomEvent('cmdk:apply-filter', { detail: { search: query } })), 50);
    },
  });

  return results;
}
