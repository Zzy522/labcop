import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { withErrorHandler, validationError } from '@/lib/api-utils';
import { onboardingUpdateSchema } from '@/lib/validations/onboarding';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const progress = await prisma.onboardingProgress.findMany({
    where: { userId: ctx.userId },
    orderBy: [{ guideKey: 'asc' }, { guideVersion: 'desc' }],
  });
  return NextResponse.json({ data: progress });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const parsed = onboardingUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const input = parsed.data;
  const now = new Date();

  const data = (() => {
    switch (input.action) {
      case 'START':
      case 'RESTART':
        return { status: 'IN_PROGRESS', lastStep: input.action === 'RESTART' ? 0 : (input.lastStep ?? 0), completedAt: null, dismissedAt: null };
      case 'PROGRESS':
        return { status: 'IN_PROGRESS', lastStep: input.lastStep ?? 0 };
      case 'COMPLETE':
        return { status: 'COMPLETED', lastStep: input.lastStep ?? 0, completedAt: now, dismissedAt: null };
      case 'DISMISS':
        return { status: 'DISMISSED', lastStep: input.lastStep ?? 0, dismissedAt: now, doNotAutoPrompt: input.doNotAutoPrompt ?? false };
      case 'ENABLE_AUTO':
        return { status: 'NOT_STARTED', lastStep: 0, completedAt: null, dismissedAt: null, doNotAutoPrompt: false };
    }
  })();

  const progress = await prisma.onboardingProgress.upsert({
    where: { userId_guideKey_guideVersion: { userId: ctx.userId, guideKey: input.guideKey, guideVersion: input.guideVersion } },
    create: { userId: ctx.userId, guideKey: input.guideKey, guideVersion: input.guideVersion, ...data },
    update: data,
  });
  return NextResponse.json({ data: progress });
});
