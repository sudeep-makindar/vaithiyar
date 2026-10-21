// src/config.js
// Central API config.
// On AWS, CloudFront serves both the site and /api/* from one domain, so production
// defaults to a same-origin relative URL. In local dev, defaults to localhost:8000.
// Set VITE_API_URL to point the build at any other backend.

export const TUNNEL_URL =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? 'http://localhost:8000' : '');

export const BASE_API = `${TUNNEL_URL}/api`;
