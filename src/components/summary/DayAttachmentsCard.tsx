// 今日总结详情里的「今天的截图」卡片：
// 全天活动 / 睡眠 / 每次训练的原图都保存在本机，点缩略图即可放大查看。
import type { DailyLog, ISODate } from '../../types';
import { Card } from '../ui';
import { useAppData } from '../../state/AppData';
import { AttachmentGrid, statusInfo } from './AttachmentGrid';
import { sleepDurationText } from '../../lib/ocr/parse';

export function DayAttachmentsCard({ log, date }: { log: DailyLog | null; date: ISODate }) {
  const { attachments } = useAppData();
  const shots = attachments.filter((a) => a.date === date);
  const sessions = log?.training?.sessions ?? [];

  if (!shots.length) return null;

  const nameOfSession = (sessionId?: string | null): string | undefined => {
    if (!sessionId) return undefined;
    const idx = sessions.findIndex((s) => s.id === sessionId);
    if (idx < 0) return '未对应的训练';
    const s = sessions[idx];
    return `第 ${idx + 1} 次训练${s.startTime ? ` · ${s.startTime}` : ''}${s.name ? ` · ${s.name}` : ''}`;
  };

  const groups = [
    {
      title: '全天活动截图',
      items: shots.filter((a) => a.kind === 'watch' && !a.sessionId),
    },
    { title: '睡眠截图', items: shots.filter((a) => a.kind === 'sleep') },
    { title: '单次训练截图', items: shots.filter((a) => a.kind === 'watch' && a.sessionId) },
    { title: '其他图片', items: shots.filter((a) => a.kind === 'other') },
  ].filter((g) => g.items.length > 0);

  const recognized = shots.filter((a) => a.ocrStatus === 'done' || a.ocrStatus === 'partial').length;

  return (
    <Card>
      <div className="row-between">
        <span className="strong">📷 今天的截图（保存在本机）</span>
        <span className="tiny muted">
          共 {shots.length} 张 · 识别到数据 {recognized} 张
        </span>
      </div>
      {log?.sleep?.totalHours != null && (
        <div className="tiny muted" style={{ marginTop: 6 }}>
          当天睡眠：{sleepDurationText(log.sleep.totalHours)}
        </div>
      )}
      {groups.map((g) => (
        <div key={g.title} style={{ marginTop: 10 }}>
          <div className="small muted" style={{ marginBottom: 2 }}>
            {g.title}
          </div>
          <AttachmentGrid
            attachments={g.items}
            labelOf={(shot) =>
              shot.sessionId
                ? nameOfSession(shot.sessionId)
                : shot.kind === 'sleep'
                  ? '睡眠'
                  : '全天'
            }
          />
          <div className="tiny muted" style={{ marginTop: 4 }}>
            {g.items.map((a) => `${a.name}：${statusInfo(a).text}`).join(' · ')}
          </div>
        </div>
      ))}
      <div className="tiny muted" style={{ marginTop: 10 }}>
        点缩略图可以放大查看原图；识别不到数值时原图也会一直保留，不会因为识别失败而丢掉。
      </div>
    </Card>
  );
}
