import { z } from '@hono/zod-openapi';

export const Uuid = z.uuid();
export const TenantParams = z.object({ tenantId: Uuid.openapi({ param: { name: 'tenantId', in: 'path' } }) });
export const ErrorBody = z.object({ error: z.string() }).openapi('Error');

export const errors = {
  401: { description: 'Niet ingelogd', content: { 'application/json': { schema: ErrorBody } } },
  403: { description: 'Geen rechten', content: { 'application/json': { schema: ErrorBody } } },
};
