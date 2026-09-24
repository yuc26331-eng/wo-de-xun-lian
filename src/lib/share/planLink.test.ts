import { describe, expect, it } from 'vitest';
import { decodePlanLink, encodePlanLink } from './planLink';
import type { TrainingPlan } from '../../types';

const PLAN: TrainingPlan = {
  id: 'shared-test-plan',
  title: '匿名测试计划',
  date: '2026-09-24',
  kind: 'strength',
  source: 'manual',
  estimatedMinutes: 30,
  warmup: [{ name: '快走', detail: '3 分钟', durationSec: 180 }],
  exercises: [
    {
      id: 'shared-test-ex',
      name: '高脚杯深蹲',
      kind: 'strength',
      target: { sets: 3, reps: '10', restSec: 60 },
      order: 0,
    },
  ],
  cooldown: '轻松拉伸',
  notes: '',
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
};

describe('plan link codec', () => {
  it('round-trips a plan through a URL-safe token', () => {
    const token = encodePlanLink(PLAN);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodePlanLink(token)).toEqual(PLAN);
  });

  it('rejects malformed tokens', () => {
    expect(() => decodePlanLink('not-a-plan')).toThrow();
  });
});
