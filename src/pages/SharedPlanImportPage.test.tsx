import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import SharedPlanImportPage from './SharedPlanImportPage';
import { AppDataProvider } from '../state/AppData';
import { ToastProvider } from '../components/ui';
import { dbClearAll, dbGetAll } from '../db/db';
import { encodePlanLink } from '../lib/share/planLink';
import type { TrainingPlan } from '../types';

const PLAN: TrainingPlan = {
  id: 'shared-page-plan',
  title: '手机导入计划',
  date: '2026-09-24',
  kind: 'strength',
  source: 'manual',
  estimatedMinutes: 30,
  warmup: [],
  exercises: [
    {
      id: 'shared-page-ex',
      name: '深蹲',
      kind: 'strength',
      target: { sets: 3, reps: '10' },
      order: 0,
    },
  ],
  cooldown: '',
  notes: '',
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
};

describe('SharedPlanImportPage', () => {
  beforeEach(async () => {
    await dbClearAll();
  });

  it('saves the shared plan locally and starts the live workout', async () => {
    render(
      <AppDataProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/import/shared-plan?d=${encodePlanLink(PLAN)}`]}>
            <Routes>
              <Route path="/import/shared-plan" element={<SharedPlanImportPage />} />
              <Route path="/live" element={<div data-testid="shared-live" />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </AppDataProvider>,
    );

    await screen.findByTestId('shared-live', {}, { timeout: 8000 });
    await waitFor(async () => {
      expect((await dbGetAll('plans')).some((plan) => plan.id === PLAN.id)).toBe(true);
    });
  });
});
