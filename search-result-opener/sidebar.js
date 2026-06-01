let currentGroupId = null;
let tabs = [];
let currentTabId = null;

// 页面加载时初始化
document.addEventListener("DOMContentLoaded", () => {
  loadTabGroup();
  setupEventListeners();
});

// 设置事件监听器
function setupEventListeners() {
  // 关闭按钮
  document.getElementById("closeBtn").addEventListener("click", () => {
    window.close();
  });

  // 上一个/下一个按钮
  document.getElementById("prevBtn").addEventListener("click", () => {
    navigateTab(-1);
  });

  document.getElementById("nextBtn").addEventListener("click", () => {
    navigateTab(1);
  });

  // 保存图片按钮：在当前活跃标签页中启动图片捕捉模式
  document.getElementById("captureBtn").addEventListener("click", () => {
    startImageCapture();
  });

  // 关闭未标记页面按钮
  document.getElementById("closeUnpinnedBtn").addEventListener("click", () => {
    closeUnpinnedTabs();
  });

  // 监听标签页激活变化（切换高亮）
  chrome.tabs.onActivated.addListener(() => {
    loadTabGroup();
  });

  // 监听存储变化（当新搜索发起时，currentGroup 会更新）
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.currentGroup) {
      loadTabGroup();
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "complete" || changeInfo.title) {
      loadTabGroup();
    }
  });

  chrome.tabs.onRemoved.addListener(() => {
    loadTabGroup();
  });
}

// 当前 pinnedTabIds（全局，供 renderTabList 使用）
let pinnedTabIds = [];

// 加载标签页组信息（支持多群组：根据当前活跃标签找到所属群组）
async function loadTabGroup() {
  try {
    const data = await chrome.storage.local.get(["tabGroups", "currentGroup"]);

    // 获取当前活跃标签
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    currentTabId = activeTab ? activeTab.id : null;

    // 在所有群组中查找活跃标签所属的群组
    let groupInfo = null;
    const allGroups = data.tabGroups || [];

    if (currentTabId && allGroups.length > 0) {
      groupInfo = allGroups.find(
        (g) => g.tabIds && g.tabIds.includes(currentTabId),
      );
    }

    // 如果活跃标签不属于任何群组，回退到 currentGroup
    if (
      !groupInfo &&
      data.currentGroup &&
      data.currentGroup.tabIds &&
      data.currentGroup.tabIds.length > 0
    ) {
      groupInfo = data.currentGroup;
    }

    if (!groupInfo || !groupInfo.tabIds || groupInfo.tabIds.length === 0) {
      showEmptyState();
      return;
    }

    currentGroupId = groupInfo.groupId;
    pinnedTabIds = groupInfo.pinnedTabIds || [];

    document.getElementById("partNumber").textContent =
      groupInfo.partNumber || "-";
    document.getElementById("supplier").textContent = groupInfo.supplier || "-";

    const tabPromises = groupInfo.tabIds.map((id) =>
      chrome.tabs.get(id).catch(() => null),
    );

    const allTabs = await Promise.all(tabPromises);
    const validTabs = allTabs.filter((tab) => tab !== null);

    // 排序：被旗帜标记的排在最前，其余按原序
    const pinned = validTabs.filter((t) => pinnedTabIds.includes(t.id));
    const unpinned = validTabs.filter((t) => !pinnedTabIds.includes(t.id));
    tabs = [...pinned, ...unpinned];

    document.getElementById("tabCount").textContent = `${tabs.length}个页面`;

    renderTabList();
    updateNavigationButtons();
  } catch (error) {
    console.error("Error loading tab group:", error);
    showEmptyState();
  }
}

// 显示空状态
function showEmptyState() {
  const tabList = document.getElementById("tabList");
  tabList.innerHTML = `
    <div class="empty-state">
      <p>暂无标签页</p>
      <p class="hint">使用插件打开搜索结果后，这里会显示所有页面</p>
    </div>
  `;

  document.getElementById("partNumber").textContent = "-";
  document.getElementById("supplier").textContent = "-";
  document.getElementById("tabCount").textContent = "0个页面";

  document.getElementById("prevBtn").disabled = true;
  document.getElementById("nextBtn").disabled = true;
}

// 关闭单个标签页
async function closeTab(tabId, event) {
  event.stopPropagation();
  try {
    await chrome.tabs.remove(tabId);
    // tabs.onRemoved 会触发 loadTabGroup 自动刷新
  } catch (e) {
    console.error("close tab error:", e);
  }
}

