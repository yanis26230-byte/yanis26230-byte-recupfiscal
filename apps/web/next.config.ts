import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
/**
 * Politique de sécurité du contenu. 'unsafe-inline' reste nécessaire aux scripts d'hydratation de
 * Next.js sans nonce ; 'unsafe-eval' uniquement en développement (rechargement à chaud).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ''}`,
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  ...(isProd && process.env.APP_URL?.startsWith('https://') ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@recupfiscal/engine'],
  serverExternalPackages: ['@electric-sql/pglite', 'pg', '@react-pdf/renderer', 'unpdf', 'read-excel-file'],
  experimental: { serverActions: { bodySizeLimit: '16mb' } },
  webpack: (cfg) => {
    // Le moteur importe ses fichiers TypeScript avec l'extension .js (ESM).
    cfg.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return cfg;
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
