import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

export type FieldError = { field: string; message: string };

/** Erro no formato RFC 9457 (application/problem+json). */
export class Problem extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly type = 'about:blank',
    readonly detail?: string,
    readonly errors?: FieldError[],
    readonly headers?: Record<string, string>,
  ) {
    super(title);
  }

  static badRequest(title: string, errors?: FieldError[]) {
    return new Problem(422, title, 'validation', undefined, errors);
  }
  static unauthorized(title = 'Faça login para continuar.') {
    return new Problem(401, title, 'unauthenticated');
  }
  static forbidden(title = 'Você não tem permissão para esta ação.', type = 'forbidden') {
    return new Problem(403, title, type);
  }
  static notFound(title = 'Não encontrado.') {
    return new Problem(404, title, 'not-found');
  }
  static conflict(title: string) {
    return new Problem(409, title, 'conflict');
  }
}

const TITLES: Record<number, string> = {
  400: 'Requisição inválida.',
  401: 'Faça login para continuar.',
  403: 'Você não tem permissão para esta ação.',
  404: 'Não encontrado.',
  405: 'Método não permitido.',
  413: 'Conteúdo grande demais.',
  415: 'Formato não suportado.',
  429: 'Muitas tentativas. Aguarde um pouco.',
};

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const req = host.switchToHttp().getRequest<FastifyRequest>();
    let p: Problem;
    if (exception instanceof Problem) {
      p = exception;
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      p = new Problem(status, TITLES[status] ?? 'Erro na requisição.', status === 404 ? 'not-found' : 'about:blank');
    } else if (isFastifyClientError(exception)) {
      const status = exception.statusCode;
      p = new Problem(status, TITLES[status] ?? 'Requisição inválida.');
    } else {
      this.log.error(`erro não tratado em ${req.method} ${req.url} (req ${req.id})`, exception instanceof Error ? exception.stack : String(exception));
      p = new Problem(500, 'Erro interno. Tente de novo em instantes.', 'internal');
    }
    const body: Record<string, unknown> = { type: p.type, title: p.title, status: p.status, request_id: req.id };
    if (p.detail) body.detail = p.detail;
    if (p.errors?.length) body.errors = p.errors;
    void reply
      .status(p.status)
      .headers({ 'content-type': 'application/problem+json; charset=utf-8', ...(p.headers ?? {}) })
      .send(JSON.stringify(body));
  }
}

function isFastifyClientError(e: unknown): e is { statusCode: number } {
  return (
    typeof e === 'object' && e !== null && 'statusCode' in e &&
    typeof (e as { statusCode: unknown }).statusCode === 'number' &&
    (e as { statusCode: number }).statusCode >= 400 && (e as { statusCode: number }).statusCode < 500
  );
}