// 切换旗帜标记（支持多个，所有被标记的显示在最前）
async function togglePinTab(tabId, event) {
  event.stopPropagation();
  try {
    const data = await chrome.storage.local.get("currentGroup");
    if (!data.currentGroup) return;
    const group = data.currentGroup;
    if (!group.pinnedTabIds) group.pinnedTabIds = [];

    const pinIdx = group.pinnedTabIds.indexOf(tabId);
    const isNewPin = pinIdx === -1;

    if (isNewPin) {
      // 未标记 → 标记
      group.pinnedTabIds.push(tabId);
    } else {
      // 已标记 → 取消标记
      group.pinnedTabIds.splice(pinIdx, 1);
    }

    await chrome.storage.local.set({ currentGroup: group });

    // 如果是新标记操作，自动跳到下一个未标记的页面
    if (isNewPin) {
      // 在当前 tabs 列表中找到被标记项的位置，然后找下一个未被标记的 tab
      const currentIndex = tabs.findIndex((t) => t.id === tabId);
      const newPinnedIds = group.pinnedTabIds;
      let nextTab = null;
      // 从当前位置往后找第一个未标记的
      for (let i = currentIndex + 1; i < tabs.length; i++) {
        if (!newPinnedIds.includes(tabs[i].id)) {
          nextTab = tabs[i];
          break;
        }
      }
      // 如果后面没有，从头找
      if (!nextTab) {
        for (let i = 0; i < currentIndex; i++) {
          if (!newPinnedIds.includes(tabs[i].id)) {
            nextTab = tabs[i];
            break;
          }
        }
      }
      if (nextTab) {
        await chrome.tabs.update(nextTab.id, { active: true });
        await chrome.windows.update(nextTab.windowId, { focused: true });
      }
    }

    // 立即刷新列表
    await loadTabGroup();
  } catch (e) {
    console.error("pin tab error:", e);
  }
}

// 渲染标签页列表
function renderTabList() {
  const tabList = document.getElementById("tabList");

  if (tabs.length === 0) {
    showEmptyState();
    return;
  }

  tabList.innerHTML = "";
  let activeItem = null;

  tabs.forEach((tab, index) => {
    const tabItem = document.createElement("div");
    tabItem.className = "tab-item";
    const isActive = tab.id === currentTabId;
    if (isActive) {
      tabItem.classList.add("active");
      activeItem = tabItem;
    }

    let hostname = "-";
    try {
      hostname = new URL(tab.url).hostname;
    } catch (e) {
      hostname = tab.url;
    }

    const favicon =
      tab.favIconUrl ||
      "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌐</text></svg>";

    // 是否已被旗帜标记
    const isPinned = pinnedTabIds.includes(tab.id);

    tabItem.innerHTML = `
      <div class="tab-favicon">
        <img src="${favicon}" 
             alt="favicon"
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌐</text></svg>'">
      </div>
      <div class="tab-info">
        <div class="tab-header">
          <div class="tab-number">${index + 1}.</div>
          <div class="tab-title" title="${escapeHtml(tab.title)}">${escapeHtml(tab.title)}</div>
        </div>
        <div class="tab-url" title="${escapeHtml(hostname)}">${escapeHtml(hostname)}</div>
      </div>
      <button class="tab-pin-btn${isPinned ? " pinned" : ""}" title="${isPinned ? "取消标记" : "标记并置顶"}">🚩</button>
      <button class="tab-close-btn" title="关闭此页面">×</button>
    `;

    // 点击跳转到标签页
    tabItem.addEventListener("click", () => {
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
    });

    // 旗帜按钮（切换标记）
    tabItem.querySelector(".tab-pin-btn").addEventListener("click", (e) => {
      togglePinTab(tab.id, e);
    });

    // 关闭按钮
    tabItem.querySelector(".tab-close-btn").addEventListener("click", (e) => {
      closeTab(tab.id, e);
    });

    tabList.appendChild(tabItem);
  });

  // active 项滚动到可视区域中间
  if (activeItem) {
    requestAnimationFrame(() => {
      activeItem.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }
}

// 导航到上一个/下一个标签页
async function navigateTab(direction) {
  if (tabs.length === 0) return;

  const currentIndex = tabs.findIndex((t) => t.id === currentTabId);

  if (currentIndex === -1) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    return;
  }

  const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
  const nextTab = tabs[nextIndex];

  await chrome.tabs.update(nextTab.id, { active: true });
  await chrome.windows.update(nextTab.windowId, { focused: true });
}

// 更新导航按钮状态
function updateNavigationButtons() {
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");

  if (tabs.length <= 1) {
    prevBtn.disabled = true;
    nextBtn.disabled = true;
  } else {
    prevBtn.disabled = false;
    nextBtn.disabled = false;
  }
}

// HTML转义函数
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

// 关闭所有未标记旗帜的页面
async function closeUnpinnedTabs() {
  try {
    const unpinnedTabs = tabs.filter((t) => !pinnedTabIds.includes(t.id));
    if (unpinnedTabs.length === 0) return;
    const tabIds = unpinnedTabs.map((t) => t.id);
    await chrome.tabs.remove(tabIds);
    // tabs.onRemoved 会触发 loadTabGroup 自动刷新
  } catch (e) {
    console.error("closeUnpinnedTabs error:", e);
  }
}

// 启动元素捕捉模式：在活跃标签页中注入元素选择器（类似 Save to Notion）
async function startImageCapture() {
  const btn = document.getElementById("captureBtn");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    // 检查是否为受限页面（chrome://, chrome-extension:// 等无法注入脚本）
    if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:"))) {
      btn.querySelector("span:last-child").textContent = "此页面不支持";
      setTimeout(() => { btn.querySelector("span:last-child").textContent = "保存截图"; }, 2000);
      return;
    }

    // 获取当前料号作为文件名
    const data = await chrome.storage.local.get("currentGroup");
    let partNumber = data.currentGroup?.partNumber || "capture";
    // 去除料号中的空格
    partNumber = partNumber.replace(/\s+/g, "");

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectImageCapture,
      args: [partNumber],
    });
  } catch (e) {
    console.error("startImageCapture error:", e);
    btn.querySelector("span:last-child").textContent = "注入失败";
    setTimeout(() => { btn.querySelector("span:last-child").textContent = "保存截图"; }, 2000);
  }
}

