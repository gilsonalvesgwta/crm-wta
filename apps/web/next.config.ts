import path from 'node:path';
import type { NextConfig } from 'next';

// Em produção o Traefik manda /api direto para a API. A regra abaixo cobre o
// desenvolvimento e os testes, quando a interface é o único endereço.
const api = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

const config: NextConfig = {
  output: 'standalone',
  // Monorepo: o rastreamento de arquivos parte da raiz do repositório.
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  poweredByHeader: false,
  reactStrictMode: true,
  // Título e ícone da empresa vêm de uma busca à API (generateMetadata). Sem isto o
  // Next os manda depois do corpo, e a página fica um instante sem título.
  htmlLimitedBots: /.*/,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
