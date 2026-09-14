import { Page } from '../components/Page';
import { EmptyState } from '../components/ui';

export default function ProfilePage() {
  return (
    <Page title="我的">
      <EmptyState title="我的页面加载中" />
    </Page>
  );
}
