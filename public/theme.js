// 主题独立于业务脚本初始化；即使模型服务未连接，也可以正常切换外观。
(() => {
  const storageKey = 'answer-book:theme:v1';
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const normalize = (value) => ['light', 'dark'].includes(value) ? value : 'system';
  let preference = 'system';

  try {
    preference = normalize(localStorage.getItem(storageKey));
  } catch {
    // 隐私模式或存储被禁用时，仍允许在当前页面使用主题选择器。
  }

  function applyTheme() {
    const theme = preference === 'system' ? (systemTheme.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#1c1f1b' : '#f8f7f3';
    const select = document.querySelector('#theme-select');
    if (select) select.value = preference;
  }

  applyTheme();

  document.addEventListener('DOMContentLoaded', () => {
    const select = document.querySelector('#theme-select');
    select.value = preference;
    select.addEventListener('change', () => {
      preference = normalize(select.value);
      applyTheme();
      try {
        localStorage.setItem(storageKey, preference);
      } catch {
        // 保存失败不回滚视觉选择，避免存储限制打断正常使用。
      }
    });
  });

  systemTheme.addEventListener('change', () => {
    if (preference === 'system') applyTheme();
  });

  // 同一站点在其他标签页切换主题或清空偏好时，同步当前页面。
  window.addEventListener('storage', (event) => {
    if (event.key !== storageKey && event.key !== null) return;
    try {
      if (event.storageArea !== localStorage) return;
    } catch {
      return;
    }
    preference = normalize(event.newValue);
    applyTheme();
  });
})();
