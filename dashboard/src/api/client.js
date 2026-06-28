const BASE = 'http://localhost:3500';

async function req(method, path, body, extraHeaders = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Session
export const getCurrentSession  = ()         => req('GET',  '/api/session/current');
export const getSessionHistory   = ()         => req('GET',  '/api/session/history');

// Viewers
export const getViewers          = (params)   => req('GET',  `/api/viewers?${new URLSearchParams(params || {})}`);
export const getViewer           = (id)       => req('GET',  `/api/viewers/${id}`);

// Logs
export const getLogs             = (params)   => req('GET',  `/api/logs?${new URLSearchParams(params || {})}`);
export const deleteLogs          = (body)     => req('DELETE', '/api/logs', body, { 'X-Confirm': 'DELETE' });

// Stats
export const getStats            = ()         => req('GET',  '/api/stats');

// Followers
export const getFollowers        = ()         => req('GET',  '/api/followers');
export const syncFollowers       = ()         => req('GET',  '/api/followers/sync');

// Favorites
export const getFavorites        = ()         => req('GET',  '/api/favorites');
export const addFavorite         = (body)     => req('POST', '/api/favorites', body);
export const removeFavorite      = (username) => req('DELETE', `/api/favorites/${username}`);
export const reorderFavorites    = (ordered)  => req('PUT',  '/api/favorites/reorder', { ordered });

// Blacklist
export const getBlacklist        = ()         => req('GET',  '/api/blacklist');
export const addToBlacklist      = (body)     => req('POST', '/api/blacklist', body);
export const removeFromBlacklist = (channel)  => req('DELETE', `/api/blacklist/${channel}`);

// Database
export const getDbStats          = ()         => req('GET',  '/api/database/stats');
export const getDbMemory         = ()         => req('GET',  '/api/database/memory');
export const deleteDbLogs        = (body)     => req('DELETE', '/api/database/logs', body, { 'X-Confirm': 'DELETE' });
export const deleteDbViewers     = (body)     => req('DELETE', '/api/database/viewers', body, { 'X-Confirm': 'DELETE' });
export const exportTable         = (table)    => `${BASE}/api/database/export/${table}`;

// API Monitor
export const getApiCalls         = (params)   => req('GET', `/api/monitor/calls?${new URLSearchParams(params || {})}`);
export const getSpend            = ()         => req('GET', '/api/monitor/spend');
export const getHealth           = ()         => req('GET', '/api/monitor/health');
