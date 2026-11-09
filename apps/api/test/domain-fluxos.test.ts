import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAnswer, flowIssues, graphSchema, keywordScore, nextNode, normalize, parsePayload, payloadFor, renderText, starterGraph, waitMinutes,
  type FlowGraph,
} from '../src/domain/flows.js';

test('palavra-chave: qualquer, contém (palavra inteira, sem acento) e exata', () => {
  assert.equal(keywordScore({ match: 'any', keywords: [] }, ''), 1);
  assert.equal(keywordScore({ match: 'contains', keywords: ['Eu quero'] }, 'EU QUERO muito!'), 2);
  assert.equal(keywordScore({ match: 'contains', keywords: ['preço'] }, 'qual o preco?'), 2, 'sem acento');
  assert.equal(keywordScore({ match: 'contains', keywords: ['quero'] }, 'queroquero'), 0, 'palavra inteira');
  assert.equal(keywordScore({ match: 'contains', keywords: ['quero'] }, ''), 0);
  assert.equal(keywordScore({ match: 'exact', keywords: ['quero'] }, ' Quero! '), 3);
  assert.equal(keywordScore({ match: 'exact', keywords: ['quero'] }, 'quero sim'), 0);
  assert.equal(normalize('  Ação   Já '), 'acao ja');
});

test('variáveis no texto e respostas', () => {
  assert.equal(renderText('Oi, {{nome}}! Seu e-mail: {{ email }}', { nome: 'Ana', email: 'a@b.com' }), 'Oi, Ana! Seu e-mail: a@b.com');
  assert.equal(renderText('Oi, {{nome}} {{desconhecida}}!', { nome: 'Ana' }), 'Oi, Ana !');
  assert.equal(checkAnswer('email', ' Ana@Empresa.com '), 'ana@empresa.com');
  assert.equal(checkAnswer('email', 'ana@'), null);
  assert.equal(checkAnswer('phone', '(11) 98765-4321'), '11987654321');
  assert.equal(checkAnswer('phone', '123'), null);
  assert.equal(checkAnswer('number', '1.500,50'), '1500.5');
  assert.equal(checkAnswer('text', '   '), null);
  assert.equal(waitMinutes({ amount: 2, unit: 'hours' }), 120);
});

test('clique no botão leva a execução e o botão', () => {
  const run = '0b1c2d3e-0000-4000-8000-000000000001';
  assert.deepEqual(parsePayload(payloadFor(run, 'b1')), { runId: run, buttonId: 'b1' });
  assert.equal(parsePayload('outra coisa'), null);
});

test('fluxo inicial do comentário: resposta pública, privado com botão "Quero", sem erros', () => {
  const g = graphSchema.parse(starterGraph('comment'));
  assert.deepEqual(g.nodes.map((n) => n.type), ['trigger', 'comment_reply', 'private_reply']);
  assert.equal(nextNode(g, 'trigger')?.id, 'n1');
  assert.equal(nextNode(g, 'n1')?.id, 'n2');
  const issues = flowIssues(g);
  assert.equal(issues.filter((i) => i.level === 'error').length, 0);
  assert.ok(issues.some((i) => i.nodeId === 'trigger' && /palavra-chave/.test(i.message)), 'pede a palavra-chave');
  assert.ok(issues.some((i) => i.nodeId === 'n2' && /sem o clique/.test(i.message)), 'botão sem próximo passo');
});

test('avisos: janela fechada no comentário, bloco solto, gatilho errado, publicação não escolhida', () => {
  const g: FlowGraph = graphSchema.parse({
    nodes: [
      { id: 'trigger', type: 'trigger', data: { type: 'comment', posts: 'chosen', match: 'contains', keywords: ['quero'] } },
      { id: 'a', type: 'text', data: { text: 'Direto no direct' } },
      { id: 'b', type: 'private_reply', data: { text: 'Oi', buttons: [{ id: 'b1', title: 'Quero' }] } },
      { id: 'c', type: 'text', data: { text: 'Depois do clique' } },
      { id: 'solto', type: 'wait', data: { amount: 2, unit: 'days' } },
    ],
    edges: [
      { id: '1', source: 'trigger', target: 'a' },
      { id: '2', source: 'a', target: 'b' },
      { id: '3', source: 'b', sourceHandle: 'btn:b1', target: 'c' },
    ],
  });
  const issues = flowIssues(g);
  const of = (id: string) => issues.filter((i) => i.nodeId === id).map((i) => i.message).join(' | ');
  assert.match(of('trigger'), /Escolha ao menos uma publicação/);
  assert.match(of('a'), /conversa ainda não está aberta/);
  assert.equal(of('c'), '', 'depois do clique a conversa está aberta');
  assert.match(of('solto'), /não está ligado/);
  assert.match(of('solto'), /24 h/);

  const dm = graphSchema.parse({
    nodes: [{ id: 'trigger', type: 'trigger', data: { type: 'dm_keyword', match: 'any' } }, { id: 'p', type: 'private_reply', data: { text: 'x' } }],
    edges: [{ id: '1', source: 'trigger', target: 'p' }],
  });
  assert.ok(flowIssues(dm).some((i) => i.level === 'error' && /só funciona com gatilho de comentário/.test(i.message)));
});

test('desenho inválido é recusado: dois gatilhos, seta para bloco inexistente', () => {
  assert.equal(graphSchema.safeParse({ nodes: [{ id: 'a', type: 'trigger', data: { type: 'comment' } }, { id: 'b', type: 'trigger', data: { type: 'comment' } }] }).success, false);
  assert.equal(graphSchema.safeParse({ nodes: [{ id: 'a', type: 'trigger', data: { type: 'comment' } }], edges: [{ id: 'x', source: 'a', target: 'z' }] }).success, false);
  for (const t of ['live_comment', 'dm_keyword', 'story_reply', 'story_mention', 'reaction'] as const) {
    assert.equal(graphSchema.safeParse(starterGraph(t)).success, true, t);
  }
});
