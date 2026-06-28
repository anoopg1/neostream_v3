import { useState, useCallback } from 'react';

const BASE_URL = 'http://localhost:3500';

/**
 * Provides typed HTTP helpers (get, post, del) with shared loading and error state.
 * All requests use JSON content type and base URL http://localhost:3500.
 *
 * @returns {{ get: Function, post: Function, del: Function, loading: boolean, error: string|null }}
 */
export function useApi() {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const request = useCallback(async (method, path, body, headers = {}) => {
    setLoading(true);
    setError(null);
    try {
      const options = {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
      };
      if (body !== undefined) {
        options.body = JSON.stringify(body);
      }
      const res = await fetch(`${BASE_URL}${path}`, options);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.error || `HTTP ${res.status}`;
        setError(msg);
        return { ok: false, error: msg, data: null };
      }
      return { ok: true, error: null, data };
    } catch (err) {
      setError(err.message);
      return { ok: false, error: err.message, data: null };
    } finally {
      setLoading(false);
    }
  }, []);

  const get  = useCallback((path, headers)         => request('GET',    path, undefined, headers), [request]);
  const post = useCallback((path, body, headers)   => request('POST',   path, body,      headers), [request]);
  const del  = useCallback((path, body, headers)   => request('DELETE', path, body,      headers), [request]);
  const put  = useCallback((path, body, headers)   => request('PUT',    path, body,      headers), [request]);

  return { get, post, del, put, loading, error };
}
