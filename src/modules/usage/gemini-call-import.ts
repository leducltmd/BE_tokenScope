import { createHash } from 'node:crypto';
import { open, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../../config/prisma';

const tokenCount = z.number().int().nonnegative().max(2_147_483_647);
const callSchema = z.object({
  model: z.string().max(120).nullish(),
  responseId: z.string().min(1).max(250).nullish(),
  usageMetadata: z.object({
    promptTokenCount: tokenCount.nullish(),
    candidatesTokenCount: tokenCount.nullish(),
    thoughtsTokenCount: tokenCount.nullish(),
    totalTokenCount: tokenCount,
  }),
});

function getDemoCallFile(): string | undefined {
  return (
    process.env.GEMINI_USAGE_DEMO_CALL_FILE?.trim() ||
    (process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'TokenScope-Gemini-last-call.json')
      : undefined)
  );
}

export async function readGeminiDemoCall() {
  const filename = getDemoCallFile();
  return filename ? readCallFile(filename) : undefined;
}

async function readCallFile(filename: string) {
  const file = await open(filename, 'r').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!file) return undefined;

  try {
    const raw = await file.readFile('utf8');
    let json: unknown;
    try {
      json = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch {
      // PowerShell may still be writing the file. Retry on the next read.
      return undefined;
    }
    const call = callSchema.safeParse(json);
    if (!call.success) return undefined;
    const { mtime } = await file.stat();
    return { ...call.data, occurredAt: mtime };
  } finally {
    await file.close();
  }
}

export async function importGeminiDemoCall(userId: string): Promise<void> {
  const latestCallFile = getDemoCallFile();
  if (!latestCallFile) return;

  const providerId = process.env.GEMINI_MONITORING_PROVIDER_ID?.trim();
  const provider = providerId
    ? await prisma.apiProvider.findFirst({
        where: { id: providerId, userId, providerType: 'google' },
        select: { id: true, projectId: true },
      })
    : await prisma.apiProvider.findFirst({
        where: { userId, providerType: 'google' },
        select: { id: true, projectId: true },
      });
  if (!provider) return;

  const pendingDirectory = `${latestCallFile}.pending`;
  const entries = await readdir(pendingDirectory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const name of entries) {
    if (!/^[a-f0-9]{32}\.json$/.test(name)) continue;
    const filename = join(pendingDirectory, name);
    const call = await readCallFile(filename);
    if (!call) continue;
    await saveCall(userId, provider, call);
    await unlink(filename).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  const latestCall = await readCallFile(latestCallFile);
  if (latestCall) await saveCall(userId, provider, latestCall);
}

async function saveCall(
  userId: string,
  provider: { id: string; projectId: string | null },
  call: NonNullable<Awaited<ReturnType<typeof readCallFile>>>,
): Promise<void> {
  const model = call.model || 'Gemini';
  const counts = call.usageMetadata;
  const key = call.responseId
    ? ['response', call.responseId]
    : ['legacy', model, counts.promptTokenCount ?? 0, counts.candidatesTokenCount ?? 0,
       counts.thoughtsTokenCount ?? 0, counts.totalTokenCount];
  const id = createHash('sha256')
    .update(JSON.stringify([userId, provider.id, key]))
    .digest('hex');

  if (await prisma.usageRecord.findUnique({ where: { id }, select: { id: true } })) return;

  try {
    await prisma.usageRecord.create({
      data: {
        id,
        userId,
        apiProviderId: provider.id,
        projectId: provider.projectId,
        model,
        promptTokens: counts.promptTokenCount ?? 0,
        completionTokens: counts.candidatesTokenCount ?? 0,
        totalTokens: counts.totalTokenCount,
        occurredAt: call.occurredAt,
      },
    });
  } catch (error) {
    // Two requests can read the same export before either creates its row.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
      throw error;
    }
  }
}
