import type { PrismaClient, Prisma } from '@prisma/client';

// Best-effort - a logging failure must never block the actual action it's recording.
export async function audit(
  prisma: PrismaClient,
  params: { orgId: string; actorId: string; action: string; targetId?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        org_id: params.orgId,
        actor_id: params.actorId,
        action: params.action,
        target_id: params.targetId,
        metadata: params.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  } catch {
    /* swallow - audit logging is best-effort, never breaks the caller */
  }
}
