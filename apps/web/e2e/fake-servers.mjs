// Evolution API e SMTP falsos para os testes de ponta a ponta (os mesmos dos
// testes da API). Uso: node e2e/fake-servers.mjs  (Node 24, com tipos removidos).
import { FakeEvolution, FakeMeta, FakeSmtp } from '../../api/test/fakes.ts';

const evo = new FakeEvolution(process.env.FAKE_EVOLUTION_KEY ?? 'chave-e2e');
await evo.start(Number(process.env.FAKE_EVOLUTION_PORT ?? 8790));
const smtp = new FakeSmtp('vendas@aurora.test', 'senha-da-caixa');
await smtp.start(Number(process.env.FAKE_SMTP_PORT ?? 2525));
const meta = new FakeMeta([process.env.FAKE_META_TOKEN ?? 'token-e2e']);
await meta.start(Number(process.env.FAKE_META_PORT ?? 8791));
console.log(`evolution falsa em ${evo.url}; smtp falso na porta ${smtp.port}; meta falsa em ${meta.url}`);
