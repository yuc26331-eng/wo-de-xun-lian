import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentMeta, TrainingSection } from '../../types';
import { TrainingSessionsCard } from './TrainingSessionsCard';

const appData = vi.hoisted(() => ({
  useAppData: vi.fn(),
  deleteAttachment: vi.fn(),
}));

vi.mock('../../state/AppData', () => ({
  useAppData: appData.useAppData,
}));

const attachment = (id: string, sessionId: string): AttachmentMeta => ({
  id,
  sessionId,
  date: '2026-09-16',
  kind: 'watch',
  name: `${id}.png`,
  type: 'image/png',
  size: 100,
  createdAt: '2026-09-16T08:00:00.000Z',
});

describe('TrainingSessionsCard', () => {
  beforeEach(() => {
    appData.deleteAttachment.mockReset();
    appData.deleteAttachment.mockResolvedValue(undefined);
    appData.useAppData.mockReturnValue({
      attachments: [
        attachment('att-a-1', 'session-a'),
        attachment('att-a-2', 'session-a'),
        attachment('att-b-1', 'session-b'),
      ],
      deleteAttachment: appData.deleteAttachment,
    });
  });

  it('删除训练卡片时只删除该 sessionId 的附件', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onDirty = vi.fn();
    const training: TrainingSection = {
      sessionCount: 2,
      sessions: [
        { id: 'session-a', name: '上午力量', watchRecorded: false },
        { id: 'session-b', name: '晚上足球', watchRecorded: false },
      ],
    };

    render(
      <TrainingSessionsCard
        date="2026-09-16"
        training={training}
        onChange={onChange}
        onDirty={onDirty}
      />,
    );

    await user.click(screen.getByTestId('session-remove-0'));
    await user.click(screen.getByTestId('session-remove-confirm-0'));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(appData.deleteAttachment).toHaveBeenCalledTimes(2);
    expect(appData.deleteAttachment).toHaveBeenCalledWith('att-a-1');
    expect(appData.deleteAttachment).toHaveBeenCalledWith('att-a-2');
    expect(appData.deleteAttachment).not.toHaveBeenCalledWith('att-b-1');
    expect(onChange).toHaveBeenCalledWith({
      sessions: [{ id: 'session-b', name: '晚上足球', watchRecorded: false }],
      sessionCount: 1,
    });
    expect(onDirty).toHaveBeenCalledTimes(1);
  });
});
