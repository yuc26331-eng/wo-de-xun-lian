/**
 * 说明：以下占位页面会被各自的子任务替换为真实实现。
 * 保留占位是为了让工程在并行开发期间始终保持可通过类型检查。
 */
import { Page } from '../components/Page';
import { EmptyState } from '../components/ui';

export function Stub({ title }: { title: string }) {
  return (
    <Page title={title} back>
      <EmptyState title={`${title}正在开发`} desc="该模块由子任务实现" />
    </Page>
  );
}