// ============================================================
// 元素 / 区域捕捉器（注入到目标标签页执行）
// 类似 Save to Notion — Save Custom Area：
//   元素模式: 鼠标移动 → 蓝色遮罩 + tooltip 信息 → 滚轮切换父/子元素 → 单击保存
//   区域模式: 按 R 切换 → 拖拽框选矩形区域 → 松开保存
//   Esc 退出
// ============================================================
function injectImageCapture(partNumber) {
  // --- 清理上一次残留 ---
  if (window.__img_capture_timer) { clearTimeout(window.__img_capture_timer); window.__img_capture_timer = null; }
  var IDS = ["__imgc_banner", "__imgc_overlay", "__imgc_tooltip", "__imgc_rect", "__imgc_style"];
  IDS.forEach(function (id) {
    try { var old = document.getElementById(id); if (old) old.remove(); } catch (e) {}
  });

  // --- 代数标记 ---
  window.__img_capture_gen = (window.__img_capture_gen || 0) + 1;
  var currentGen = window.__img_capture_gen;

  // ================================================================
  // 注入样式
  // ================================================================
  var style = document.createElement("style");
  style.id = "__imgc_style";
  style.textContent =
    "#__imgc_banner{" +
      "position:fixed;top:0;left:0;right:0;z-index:2147483647;" +
      "padding:10px 16px;text-align:center;pointer-events:none;" +
      "background:linear-gradient(135deg,#1a73e8,#1557b0);color:#fff;font-size:13px;" +
      "font-family:system-ui,'Microsoft YaHei',sans-serif;" +
      "box-shadow:0 2px 12px rgba(0,0,0,0.25);line-height:1.5;" +
    "}" +
    "#__imgc_banner kbd{" +
      "display:inline-block;padding:1px 6px;margin:0 2px;" +
      "background:rgba(255,255,255,0.2);border-radius:3px;" +
      "font-size:12px;font-family:monospace;border:1px solid rgba(255,255,255,0.3);" +
    "}" +
    "#__imgc_overlay{" +
      "position:fixed;z-index:2147483646;pointer-events:none;" +
      "background:rgba(26,115,232,0.12);" +
      "outline:2px solid rgba(26,115,232,0.6);" +
      "display:none;transition:all 80ms ease-out;" +
      "box-shadow:0 0 0 4px rgba(26,115,232,0.06);border-radius:2px;" +
    "}" +
    "#__imgc_tooltip{" +
      "position:fixed;z-index:2147483647;pointer-events:none;display:none;" +
      "background:rgba(30,30,30,0.92);color:#fff;font-size:12px;" +
      "font-family:system-ui,'Microsoft YaHei',sans-serif;" +
      "padding:6px 10px;border-radius:4px;white-space:nowrap;" +
      "box-shadow:0 2px 8px rgba(0,0,0,0.3);line-height:1.5;" +
      "backdrop-filter:blur(4px);" +
    "}" +
    "#__imgc_tooltip .tag{color:#8be9fd;font-weight:600;}" +
    "#__imgc_tooltip .dim{color:#ccc;margin-left:6px;}" +
    "#__imgc_tooltip .hint{color:#ffd866;margin-left:6px;}" +
    "#__imgc_rect{" +
      "position:fixed;z-index:2147483645;pointer-events:none;display:none;" +
      "outline:2px dashed rgba(255,152,0,0.9);" +
      "background:rgba(255,152,0,0.1);" +
      "box-shadow:0 0 0 4px rgba(255,152,0,0.05);" +
    "}";
  document.head.appendChild(style);

  // ================================================================
  // 创建 UI 元素
  // ================================================================
  var banner = document.createElement("div");
  banner.id = "__imgc_banner";
  banner.innerHTML = '\u{1F4F7} <b>元素选择模式</b> — 移动鼠标选择元素，<kbd>滚轮</kbd> 切换层级，<kbd>R</kbd> 切换区域框选，<kbd>Esc</kbd> 退出';

  var overlay = document.createElement("div");
  overlay.id = "__imgc_overlay";

  var tooltip = document.createElement("div");
  tooltip.id = "__imgc_tooltip";

  var rectOverlay = document.createElement("div");
  rectOverlay.id = "__imgc_rect";

  document.body.appendChild(banner);
  document.body.appendChild(overlay);
  document.body.appendChild(tooltip);
  document.body.appendChild(rectOverlay);

  // ================================================================
  // 状态
  // ================================================================
  var hoveredEl = null;
  var overlayVisible = false;
  var captureMode = "element";   // "element" | "area"
  var dragging = false;
  var dragStartX = 0, dragStartY = 0;
  var dragCurX = 0, dragCurY = 0;

  var OUR_IDS = {};
  IDS.forEach(function (id) { OUR_IDS[id] = true; });

  // ---- 工具函数 ----

  function isOurUI(el) {
    for (var e = el; e; e = e.parentElement) {
      if (OUR_IDS[e.id]) return true;
    }
    return false;
  }

  // 判断元素是否是"有意义的"选择目标（跳过太小的行内元素，优先选块级容器）
  function getMeaningfulElement(el) {
    if (!el) return null;
    var tag = el.tagName;
    var r = el.getBoundingClientRect();

    // 如果当前元素很小（宽或高 < 20px）且有父元素更大，向上找
    var cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      var cr = cur.getBoundingClientRect();
      // 如果是块级或宽度超过 100px 或包含图片/列表项，认为有意义
      var display = getComputedStyle(cur).display;
      var isBlock = display === "block" || display === "flex" || display === "grid" ||
                    display === "inline-block" || display === "inline-flex" || display === "table";
      var hasContent = (cur.querySelector("img, svg, video, canvas"));
      var isListOrCard = /^(LI|ARTICLE|SECTION|DIV|MAIN|ASIDE|HEADER|FOOTER|NAV|FIGURE|FORM)$/i.test(cur.tagName);

      if (isBlock || isListOrCard || hasContent || cr.width >= 100 || cr.height >= 40) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return el;
  }

  // 隐藏 overlay → elementsFromPoint → 过滤 → 恢复 overlay
  function getElementAtPoint(x, y) {
    var wasShowing = overlayVisible;
    if (wasShowing) overlay.style.display = "none";

    var all = document.elementsFromPoint(x, y);

    if (wasShowing) overlay.style.display = "";

    if (!all || all.length === 0) return null;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!el || el === document.body || el === document.documentElement) continue;
      if (OUR_IDS[el.id]) continue;
      var rr = el.getBoundingClientRect();
      if (rr.width > 0 && rr.height > 0) {
        return getMeaningfulElement(el);
      }
    }
    return null;
  }

  // 定位遮罩
  function showOverlay(el) {
    if (!el) {
      overlay.style.display = "none";
      overlayVisible = false;
      return;
    }
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) {
      overlay.style.display = "none";
      overlayVisible = false;
      return;
    }
    overlay.style.display = "";
    overlay.style.left = r.left + "px";
    overlay.style.top = r.top + "px";
    overlay.style.width = r.width + "px";
    overlay.style.height = r.height + "px";
    overlayVisible = true;
  }

  // 元素信息 tooltip（显示在遮罩下方或上方）
  function showTooltip(el, mx, my) {
    if (!el) {
      tooltip.style.display = "none";
      return;
    }
    var r = el.getBoundingClientRect();
    var tag = el.tagName.toLowerCase();
    var cls = el.className && typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2).join(" ") : "";
    if (el.id) cls = "#" + el.id + (cls ? " " + cls : "");
    var dim = Math.round(r.width) + "×" + Math.round(r.height);

    var html = '<span class="tag">' + escapeHtml2(tag) + '</span>';
    if (cls) html += ' <span style="color:#aaa">' + escapeHtml2(cls) + '</span>';
    html += '<span class="dim">' + dim + '</span>';

    // 检查是否有子元素（提示可滚轮展开）
    var children = el.children;
    var hasChild = children && children.length > 0;
    var hasParent = el.parentElement && el.parentElement !== document.body && el.parentElement !== document.documentElement;
    var navHints = [];
    if (hasParent) navHints.push('▲ 父');
    if (hasChild) navHints.push('▼ 子');
    if (navHints.length) html += '<span class="hint">' + navHints.join(" ") + '</span>';

    tooltip.innerHTML = html;
    tooltip.style.display = "";

    // 定位：优先在遮罩下方，空间不够放上方
    var tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    var left = Math.max(4, Math.min(mx - tw / 2, window.innerWidth - tw - 4));
    var top;
    if (r.bottom + th + 6 <= window.innerHeight) {
      top = r.bottom + 6;
    } else if (r.top - th - 6 >= 0) {
      top = r.top - th - 6;
    } else {
      top = Math.max(4, Math.min(my + 16, window.innerHeight - th - 4));
    }
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
  }

  function escapeHtml2(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // 滚轮 → 切换层级
  function navigateHierarchy(deltaY) {
    if (!hoveredEl) return;
    if (deltaY < 0) {
      // 上滚 → 选父元素
      var p = hoveredEl.parentElement;
      if (p && p !== document.body && p !== document.documentElement) {
        hoveredEl = p;
        showOverlay(p);
        showTooltip(p, dragCurX || 0, dragCurY || 0);
      }
    } else if (deltaY > 0) {
      // 下滚 → 选第一个可见子元素
      var children = hoveredEl.children;
      if (children && children.length > 0) {
        for (var i = 0; i < children.length; i++) {
          var cr = children[i].getBoundingClientRect();
          if (cr.width > 0 && cr.height > 0) {
            hoveredEl = children[i];
            showOverlay(children[i]);
            showTooltip(children[i], dragCurX || 0, dragCurY || 0);
            return;
          }
        }
      }
    }
  }

  // 更新矩形选区
  function updateRectOverlay(x1, y1, x2, y2) {
    var l = Math.min(x1, x2), t = Math.min(y1, y2);
    var w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    rectOverlay.style.display = "";
    rectOverlay.style.left = l + "px";
    rectOverlay.style.top = t + "px";
    rectOverlay.style.width = w + "px";
    rectOverlay.style.height = h + "px";
  }

  // 更新 banner 文案
  function updateBanner() {
    if (captureMode === "element") {
      banner.innerHTML = '\u{1F4F7} <b>元素选择模式</b> — 移动鼠标选择元素，<kbd>滚轮</kbd> 切换层级，<kbd>R</kbd> 切换区域框选，<kbd>Esc</kbd> 退出';
    } else {
      banner.innerHTML = '✂️ <b>区域框选模式</b> — 按住鼠标左键拖拽框选矩形区域，<kbd>R</kbd> 切换元素选择，<kbd>Esc</kbd> 退出';
    }
    banner.style.background = captureMode === "area"
      ? "linear-gradient(135deg,#e67e00,#d35400)"
      : "linear-gradient(135deg,#1a73e8,#1557b0)";
  }

  // ---- 清理 ----
  function cleanup() {
    if (window.__img_capture_timer) { clearTimeout(window.__img_capture_timer); window.__img_capture_timer = null; }
    try { document.body.removeChild(banner); } catch (e) {}
    try { document.body.removeChild(overlay); } catch (e) {}
    try { document.body.removeChild(tooltip); } catch (e) {}
    try { document.body.removeChild(rectOverlay); } catch (e) {}
    try { document.head.removeChild(style); } catch (e) {}
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("mouseup", onMouseUp, true);
    document.removeEventListener("wheel", onWheel, true);
    document.removeEventListener("contextmenu", onContextMenu, true);
  }

  // ================================================================
  // 事件处理器
  // ================================================================

  function onMouseMove(e) {
    if (window.__img_capture_gen !== currentGen) return;
    dragCurX = e.clientX;
    dragCurY = e.clientY;

    if (captureMode === "area" && dragging) {
      // 区域拖拽中：更新矩形
      updateRectOverlay(dragStartX, dragStartY, e.clientX, e.clientY);
      // 同时更新尺寸 tooltip
      var w = Math.abs(e.clientX - dragStartX);
      var h = Math.abs(e.clientY - dragStartY);
      tooltip.innerHTML = '<span class="tag">自定义区域</span><span class="dim">' + Math.round(w) + '×' + Math.round(h) + '</span>';
      tooltip.style.display = "";
      var l = Math.min(dragStartX, e.clientX);
      var t = Math.max(dragStartY, e.clientY) + 6;
      tooltip.style.left = Math.max(4, Math.min(l, window.innerWidth - tooltip.offsetWidth - 4)) + "px";
      tooltip.style.top = Math.min(t, window.innerHeight - tooltip.offsetHeight - 4) + "px";
      return;
    }

    if (captureMode !== "element") return;

    var el = getElementAtPoint(e.clientX, e.clientY);
    if (el) {
      hoveredEl = el;
      showOverlay(el);
      showTooltip(el, e.clientX, e.clientY);
    }
  }

  function onClick(e) {
    if (window.__img_capture_gen !== currentGen) return;

    if (captureMode === "element") {
      if (!hoveredEl) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // 闪烁确认
      overlay.style.background = "rgba(26,115,232,0.35)";
      overlay.style.outline = "3px solid rgba(26,115,232,0.85)";
      overlay.style.boxShadow = "0 0 0 8px rgba(26,115,232,0.2)";

      var el = hoveredEl;
      setTimeout(function () { captureElement(el); }, 120);
    }
  }

  function onMouseDown(e) {
    if (window.__img_capture_gen !== currentGen) return;
    if (captureMode !== "area") return;
    if (e.button !== 0) return; // 只响应左键

    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    // 隐藏元素遮罩，显示矩形框
    overlay.style.display = "none";
    overlayVisible = false;
    tooltip.style.display = "none";
  }

  function onMouseUp(e) {
    if (window.__img_capture_gen !== currentGen) return;
    if (captureMode !== "area" || !dragging) return;

    e.preventDefault();
    e.stopPropagation();
    dragging = false;

    var x1 = dragStartX, y1 = dragStartY;
    var x2 = e.clientX, y2 = e.clientY;
    var w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);

    // 太小忽略（防止误触）
    if (w < 10 || h < 10) {
      rectOverlay.style.display = "none";
      tooltip.style.display = "none";
      return;
    }

    // 闪烁确认
    rectOverlay.style.outline = "3px solid rgba(255,152,0,1)";
    rectOverlay.style.background = "rgba(255,152,0,0.25)";

    var rect = {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: w,
      height: h
    };

    setTimeout(function () { captureArea(rect); }, 120);
  }

  function onWheel(e) {
    if (window.__img_capture_gen !== currentGen) return;
    if (captureMode !== "element") return;
    e.preventDefault();
    e.stopPropagation();
    navigateHierarchy(e.deltaY);
  }

  function onContextMenu(e) {
    // 捕捉状态下阻止右键菜单
    if (window.__img_capture_gen !== currentGen) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function onKeyDown(e) {
    if (window.__img_capture_gen !== currentGen) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      return;
    }

    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      e.stopPropagation();
      // 切换模式
      if (captureMode === "element") {
        captureMode = "area";
        overlay.style.display = "none";
        overlayVisible = false;
        tooltip.style.display = "none";
        hoveredEl = null;
      } else {
        captureMode = "element";
        rectOverlay.style.display = "none";
        tooltip.style.display = "none";
      }
      updateBanner();
      return;
    }

    // 元素模式下的键盘层级导航
    if (captureMode === "element") {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        navigateHierarchy(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        navigateHierarchy(1);
      }
    }
  }

  // ================================================================
  // 截图 & 保存
  // ================================================================

  // SVG foreignObject 方式渲染元素
  function captureElementAsImage(el) {
    return new Promise(function (resolve, reject) {
      var rect = el.getBoundingClientRect();
      var w = Math.round(rect.width), h = Math.round(rect.height);
      if (w <= 0 || h <= 0) return reject(new Error("zero size"));

      var maxD = 3000;
      var scale = Math.min(1, maxD / Math.max(w, h));
      var fw = Math.round(w * scale), fh = Math.round(h * scale);

      var computed = getComputedStyle(el);
      var styleProps = [
        "color","background-color","background-image","font-family","font-size","font-weight","font-style",
        "text-align","text-decoration","line-height","letter-spacing",
        "padding-left","padding-right","padding-top","padding-bottom",
        "border","border-radius","box-shadow",
        "display","overflow","white-space","word-break","opacity"
      ];
      var cssText = "";
      for (var i = 0; i < styleProps.length; i++) {
        var p = styleProps[i];
        var v = computed.getPropertyValue(p);
        if (v && v !== "none" && v !== "normal" && v !== "auto" &&
            v !== "rgba(0, 0, 0, 0)" && v !== "transparent") {
          cssText += p + ":" + v + ";";
        }
      }

      var clone = el.cloneNode(true);
      var html = clone.outerHTML || el.outerHTML || el.innerHTML;
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + fw + '" height="' + fh + '">' +
        '<foreignObject width="100%" height="100%">' +
        '<div xmlns="http://www.w3.org/1999/xhtml" style="' + cssText + 'width:' + w + 'px;min-height:' + h + 'px;overflow:hidden;">' +
        html + '</div></foreignObject></svg>';

      var blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var cv = document.createElement("canvas");
        cv.width = fw; cv.height = fh;
        cv.getContext("2d").drawImage(img, 0, 0, fw, fh);
        resolve(cv.toDataURL("image/png", 0.95));
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("SVG render failed"));
      };
      img.src = url;
    });
  }

  // 区域截图：截取屏幕指定区域（viewport 坐标）
  function captureAreaRect(areaRect) {
    return new Promise(function (resolve, reject) {
      var l = areaRect.left, t = areaRect.top;
      var w = areaRect.width, h = areaRect.height;

      if (w <= 0 || h <= 0) return reject(new Error("zero size area"));

      // 策略：找出该区域中包含的所有可见元素，渲染到 canvas
      // 简化但有效的方案：使用整个 body 的 SVG 渲染，但裁剪到区域
      var maxD = 3000;
      var scale = Math.min(1, maxD / Math.max(w, h));
      var fw = Math.round(w * scale), fh = Math.round(h * scale);

      // 收集区域内的主要内容
      var cloneContainer = document.createElement("div");
      cloneContainer.style.cssText = "position:relative;width:" + document.documentElement.scrollWidth + "px;";

      // 遍历区域内的可见元素
      var allEls = document.querySelectorAll("body *");
      var areaElements = [];
      for (var i = 0; i < allEls.length; i++) {
        var el = allEls[i];
        if (OUR_IDS[el.id]) continue;
        var rr = el.getBoundingClientRect();
        // 检查是否与区域相交
        if (rr.right < l || rr.left > l + w || rr.bottom < t || rr.top > t + h) continue;
        if (rr.width <= 0 || rr.height <= 0) continue;
        // 只取叶子节点或包含图片的元素
        var tag = el.tagName;
        if (tag === "IMG" || tag === "CANVAS" || tag === "VIDEO" || tag === "SVG" ||
            (el.children.length === 0 && (el.textContent || "").trim().length > 0) ||
            tag === "BUTTON" || tag === "INPUT" || tag === "SELECT") {
          areaElements.push({ el: el, rect: rr, tag: tag });
        }
      }

      // 如果区域内元素较少，直接用简化方式
      if (areaElements.length <= 50) {
        // 用 SVG foreignObject 渲染整个 body，然后裁剪
        var bodyClone = document.body.cloneNode(true);
        // 移除我们的 UI
        IDS.forEach(function (id) {
          try { var rmv = bodyClone.querySelector("#" + id); if (rmv) rmv.remove(); } catch (e2) {}
        });

        var bodyHtml = bodyClone.innerHTML || "";
        var svg2 = '<svg xmlns="http://www.w3.org/2000/svg" width="' + fw + '" height="' + fh + '">' +
          '<foreignObject width="100%" height="100%">' +
          '<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:' + document.documentElement.scrollWidth + 'px;">' +
          bodyHtml + '</div></foreignObject></svg>';

        // 创建一个带 viewBox 偏移的 SVG 来裁剪到目标区域
        var svgCrop = '<svg xmlns="http://www.w3.org/2000/svg" width="' + fw + '" height="' + fh + '" viewBox="' + l + ' ' + t + ' ' + w + ' ' + h + '">' +
          '<foreignObject x="' + l + '" y="' + t + '" width="' + w + '" height="' + h + '">' +
          '<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:' + w + 'px;height:' + h + 'px;overflow:hidden;">' +
          bodyHtml + '</div></foreignObject></svg>';

        var blob2 = new Blob([svgCrop], { type: "image/svg+xml;charset=utf-8" });
        var url2 = URL.createObjectURL(blob2);
        var img2 = new Image();
        img2.onload = function () {
          URL.revokeObjectURL(url2);
          var cv2 = document.createElement("canvas");
          cv2.width = fw; cv2.height = fh;
          cv2.getContext("2d").drawImage(img2, 0, 0, fw, fh);
          resolve(cv2.toDataURL("image/png", 0.95));
        };
        img2.onerror = function () {
          URL.revokeObjectURL(url2);
          // 降级：纯色画布 + 尺寸标注
          var fb = document.createElement("canvas");
          fb.width = fw; fb.height = fh;
          var ctx = fb.getContext("2d");
          ctx.fillStyle = "#f5f5f5"; ctx.fillRect(0, 0, fw, fh);
          ctx.fillStyle = "#999"; ctx.font = "14px system-ui,sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(w + "×" + h + " 区域截图", fw / 2, fh / 2);
          resolve(fb.toDataURL("image/png", 0.95));
        };
        img2.src = url2;
      } else {
        // 复杂区域：白底 + 尺寸
        var fb2 = document.createElement("canvas");
        fb2.width = fw; fb2.height = fh;
        var ctx2 = fb2.getContext("2d");
        ctx2.fillStyle = "#f5f5f5"; ctx2.fillRect(0, 0, fw, fh);
        ctx2.fillStyle = "#666"; ctx2.font = "14px system-ui,sans-serif";
        ctx2.textAlign = "center";
        ctx2.fillText("已选择 " + w + "×" + h + " 区域", fw / 2, fh / 2);
        resolve(fb2.toDataURL("image/png", 0.95));
      }
    });
  }

  // ---- 元素截图入口 ----
  async function captureElement(el) {
    overlay.style.display = "none";
    overlayVisible = false;
    tooltip.style.display = "none";

    var tag = el.tagName;
    var r = el.getBoundingClientRect();
    var downloadUrl = null;

    try {
      if (tag === "IMG") {
        var srcUrl = el.src;
        try {
          var cv1 = document.createElement("canvas");
          cv1.width = el.naturalWidth; cv1.height = el.naturalHeight;
          cv1.getContext("2d").drawImage(el, 0, 0);
          downloadUrl = cv1.toDataURL("image/png", 0.95);
        } catch (directErr) {
          try {
            downloadUrl = await new Promise(function (resolve, reject) {
              var tmpImg = new Image();
              tmpImg.crossOrigin = "anonymous";
              tmpImg.onload = function () {
                var cv = document.createElement("canvas");
                cv.width = tmpImg.naturalWidth; cv.height = tmpImg.naturalHeight;
                cv.getContext("2d").drawImage(tmpImg, 0, 0);
                resolve(cv.toDataURL("image/png", 0.95));
              };
              tmpImg.onerror = function () { reject(new Error("reload failed")); };
              tmpImg.src = srcUrl;
            });
          } catch (reloadErr) {
            downloadUrl = await captureElementAsImage(el);
          }
        }
      } else if (tag === "CANVAS") {
        try { downloadUrl = el.toDataURL("image/png"); } catch (e3) {}
      } else if (tag === "VIDEO") {
        var vw = el.videoWidth || r.width, vh = el.videoHeight || r.height;
        var cv2 = document.createElement("canvas");
        cv2.width = vw; cv2.height = vh;
        cv2.getContext("2d").drawImage(el, 0, 0, vw, vh);
        downloadUrl = cv2.toDataURL("image/png", 0.95);
      } else {
        try {
          downloadUrl = await captureElementAsImage(el);
        } catch (svgErr) {
          var text = (el.textContent || "").trim();
          if (text.length > 0) {
            var cv3 = document.createElement("canvas");
            cv3.width = Math.min(r.width, 1200); cv3.height = Math.min(r.height, 800);
            var ctx = cv3.getContext("2d");
            ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv3.width, cv3.height);
            ctx.fillStyle = "#333"; ctx.font = "14px system-ui,'Microsoft YaHei',sans-serif";
            var line = "", y = 20;
            var chars = text.split("");
            for (var ci = 0; ci < chars.length; ci++) {
              if (ctx.measureText(line + chars[ci]).width > cv3.width - 40) {
                ctx.fillText(line, 20, y); line = chars[ci]; y += 22;
                if (y > cv3.height - 20) break;
              } else { line += chars[ci]; }
            }
            if (line && y <= cv3.height - 20) ctx.fillText(line, 20, y);
            downloadUrl = cv3.toDataURL("image/png", 0.95);
          }
        }
      }

      if (downloadUrl) {
        try { chrome.runtime.sendMessage({ action: "downloadImage", url: downloadUrl, filename: partNumber + ".png" }); } catch (e4) {}
      }
      window.__img_capture_timer = setTimeout(cleanup, 300);
    } catch (err) {
      console.error("captureElement:", err);
      cleanup();
    }
  }

  // ---- 区域截图入口 ----
  async function captureArea(rect) {
    rectOverlay.style.display = "none";
    tooltip.style.display = "none";

    try {
      var downloadUrl = await captureAreaRect(rect);
      if (downloadUrl) {
        try { chrome.runtime.sendMessage({ action: "downloadImage", url: downloadUrl, filename: partNumber + "_area.png" }); } catch (e5) {}
      }
      window.__img_capture_timer = setTimeout(cleanup, 300);
    } catch (err) {
      console.error("captureArea:", err);
      cleanup();
    }
  }

  // ================================================================
  // 启动事件监听
  // ================================================================
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("wheel", onWheel, { passive: false, capture: true });
  document.addEventListener("contextmenu", onContextMenu, true);
}

// 定期刷新
setInterval(() => {
  loadTabGroup();
}, 3000);
