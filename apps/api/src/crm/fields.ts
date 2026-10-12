import type { Q } from '../infra/db.js';
import { Problem } from '../http/problem.js';
import { applyCustomFields, type FieldDef } from '../domain/custom-fields.js';

export type Entity = 'contact' | 'organization' | 'deal' | 'lead';

export async function fieldDefs(q: Q, entity: Entity): Promise<FieldDef[]> {
  const r = await q.query<{ key: string; label: string; type: FieldDef['type']; options: FieldDef['options']; required: boolean; archived: boolean }>(
    `select key, label, type, options, required, archived_at is not null as archived
       from custom_field_definitions where entity = $1 order by position, label`, [entity]);
  return r.rows;
}

/** Valida campos personalizados e lança 422 com os erros por campo. */
export async function customFor(
  q: Q, entity: Entity, input: Record<string, unknown> | undefined, current: Record<string, unknown>, partial: boolean,
): Promise<Record<string, unknown>> {
  const defs = await fieldDefs(q, entity);
  const r = applyCustomFields(defs, input, current, { partial });
  if (r.errors.length) throw Problem.badRequest('Confira os campos destacados.', r.errors);
  return r.value;
}

/** Etiquetas existentes da empresa; identificador desconhecido é erro. */
export async function checkTags(q: Q, tagIds: string[] | undefined): Promise<void> {
  if (!tagIds?.length) return;
  const r = await q.query<{ n: number }>('select count(*)::int as n from tags where id = any($1::uuid[])', [tagIds]);
  if (r.rows[0]!.n !== new Set(tagIds).size) {
    throw Problem.badRequest('Etiqueta inválida.', [{ field: 'tagIds', message: 'Escolha etiquetas da lista.' }]);
  }
}

export type PersonRef = { id: string; name: string } | null;

/** Expressão SQL que devolve {id, name} de um vínculo, ou null. */
export function memberJson(col: string): string {
  return `(select json_build_object('id', m_.id, 'name', u_.name) from memberships m_ join users u_ on u_.id = m_.user_id where m_.id = ${col})`;
}
