// 插件设置页逻辑

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();
  await loadCurrentShortcut();
});

// 从 storage 加载已保存的设置
async function loadSettings() {
  const data = await chrome.storage.local.get('quickOpenCount');
  const countEl = document.getElementById('quickOpenCount');
  if (countEl) countEl.value = data.quickOpenCount ?? 10;
}

// 加载当前已配置的快捷键（通过 chrome.commands API 读取）
async function loadCurrentShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const quickOpenCmd = commands.find(c => c.name === 'quick-open-results');
    if (quickOpenCmd && quickOpenCmd.shortcut) {
      const shortcutEl = document.getElementById('currentShortcut');
      if (shortcutEl) {
        const formatted = quickOpenCmd.shortcut.replace(/\+/g, ' + ');
        shortcutEl.textContent = formatted;
      }
    }
  } catch (e) {
    console.error('读取快捷键失败:', e);
  }
}

// 设置事件监听器
function setupEventListeners() {
  document.getElementById('saveBtn').addEventListener('click', saveSettings);

  const shortcutsBtn = document.getElementById('shortcutsPageBtn');
  if (shortcutsBtn) {
    shortcutsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
  }
}

// 保存设置
async function saveSettings() {
  const countEl = document.getElementById('quickOpenCount');
  const count = parseInt(countEl.value);
  if (isNaN(count) || count < 1 || count > 50) {
    showStatus('打开数量必须在 1 到 50 之间', 'error');
    return;
  }
  try {
    await chrome.storage.local.set({ quickOpenCount: count });
    showStatus('✅ 设置已保存！', 'success');
  } catch (e) {
    showStatus('保存失败: ' + e.message, 'error');
  }
}

// 显示状态消息
function showStatus(msg, type) {
  const statusEl = document.getElementById('saveStatus');
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className = 'save-status ' + type;
  setTimeout(() => {
    statusEl.className = 'save-status';
  }, 3000);
}
