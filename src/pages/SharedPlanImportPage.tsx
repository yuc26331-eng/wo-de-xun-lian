/** 私有计划链接：在手机本地解析 URL 片段中的计划并立即进入跟练。 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Page } from '../components/Page';
import { Button, Card, EmptyState } from '../components/ui';
import { useAppData } from '../state/AppData';
import { decodePlanLink } from '../lib/share/planLink';

export default function SharedPlanImportPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { ready, savePlan } = useAppData();
  const [error, setError] = useState<string | null>(null);
  const token = params.get('d') ?? '';

  useEffect(() => {
    if (!ready || error) return;
    if (!token) {
      setError('链接缺少训练计划数据');
      return;
    }
    try {
      const plan = decodePlanLink(token);
      void savePlan({ ...plan, updatedAt: new Date().toISOString() }).then(() =>
        navigate(`/live?plan=${encodeURIComponent(plan.id)}`, { replace: true }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '训练计划链接无效');
    }
  }, [error, navigate, ready, savePlan, token]);

  if (error) {
    return (
      <Page title="计划导入失败" back>
        <EmptyState
          emoji="⚠️"
          title="无法读取这份训练计划"
          desc={error}
          action={
            <Button variant="primary" size="lg" onClick={() => navigate('/train')}>
              返回训练页
            </Button>
          }
        />
      </Page>
    );
  }

  return (
    <Page title="正在添加训练计划" hideTab>
      <Card>
        <div className="strong">正在把计划保存到这台设备…</div>
        <div className="tiny muted" style={{ marginTop: 6 }}>
          数据只从链接片段在本机解析，不会上传到服务器。
        </div>
      </Card>
    </Page>
  );
}
