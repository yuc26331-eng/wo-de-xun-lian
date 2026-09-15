import { expect, test } from '@playwright/test';
import { ensureTrainingPlan, expectNoHorizontalScroll, expectTouchTargets } from './helpers';

test.describe('iPhone 竖屏布局', () => {
  test('底部导航不遮挡内容，输入框不会被 iOS 放大', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('今日状态')).toBeVisible();
    // 首次打开会自动执行一次性清理并显示结果卡片，等它出现并关闭，避免测量时布局变化
    const cleanupDismiss = page.getByTestId('cleanup-dismiss');
    if (await cleanupDismiss.isVisible({ timeout: 6000 }).catch(() => false)) {
      await cleanupDismiss.click();
    }

    // 输入框字号必须 >= 16px，否则 iPhone Safari 聚焦时会把页面放大
    const smallFont = await page.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll<HTMLInputElement>('input, textarea, select').forEach((el) => {
        const size = Number.parseFloat(getComputedStyle(el).fontSize);
        if (size < 16 && el.offsetParent !== null) bad.push(`${el.tagName} ${size}px`);
      });
      return bad;
    });
    expect(smallFont, '输入框字号小于 16px 会导致 iPhone 自动放大').toEqual([]);

    // 滚到底部后，最后一个卡片不能被底部导航遮住
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);
    const covered = await page.evaluate(() => {
      const tabbar = document.querySelector('.tabbar');
      if (!tabbar) return null;
      const barTop = tabbar.getBoundingClientRect().top;
      const main = document.querySelector('.app-scroll');
      if (!main) return null;
      const cards = Array.from(main.querySelectorAll<HTMLElement>('.card, .list'));
      const last = cards[cards.length - 1];
      if (!last) return null;
      return { lastBottom: last.getBoundingClientRect().bottom, barTop };
    });
    expect(covered).not.toBeNull();
    if (covered) {
      expect(
        covered.lastBottom <= covered.barTop + 2,
        `最后一张卡片底部 ${Math.round(covered.lastBottom)} 超过了导航顶部 ${Math.round(covered.barTop)}`,
      ).toBeTruthy();
    }
    await expectNoHorizontalScroll(page);
  });

  test('样式包含安全区适配与独立窗口配置', async ({ page }) => {
    await page.goto('/');
    const css = await page.evaluate(async () => {
      const href = Array.from(document.styleSheets)
        .map((s) => s.href)
        .find((h) => h && h.includes('.css'));
      if (!href) return '';
      const res = await fetch(href);
      return await res.text();
    });
    expect(css).toContain('env(safe-area-inset-bottom');
    expect(css).toContain('env(safe-area-inset-top');

    const viewport = await page.getAttribute('meta[name="viewport"]', 'content');
    expect(viewport).toContain('viewport-fit=cover');

    const appleCapable = await page.getAttribute('meta[name="apple-mobile-web-app-capable"]', 'content');
    expect(appleCapable).toBe('yes');
  });

  test('跟练页面主要按钮触控区足够大', async ({ page }) => {
    await ensureTrainingPlan(page);
    await page.goto('/');
    await page.getByTestId('start-training').click();
    await expect(page.getByTestId('live-progress')).toContainText(/动作\s*1\s*\/\s*\d+/, {
      timeout: 15_000,
    });
    await expectTouchTargets(page, '.focus-bottom .btn');
    await expectNoHorizontalScroll(page);
  });
});
