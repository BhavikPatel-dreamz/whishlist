import db from "../../db.server";

/**
 * Central Postgres token-bucket for global Mailgun send rate.
 * All workers share the single `SendRateLimit` row id=global.
 * Returns false when no token is available (caller should sleep/backoff).
 */
export async function tryAcquireSendToken(
  cost = 1,
): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "SendRateLimit" ("id", "tokens", "maxTokens", "refillPerSec", "updatedAt")
      VALUES ('global', 20, 20, 20, NOW())
      ON CONFLICT ("id") DO NOTHING
    `;

    const rows = await tx.$queryRaw<
      Array<{
        tokens: number;
        maxTokens: number;
        refillPerSec: number;
        updatedAt: Date;
      }>
    >`
      SELECT "tokens", "maxTokens", "refillPerSec", "updatedAt"
      FROM "SendRateLimit"
      WHERE "id" = 'global'
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return { ok: false as const, retryAfterMs: 1000 };

    const now = Date.now();
    const elapsedSec = Math.max(
      0,
      (now - new Date(row.updatedAt).getTime()) / 1000,
    );
    const refilled = Math.min(
      row.maxTokens,
      row.tokens + elapsedSec * row.refillPerSec,
    );

    if (refilled < cost) {
      const need = cost - refilled;
      const retryAfterMs = Math.ceil((need / row.refillPerSec) * 1000);
      await tx.$executeRaw`
        UPDATE "SendRateLimit"
        SET "tokens" = ${refilled}, "updatedAt" = NOW()
        WHERE "id" = 'global'
      `;
      return { ok: false as const, retryAfterMs: Math.max(retryAfterMs, 50) };
    }

    await tx.$executeRaw`
      UPDATE "SendRateLimit"
      SET "tokens" = ${refilled - cost}, "updatedAt" = NOW()
      WHERE "id" = 'global'
    `;
    return { ok: true as const };
  });

  return result;
}

/** Ops: change global refill rate (emails/sec). */
export async function configureSendRate(params: {
  refillPerSec: number;
  maxTokens?: number;
}): Promise<void> {
  const max = params.maxTokens ?? params.refillPerSec;
  await db.sendRateLimit.upsert({
    where: { id: "global" },
    create: {
      id: "global",
      tokens: max,
      maxTokens: max,
      refillPerSec: params.refillPerSec,
    },
    update: {
      maxTokens: max,
      refillPerSec: params.refillPerSec,
      tokens: max,
    },
  });
}
