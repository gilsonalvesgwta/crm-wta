import type { z } from 'zod';
import { Problem } from './problem.js';

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value ?? {});
  if (r.success) return r.data;
  const errors = r.error.issues.map((i) => ({
    field: i.path.map(String).join('.') || '(corpo)',
    message: i.message,
  }));
  throw Problem.badRequest('Confira os campos destacados.', errors);
}
