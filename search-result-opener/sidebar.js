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
  const btnLabel = btn.querySelector("span:last-child");
  const origText = btnLabel.textContent;
  btnLabel.textContent = "正在准备...";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { console.error("[截图捕获] 无法获取当前标签页"); return; }

    // 检查是否为受限页面（chrome://, chrome-extension:// 等无法注入脚本）
    if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:") || tab.url.startsWith("edge-extension://"))) {
      btnLabel.textContent = "此页面不支持";
      setTimeout(() => { btnLabel.textContent = origText; }, 2000);
      return;
    }

    // 获取当前料号作为文件名
    // 修正 Bug 1：只有当活跃标签页属于当前群组时才使用群组的 partNumber，
    // 否则从页面 URL 提取文件名，避免复用上次批量打开的旧名字
    const data = await chrome.storage.local.get("currentGroup");
    let partNumber = "capture";
    if (data.currentGroup && data.currentGroup.tabIds && data.currentGroup.tabIds.includes(tab.id)) {
      partNumber = data.currentGroup.partNumber || "capture";
    } else {
      // 不是批量打开的标签页
      try {
        const url = new URL(tab.url);
        // 优先从搜索 URL 提取搜索词作为文件名
        const q = url.searchParams.get("q");
        if (q && (url.hostname.includes("bing.com") || url.hostname.includes("google.com"))) {
          partNumber = q.trim().replace(/\s+/g, "") || "capture";
        } else {
          // 从 URL 路径提取有意义的文件名
          const pathParts = url.pathname.split("/").filter(Boolean);
          const lastPath = pathParts.length > 0 ? pathParts[pathParts.length - 1] : "";
          if (lastPath && /\.[a-z0-9]+$/i.test(lastPath)) {
            partNumber = lastPath.replace(/\.[^.]+$/, "").replace(/[<>:"/\|?*]/g, "_") || "capture";
          } else {
            partNumber = url.hostname.replace(/^www\./, "").replace(/[<>:"/\|?*]/g, "_") || "capture";
          }
        }
      } catch (e) {
        partNumber = "capture";
      }
    }
    // 去除料号中的空格
    partNumber = partNumber.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "");

    console.log("[截图捕获] 正在注入到标签页", tab.id, tab.url, "partNumber:", partNumber);
    var injectResult = null;
    var lastErr = null;
    for (var attempt = 0; attempt < 8; attempt++) {
      try {
        injectResult = await Promise.race([
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: injectImageCapture,
            args: [partNumber],
          }),
          new Promise(function(_, reject) { setTimeout(function() { reject(new Error("注入超时")); }, 3000); })
        ]);
        if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        console.warn("[截图捕获] 注入第" + (attempt + 1) + "次失败:", e.message);
        if (attempt < 7) {
          btnLabel.textContent = "等待页面(" + (attempt + 2) + "/8)...";
          await new Promise(function(r) { setTimeout(r, 800); });
        }
      }
    }
    if (lastErr) {
      console.error("[截图捕获] 注入8次均失败:", lastErr.message);
      throw lastErr;
    }
    btnLabel.textContent = origText;
    console.log("[截图捕获] 注入完成, result:", injectResult);
    // 将焦点还给目标页面，使键盘事件（Esc）能到达注入的监听器
    try { await chrome.tabs.update(tab.id, { active: true }); } catch (e) {}

    // 在侧边栏也监听 Esc，确保即使焦点在侧边栏也能退出截图模式
    const sidebarEscHandler = function(e) {
      if (e.key === "Escape") {
        document.removeEventListener("keydown", sidebarEscHandler, true);
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: function() { if (window.__imgc_cleanup) window.__imgc_cleanup(); }
        }).catch(function() {});
      }
    };
    document.addEventListener("keydown", sidebarEscHandler, true);
    // 保存引用以便页面侧的 cleanup 也能移除它（通过代数标记自然过期）
    window.__imgc_sidebarEscHandler = sidebarEscHandler;
  } catch (e) {
    console.error("startImageCapture error:", e);
    console.error("[截图捕获] startImageCapture error:", e);
    btnLabel.textContent = "注入失败";
    setTimeout(() => { btnLabel.textContent = origText; }, 2000);
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
  console.log("[截图捕获] 开始注入, partNumber:", partNumber);

  function waitForDOM(cb) {
    if (document.readyState !== "loading") { cb(); return; }
    document.addEventListener("DOMContentLoaded", cb);
  }

  waitForDOM(function() {
  try {
    // --- 清理上一次残留 ---
    if (window.__img_capture_timer) { clearTimeout(window.__img_capture_timer); window.__img_capture_timer = null; }
    var IDS = ["__imgc_banner", "__imgc_style", "__imgc_overlay", "__imgc_label"];
    IDS.forEach(function (id) {
      try { var old = document.getElementById(id); if (old) old.remove(); } catch (e) {}
    });

    // --- 代数标记 ---
    window.__img_capture_gen = (window.__img_capture_gen || 0) + 1;
    var currentGen = window.__img_capture_gen;

    // ================================================================
    // 注入样式（仅 banner）
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
        "position:fixed;pointer-events:none;z-index:2147483646;" +
        "border:2px solid #1a73e8;background:rgba(26,115,232,0.08);" +
        "transition:all 0.08s ease;border-radius:2px;display:none;" +
      "}" +
      "#__imgc_label{" +
        "position:fixed;pointer-events:none;z-index:2147483647;" +
        "padding:2px 6px;background:#1a73e8;color:#fff;font-size:11px;" +
        "font-family:system-ui,'Microsoft YaHei',sans-serif;border-radius:3px;" +
        "white-space:nowrap;display:none;line-height:1.4;" +
      "}";
    document.head.appendChild(style);

    // ================================================================
    // 创建 UI（仅 banner）
    // ================================================================
    var banner = document.createElement("div");
    banner.id = "__imgc_banner";
    banner.innerHTML = '📷 <b>截图模式</b> — <kbd>单击</kbd> 保存光标处元素 &nbsp;|&nbsp; <kbd>Esc</kbd> 退出' +
      '<div id="__imgc_status" style="font-size:12px;margin-top:4px;min-height:18px;opacity:0.9;"></div>';

    document.body.appendChild(banner);

    // 创建高亮预选框和标签
    var overlay = document.createElement("div");
    overlay.id = "__imgc_overlay";
    document.body.appendChild(overlay);

    var labelEl = document.createElement("div");
    labelEl.id = "__imgc_label";
    document.body.appendChild(labelEl);

    // ================================================================
    // 状态
    // ================================================================
    var hoveredEl = null;
    var OUR_IDS = {};
    IDS.forEach(function (id) { OUR_IDS[id] = true; });
    // 将 overlay 和 label 也加入排除列表，防止 getElementAtPoint 选中它们
    OUR_IDS["__imgc_overlay"] = true;
    OUR_IDS["__imgc_label"] = true;

    // ---- 状态反馈函数 ----
    function setStatus(text, isError) {
      var statusEl = document.getElementById("__imgc_status");
      if (statusEl) {
        statusEl.textContent = text;
        statusEl.style.color = isError ? "#ff6b6b" : "#fff";
        statusEl.style.fontWeight = isError ? "bold" : "normal";
      }
    }

    // ---- 工具函数 ----

    function isOurUI(el) {
      for (var e = el; e; e = e.parentElement) {
        if (OUR_IDS[e.id]) return true;
      }
      return false;
    }

    function getElementAtPoint(x, y) {
      var all = document.elementsFromPoint(x, y);
      if (!all || all.length === 0) return null;

      // 第一遍：原图绝对优先！找媒体元素，无视上面的遮罩层（保障你的核心需求：存图）
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (!el || el === document.body || el === document.documentElement) continue;
        if (OUR_IDS[el.id]) continue;
        if (/^(IMG|VIDEO|CANVAS|SVG)$/i.test(el.tagName)) {
          var rr = el.getBoundingClientRect();
          var minW = el.tagName === 'CANVAS' ? 10 : 20;
          var minH = el.tagName === 'CANVAS' ? 10 : 20;
          if (rr.width >= minW && rr.height >= minH) {
            return el;
          }
        }
      }

      // 第二遍：如果没有图片，就抓取鼠标当前指着的任意有效非透明元素（满足你的强迫症：存万物）
      var ZOOM_LENS_CLASSES = ['zoom-lens', 'zoomLens', 'cloud-zoom-lens', 'img-zoom-lens',
                               'magnify-lens', 'magnifier-lens', 'zoomContainer', 'zoomWindow'];
      for (var j = 0; j < all.length; j++) {
        var el2 = all[j];
        if (!el2 || el2 === document.body || el2 === document.documentElement) continue;
        if (OUR_IDS[el2.id]) continue;
        // 过滤专门的放大镜遮罩层
        var isZoomLens = false;
        var elClass = el2.className || '';
        if (typeof elClass === 'string') {
          for (var z = 0; z < ZOOM_LENS_CLASSES.length; z++) {
            if (elClass.indexOf(ZOOM_LENS_CLASSES[z]) !== -1) { isZoomLens = true; break; }
          }
        }
        if (isZoomLens) continue;
        // 过滤全透明的不可见遮罩
        try {
          var el2Style = getComputedStyle(el2);
          if (el2Style.opacity === '0' || el2Style.visibility === 'hidden') continue;
        } catch (e) {}
        var rr2 = el2.getBoundingClientRect();
        // 只要有尺寸，不再往里乱挖，直接返回你选中的这个元素
        if (rr2.width > 0 && rr2.height > 0) {
          return el2;
        }
      }
      return null;
    }

    // 修正 Bug 3：返回 rect 供复用
    function showOverlay(el) {
      return el ? el.getBoundingClientRect() : null;
    }

    function showTooltip(el, mx, my, cachedRect) {
      // 已移除提示词
    }

    function escapeHtml2(s) {
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    // ---- 清理 ----
    function cleanup() {
      if (window.__img_capture_timer) { clearTimeout(window.__img_capture_timer); window.__img_capture_timer = null; }
      window.__imgc_capturing = false;
      delete window.__imgc_cleanup;
      try { document.body.removeChild(banner); } catch (e) {}
      try { document.head.removeChild(style); } catch (e) {}
      try { document.body.removeChild(overlay); } catch (e) {}
      try { document.body.removeChild(labelEl); } catch (e) {}
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
    }
    // 暴露 cleanup 到 window，使侧边栏可以通过注入脚本调用退出
    window.__imgc_cleanup = cleanup;

    // ================================================================
    // 获取图片的最佳（最高分辨率）URL
    // ================================================================
    function getBestImageUrl(imgEl) {
      // 按优先级检查高分辨率来源
      var attrs = ["data-zoom", "data-src", "data-large", "data-full",
                   "data-original", "data-lazy-src", "data-high-res", "data-zoomed"];
      for (var i = 0; i < attrs.length; i++) {
        var val = imgEl.getAttribute(attrs[i]);
        if (val && /^(https?:)?\/\//.test(val)) return val;
      }
      // 检查 srcset 中最大 w 描述符的 URL
      var srcset = imgEl.getAttribute("srcset");
      if (srcset) {
        var candidates = srcset.split(",").map(function(s) { return s.trim(); });
        var bestUrl = null, bestW = 0;
        for (var j = 0; j < candidates.length; j++) {
          var parts = candidates[j].split(/\s+/);
          if (parts.length >= 2) {
            var url = parts[0];
            var wMatch = parts[1].match(/^(\d+)w$/);
            if (wMatch) {
              var w = parseInt(wMatch[1], 10);
              if (w > bestW) { bestW = w; bestUrl = url; }
            }
          }
        }
        if (bestUrl) return bestUrl;
      }
      // 检查父元素上的 data 属性
      var parent = imgEl.parentElement;
      if (parent) {
        for (var k = 0; k < attrs.length; k++) {
          var pv = parent.getAttribute(attrs[k]);
          if (pv && /^(https?:)?\/\//.test(pv)) return pv;
        }
      }
      // 兜底返回 img.src
      return imgEl.src;
    }

    // ================================================================
    // SVG foreignObject 方式渲染元素
    // ================================================================
    function captureElementAsImage(el, timeoutMs) {
      timeoutMs = timeoutMs || 3000;
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

        var resolved = false;
        var timeoutId = setTimeout(function() {
          if (!resolved) { resolved = true; URL.revokeObjectURL(url); reject(new Error("SVG render timeout")); }
        }, timeoutMs);

        img.onload = function () {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeoutId);
          URL.revokeObjectURL(url);
          var cv = document.createElement("canvas");
          cv.width = fw; cv.height = fh;
          cv.getContext("2d").drawImage(img, 0, 0, fw, fh);
          resolve(cv.toDataURL("image/png", 0.95));
        };
        img.onerror = function () {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeoutId);
          URL.revokeObjectURL(url);
          reject(new Error("SVG render failed"));
        };
        img.src = url;
      });
    }


    // ================================================================
    // Canvas 文字渲染兜底（零外部依赖，100% 可靠）
    // ================================================================
    function renderElementToCanvas(el) {
      var rect = el.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      var w = Math.round(rect.width), h = Math.round(rect.height);
      if (w <= 0 || h <= 0) return null;

      var maxD = 3000;
      var scale = Math.min(1, maxD / Math.max(w, h));
      var cw = Math.round(w * dpr * scale), ch = Math.round(h * dpr * scale);

      var canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      var ctx = canvas.getContext("2d");
      ctx.scale(dpr * scale, dpr * scale);

      var style = getComputedStyle(el);

      // 背景
      var bg = style.backgroundColor;
      if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") {
        bg = "#ffffff";
      }
      ctx.fillStyle = bg;
      var radius = parseFloat(style.borderRadius) || 0;
      if (radius > 0) {
        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.lineTo(w - radius, 0);
        ctx.arcTo(w, 0, w, radius, radius);
        ctx.lineTo(w, h - radius);
        ctx.arcTo(w, h, w - radius, h, radius);
        ctx.lineTo(radius, h);
        ctx.arcTo(0, h, 0, h - radius, radius);
        ctx.lineTo(0, radius);
        ctx.arcTo(0, 0, radius, 0, radius);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(0, 0, w, h);
      }

      // 文字
      var text = (el.textContent || "").trim();
      if (text) {
        var color = style.color;
        if (!color || color === "rgba(0, 0, 0, 0)") color = "#000000";
        ctx.fillStyle = color;
        ctx.font = (style.fontStyle || "normal") + " " +
                   (style.fontWeight || "normal") + " " +
                   (style.fontSize || "14px") + " " +
                   (style.fontFamily || "sans-serif");
        ctx.textBaseline = "top";

        var padLeft = parseFloat(style.paddingLeft) || 8;
        var padRight = parseFloat(style.paddingRight) || 8;
        var padTop = parseFloat(style.paddingTop) || 8;
        var lineHeight = parseFloat(style.lineHeight);
        if (isNaN(lineHeight) || lineHeight < 1) lineHeight = parseFloat(style.fontSize) * 1.4 || 20;
        var maxWidth = w - padLeft - padRight;
        if (maxWidth < 10) maxWidth = w - 4;

        var x = padLeft, y = padTop;
        var chars = text.split('');
        var line = '';
        for (var i = 0; i < chars.length; i++) {
          var testLine = line + chars[i];
          if (ctx.measureText(testLine).width > maxWidth && line.length > 0) {
            ctx.fillText(line, x, y);
            y += lineHeight;
            line = chars[i];
          } else {
            line = testLine;
          }
        }
        if (line) ctx.fillText(line, x, y);
      }

      return canvas.toDataURL("image/png", 0.95);
    }

    // ================================================================
    // 元素截图入口（修正 Bug 2：容器内图片穿透）
    // 返回: Promise<string|null> — 成功返回 dataURL，失败返回 null
    // ================================================================
        async function captureElement(el) {
      // 不再强行挖掘子节点。因为若是图片，getElementAtPoint 第一步就已经选中了；
      // 若传到这里不是图片，说明用户就是要保存这个纯文本或卡片！
      var tag = el.tagName.toUpperCase();
      var r = el.getBoundingClientRect();
      var downloadUrl = null;

      try {
        if (tag === "IMG") {
          setStatus("正在处理图片...");
          var srcUrl = getBestImageUrl(el);
          try {
            var cv1 = document.createElement("canvas");
            cv1.width = el.naturalWidth; cv1.height = el.naturalHeight;
            cv1.getContext("2d").drawImage(el, 0, 0);
            downloadUrl = cv1.toDataURL("image/png", 0.95);
          } catch (directErr) {
            try {
              downloadUrl = await new Promise(function (resolve, reject) {
                var resolved = false;
                var timeoutId = setTimeout(function() {
                  if (!resolved) { resolved = true; reject(new Error("image load timeout")); }
                }, 5000);
                var tmpImg = new Image();
                tmpImg.crossOrigin = "anonymous";
                tmpImg.onload = function () {
                  if (resolved) return;
                  resolved = true;
                  clearTimeout(timeoutId);
                  var cv = document.createElement("canvas");
                  cv.width = tmpImg.naturalWidth; cv.height = tmpImg.naturalHeight;
                  cv.getContext("2d").drawImage(tmpImg, 0, 0);
                  resolve(cv.toDataURL("image/png", 0.95));
                };
                tmpImg.onerror = function () {
                  if (resolved) return;
                  resolved = true;
                  clearTimeout(timeoutId);
                  reject(new Error("reload failed"));
                };
                tmpImg.src = srcUrl;
              });
            } catch (reloadErr) {
              // 不再走 SVG foreignObject，直接为文字 fallback 留 null
              downloadUrl = null;
            }
          }
        } else if (tag === "CANVAS") {
          setStatus("正在获取canvas...");
          downloadUrl = null;
          // Level 1: 直接 toDataURL（同步，大多数情况）
          try {
            downloadUrl = el.toDataURL("image/png");
          } catch (e1) {
            // Level 2: 新建 canvas + drawImage（对 WebGL canvas 有效）
            try {
              var tmpCv = document.createElement("canvas");
              tmpCv.width = el.width || r.width;
              tmpCv.height = el.height || r.height;
              tmpCv.getContext("2d").drawImage(el, 0, 0);
              downloadUrl = tmpCv.toDataURL("image/png");
            } catch (e2) {
              // Level 3: 查找附近 img 源图（向上最多 5 层）
              setStatus("查找图片源...");
              var parent = el.parentElement;
              var sourceImg = null;
              for (var pi = 0; pi < 5 && parent; pi++) {
                var imgs = parent.querySelectorAll("img");
                for (var ii = 0; ii < imgs.length; ii++) {
                  if (imgs[ii].naturalWidth >= 100 && imgs[ii].getBoundingClientRect().width >= 20) {
                    sourceImg = imgs[ii]; break;
                  }
                }
                if (sourceImg) break;
                parent = parent.parentElement;
              }
              if (sourceImg) {
                downloadUrl = await captureElement(sourceImg);
              }
            }
          }
          // 若 CSS 显示尺寸与 canvas 内部分辨率不同，缩放到显示尺寸
          if (downloadUrl) {
            var nativeW = el.width || r.width;
            var nativeH = el.height || r.height;
            if (Math.abs(r.width - nativeW) > 2 || Math.abs(r.height - nativeH) > 2) {
              try {
                var scaledUrl = await new Promise(function(resolve) {
                  var img = new Image();
                  img.onload = function() {
                    var cv = document.createElement("canvas");
                    cv.width = r.width;
                    cv.height = r.height;
                    cv.getContext("2d").drawImage(img, 0, 0, r.width, r.height);
                    resolve(cv.toDataURL("image/png", 0.95));
                  };
                  img.src = downloadUrl;
                });
                if (scaledUrl) downloadUrl = scaledUrl;
              } catch (e) {}
            }
          }
          if (!downloadUrl) {
            setStatus("Canvas 跨域污染，无法捕获", true);
          }
        } else if (tag === "VIDEO") {
          setStatus("正在捕获视频帧...");
          var vw = el.videoWidth || r.width, vh = el.videoHeight || r.height;
          var cv2 = document.createElement("canvas");
          cv2.width = vw; cv2.height = vh;
          cv2.getContext("2d").drawImage(el, 0, 0, vw, vh);
          downloadUrl = cv2.toDataURL("image/png", 0.95);
        } else if (tag === "SVG") {
          setStatus("正在捕获SVG...");
          try {
            var svgClone = el.cloneNode(true);
            var svgW = r.width, svgH = r.height;
            svgClone.setAttribute("width", svgW);
            svgClone.setAttribute("height", svgH);
            var svgData = new XMLSerializer().serializeToString(svgClone);
            var svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
            var svgUrl = URL.createObjectURL(svgBlob);
            downloadUrl = await new Promise(function(resolve, reject) {
              var resolved = false;
              var tid = setTimeout(function() {
                if (!resolved) { resolved = true; URL.revokeObjectURL(svgUrl); reject(new Error("SVG render timeout")); }
              }, 5000);
              var tmpImg = new Image();
              tmpImg.onload = function() {
                if (resolved) return;
                resolved = true; clearTimeout(tid); URL.revokeObjectURL(svgUrl);
                var cv = document.createElement("canvas");
                cv.width = svgW; cv.height = svgH;
                cv.getContext("2d").drawImage(tmpImg, 0, 0, svgW, svgH);
                resolve(cv.toDataURL("image/png", 0.95));
              };
              tmpImg.onerror = function() {
                if (resolved) return;
                resolved = true; clearTimeout(tid); URL.revokeObjectURL(svgUrl);
                reject(new Error("SVG render failed"));
              };
              tmpImg.src = svgUrl;
            });
          } catch (svgErr) {
            downloadUrl = null;
          }
          if (!downloadUrl) {
            setStatus("SVG渲染失败，尝试截屏...", false);
          }
        } else {
          // 非媒体元素：先尝试 CSS background-image，失败后用 captureVisibleTab
          var bgImage = getComputedStyle(el).backgroundImage;
          if (bgImage && bgImage !== "none" && bgImage.indexOf("linear-gradient") === -1 && bgImage.indexOf("radial-gradient") === -1) {
            var urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
            if (urlMatch) {
              var bgUrl = urlMatch[1];
              setStatus("正在加载背景图...");
              try {
                downloadUrl = await new Promise(function(resolve, reject) {
                  var resolved = false;
                  var timeoutId = setTimeout(function() {
                    if (!resolved) { resolved = true; reject(new Error("bg image load timeout")); }
                  }, 5000);
                  var tmp = new Image();
                  tmp.crossOrigin = "anonymous";
                  tmp.onload = function() {
                    if (resolved) return;
                    resolved = true;
                    clearTimeout(timeoutId);
                    var cv = document.createElement("canvas");
                    cv.width = tmp.naturalWidth; cv.height = tmp.naturalHeight;
                    cv.getContext("2d").drawImage(tmp, 0, 0);
                    resolve(cv.toDataURL("image/png", 0.95));
                  };
                  tmp.onerror = function() {
                    if (resolved) return;
                    resolved = true;
                    clearTimeout(timeoutId);
                    reject(new Error("background-image load failed"));
                  };
                  tmp.src = bgUrl;
                });
              } catch (bgErr) {
                downloadUrl = null;
              }
            }
          }
          // background-image 失败 → 后台 Service Worker 截屏 + 本地裁剪
          if (!downloadUrl) {
            setStatus("正在截图...");
            try {
              var capDpr = window.devicePixelRatio || 1;
              var capRect = el.getBoundingClientRect();
              var vw = window.innerWidth;
              var vh = window.innerHeight;
              var clipRect = {
                left: Math.max(0, capRect.left),
                top: Math.max(0, capRect.top),
                width: Math.min(capRect.width, vw - Math.max(0, capRect.left)),
                height: Math.min(capRect.height, vh - Math.max(0, capRect.top))
              };
              if (clipRect.width <= 0 || clipRect.height <= 0) throw new Error("元素在可视区域外");

              // 1. 隐藏UI元素，避免被截入截图
              var savedOverlayDisplay = overlay.style.display;
              var savedLabelDisplay = labelEl.style.display;
              var savedBannerDisplay = banner.style.display;
              overlay.style.display = "none";
              labelEl.style.display = "none";
              banner.style.display = "none";

              // 等待浏览器重绘，确保UI已从屏幕消失
              await new Promise(function(r) { requestAnimationFrame(function() { requestAnimationFrame(r); }); });

              // 2. 呼叫后台 Service Worker 索要当前屏幕的高清原图
              var fullScreenDataUrl;
              try {
                fullScreenDataUrl = await new Promise(function(resolve, reject) {
                  chrome.runtime.sendMessage({ action: "captureViewport" }, function(res) {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else if (!res || !res.success) reject(new Error(res ? res.error : "截屏API无响应"));
                    else resolve(res.dataUrl);
                  });
                });
              } finally {
                // 3. 恢复UI元素
                overlay.style.display = savedOverlayDisplay;
                labelEl.style.display = savedLabelDisplay;
                banner.style.display = savedBannerDisplay;
              }

              // 2. 本地裁剪出鼠标指向的元素
              downloadUrl = await new Promise(function(resolve, reject) {
                var img = new Image();
                img.onload = function() {
                  var cv = document.createElement("canvas");
                  cv.width = clipRect.width * capDpr;
                  cv.height = clipRect.height * capDpr;
                  var ctx = cv.getContext("2d");
                  ctx.drawImage(img,
                    clipRect.left * capDpr, clipRect.top * capDpr, clipRect.width * capDpr, clipRect.height * capDpr,
                    0, 0, cv.width, cv.height
                  );
                  resolve(cv.toDataURL("image/png", 0.95));
                };
                img.onerror = function() { reject(new Error("裁剪图片数据加载失败")); };
                img.src = fullScreenDataUrl;
              });

            } catch (captureErr) {
              console.error("captureViewport failed:", captureErr);
              throw new Error("截屏操作失败: " + (captureErr.message || "未知异常"));
            }
          }
        }


        // 返回 downloadUrl（null 表示所有路径都失败）
        return downloadUrl || null;
      } catch (err) {
        console.error("captureElement:", err);
        throw err;
      }
    }

    // ================================================================
    // 事件处理器
    // ================================================================
    function onMouseMove(e) {
      if (window.__img_capture_gen !== currentGen) return;
      if (window.__imgc_capturing) return; // 捕获进行中，冻结 overlay
      var el = getElementAtPoint(e.clientX, e.clientY);
      if (el) {
        hoveredEl = el;
        var r = el.getBoundingClientRect();
        // 更新 overlay 位置（position:fixed 直接对应视口坐标）
        overlay.style.left = r.left + "px";
        overlay.style.top = r.top + "px";
        overlay.style.width = r.width + "px";
        overlay.style.height = r.height + "px";
        overlay.style.display = "block";
        // 更新标签内容（防 XSS 用 textContent）
        var tag = el.tagName;
        var info = tag;
        if (tag === "IMG" && el.naturalWidth) {
          info = "IMG · " + el.naturalWidth + "×" + el.naturalHeight;
        } else if (tag === "CANVAS") {
          info = "CANVAS · " + el.width + "×" + el.height;
        } else if (tag === "VIDEO") {
          info = "VIDEO · " + (el.videoWidth || "?") + "×" + (el.videoHeight || "?");
        }
        labelEl.textContent = info;
        // 标签定位在 overlay 上方
        labelEl.style.left = r.left + "px";
        labelEl.style.top = Math.max(0, r.top - 22) + "px";
        labelEl.style.display = "block";
      } else {
        hoveredEl = null;
        overlay.style.display = "none";
        labelEl.style.display = "none";
      }
    }

    function onClick(e) {
      if (window.__img_capture_gen !== currentGen) return;
      if (!hoveredEl) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      // 冻结 overlay，防止捕获过程中鼠标移动导致 overlay 重新出现
      window.__imgc_capturing = true;
      overlay.style.borderColor = "rgba(26,115,232,0.4)";
      overlay.style.background = "rgba(26,115,232,0.02)";
      labelEl.style.opacity = "0.6";
      var el = hoveredEl;
      setStatus("正在捕获...");
      // 直接调用（内部为异步），去掉 setTimeout
      captureElement(el).then(async function(downloadUrl) {
        if (!downloadUrl) {
          // 首次失败，延迟 300ms 重试一次（给懒加载/初始化留时间）
          setStatus("首次失败，重试中...");
          await new Promise(function(r) { setTimeout(r, 300); });
          downloadUrl = await captureElement(el);
        }
        if (!downloadUrl) {
          setStatus("捕获失败：无法渲染该元素", true);
          window.__img_capture_timer = setTimeout(cleanup, 2000);
          return;
        }
        setStatus("正在保存...");
        // 带超时的 sendMessage 回调
        var resolved = false;
        var timeoutId = setTimeout(function() {
          if (!resolved) { resolved = true; setStatus("保存超时", true); cleanup(); }
        }, 5000);
        try {
          chrome.runtime.sendMessage(
            { action: "downloadImage", url: downloadUrl, filename: partNumber + ".png" },
            function(response) {
              if (resolved) return;
              resolved = true;
              clearTimeout(timeoutId);
              if (chrome.runtime.lastError) {
                setStatus("下载失败: " + chrome.runtime.lastError.message, true);
              } else if (response && response.success) {
                setStatus("已保存 ✓", false);
              } else {
                setStatus("下载失败", true);
              }
              window.__img_capture_timer = setTimeout(cleanup, 1500);
            }
          );
        } catch (e4) {
          if (!resolved) { resolved = true; clearTimeout(timeoutId); setStatus("发送失败", true); }
          window.__img_capture_timer = setTimeout(cleanup, 1500);
        }
      }).catch(function(err) {
        setStatus("捕获失败: " + (err && err.message ? err.message : err), true);
        window.__img_capture_timer = setTimeout(cleanup, 2000);
      });
    }

    function onKeyDown(e) {
      if (window.__img_capture_gen !== currentGen) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        cleanup();
      }
    }

    function onContextMenu(e) {
      if (window.__img_capture_gen !== currentGen) return;
      e.preventDefault();
      e.stopPropagation();
    }

    // ================================================================
    // 启动事件监听
    // ================================================================
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("contextmenu", onContextMenu, true);

    // 确保焦点在页面上，使键盘事件（Esc）能到达
    window.focus();

    console.log("[截图捕获] 注入成功");
  } catch (err) {
    console.error("[截图捕获] 注入失败:", err.message, err.stack);
    try { cleanup(); } catch (e2) {}
  }
  }); // waitForDOM
}

// 定期刷新
setInterval(() => {
  loadTabGroup();
}, 3000);

// ============================================================
// PNG截图编辑器（独立功能，与现有“保存截图”无关）
// 流程：侧边栏按钮 → 注入框选脚本 → 区域框选 → 截图裁剪
//       → 页面蒙版编辑器（检测线条/擦除/撤销/保存）
// ============================================================

document.getElementById("pngCaptureBtn").addEventListener("click", startPngCapture);

async function startPngCapture() {
  var btn = document.getElementById("pngCaptureBtn");
  try {
    var [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:"))) {
      btn.querySelector("span:last-child").textContent = "此页面不支持";
      setTimeout(function() { btn.querySelector("span:last-child").textContent = "PNG截图"; }, 2000);
      return;
    }
    var data = await chrome.storage.local.get("currentGroup");
    var partNumber = "png_capture";
    if (data.currentGroup && data.currentGroup.tabIds && data.currentGroup.tabIds.includes(tab.id)) {
      partNumber = data.currentGroup.partNumber || "png_capture";
    }
    partNumber = partNumber.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "");

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectPngCaptureEditor,
      args: [partNumber]
    });
    try { await chrome.tabs.update(tab.id, { active: true }); } catch(e) {}
  } catch(e) {
    console.error("startPngCapture error:", e);
    btn.querySelector("span:last-child").textContent = "注入失败";
    setTimeout(function() { btn.querySelector("span:last-child").textContent = "PNG截图"; }, 2000);
  }
}

function injectPngCaptureEditor(partNumber) {
  if (window.__png_editor_active) return;
  window.__png_editor_active = true;
  window.__png_editor_gen = (window.__png_editor_gen || 0) + 1;
  var gen = window.__png_editor_gen;

  var style = document.createElement("style");
  style.id = "__png_style";
  style.textContent =
    "#__png_sel_overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483646;background:rgba(0,0,0,0.3);cursor:crosshair;}" +
    "#__png_sel_rect{position:fixed;border:2px solid #0078d4;background:rgba(0,120,212,0.1);z-index:2147483647;display:none;pointer-events:none;}" +
    "#__png_sel_banner{position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:10px 16px;text-align:center;pointer-events:none;background:linear-gradient(135deg,#0078d4,#005a9e);color:#fff;font-size:13px;font-family:system-ui,'Microsoft YaHei',sans-serif;box-shadow:0 2px 12px rgba(0,0,0,0.25);}" +
    "#__png_sel_banner kbd{display:inline-block;padding:1px 6px;margin:0 2px;background:rgba(255,255,255,0.2);border-radius:3px;font-size:12px;font-family:monospace;border:1px solid rgba(255,255,255,0.3);}" +
    "#__png_ed_overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483646;background:rgba(0,0,0,0.5);display:flex;flex-direction:column;align-items:center;font-family:system-ui,'Microsoft YaHei',sans-serif;}" +
    "#__png_ed_toolbar{display:flex;gap:8px;padding:10px 16px;background:#f8f9fa;border-bottom:1px solid #e0e0e0;width:100%;box-sizing:border-box;flex-wrap:wrap;align-items:center;}" +
    "#__png_ed_toolbar .png-btn{padding:6px 14px;background:#fff;border:1px solid #ddd;color:#666;font-size:12px;border-radius:6px;cursor:pointer;transition:all 0.2s;white-space:nowrap;font-family:inherit;}" +
    "#__png_ed_toolbar .png-btn:hover:not(:disabled){background:#0078d4;border-color:#0078d4;color:#fff;transform:translateY(-1px);box-shadow:0 2px 6px rgba(0,120,212,0.2);}" +
    "#__png_ed_toolbar .png-btn:disabled{opacity:0.4;cursor:not-allowed;}" +
    "#__png_ed_toolbar .png-title{color:#0078d4;font-size:14px;font-weight:600;margin-right:auto;}" +
    "#__png_ed_canvas_wrap{flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;padding:20px;background:#e8e8e8;}" +
    "#__png_ed_inner{position:relative;display:inline-block;line-height:0;}" +
    "#__png_ed_inner canvas{display:block;}" +
    "#__png_ed_canvas{box-shadow:0 4px 24px rgba(0,0,0,0.3);cursor:crosshair;}" +
    "#__png_ed_overlay_cv{position:absolute;top:0;left:0;pointer-events:none;}" +
    "#__png_ed_status{padding:6px 16px;background:#f8f9fa;border-top:1px solid #e0e0e0;width:100%;box-sizing:border-box;font-size:11px;color:#666;text-align:center;}" +
    "#__png_ed_help{padding:6px 16px;background:#f0f4f8;width:100%;box-sizing:border-box;display:flex;gap:16px;justify-content:center;flex-wrap:wrap;}" +
    "#__png_ed_help span{font-size:11px;color:#888;white-space:nowrap;}";
  document.head.appendChild(style);

  // ========== Phase 1: 区域框选 ==========
  var selOverlay = document.createElement("div");
  selOverlay.id = "__png_sel_overlay";
  var selRect = document.createElement("div");
  selRect.id = "__png_sel_rect";
  var selBanner = document.createElement("div");
  selBanner.id = "__png_sel_banner";
  selBanner.innerHTML = '✂️ <b>PNG截图模式</b> — 拖拽框选截图区域 &nbsp;|&nbsp; <kbd>Esc</kbd> 退出';
  document.body.appendChild(selOverlay);
  document.body.appendChild(selRect);
  document.body.appendChild(selBanner);

  var startX = 0, startY = 0, dragging = false;

  function selMouseDown(e) {
    if (gen !== window.__png_editor_gen) return;
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    selRect.style.left = startX + "px";
    selRect.style.top = startY + "px";
    selRect.style.width = "0";
    selRect.style.height = "0";
    selRect.style.display = "block";
  }

  function selMouseMove(e) {
    if (!dragging || gen !== window.__png_editor_gen) return;
    var x = Math.min(startX, e.clientX);
    var y = Math.min(startY, e.clientY);
    var w = Math.abs(e.clientX - startX);
    var h = Math.abs(e.clientY - startY);
    selRect.style.left = x + "px";
    selRect.style.top = y + "px";
    selRect.style.width = w + "px";
    selRect.style.height = h + "px";
  }

  function selMouseUp(e) {
    if (!dragging || gen !== window.__png_editor_gen) return;
    dragging = false;
    var x = Math.min(startX, e.clientX);
    var y = Math.min(startY, e.clientY);
    var w = Math.abs(e.clientX - startX);
    var h = Math.abs(e.clientY - startY);
    if (w < 10 || h < 10) return;
    cleanupSelection();
    captureAndEdit(x, y, w, h);
  }

  function selKeyDown(e) {
    if (gen !== window.__png_editor_gen) return;
    if (e.key === "Escape") { e.preventDefault(); cleanupAll(); }
  }

  function cleanupSelection() {
    selOverlay.removeEventListener("mousedown", selMouseDown);
    window.removeEventListener("mousemove", selMouseMove);
    window.removeEventListener("mouseup", selMouseUp);
    window.removeEventListener("keydown", selKeyDown);
    try { selOverlay.remove(); } catch(e) {}
    try { selRect.remove(); } catch(e) {}
    try { selBanner.remove(); } catch(e) {}
  }

  function cleanupAll() {
    cleanupSelection();
    cleanupEditor();
    try { style.remove(); } catch(e) {}
    window.__png_editor_active = false;
  }

  selOverlay.addEventListener("mousedown", selMouseDown);
  window.addEventListener("mousemove", selMouseMove);
  window.addEventListener("mouseup", selMouseUp);
  window.addEventListener("keydown", selKeyDown);

  // ========== 截图裁剪 ==========
  async function captureAndEdit(rx, ry, rw, rh) {
    var dpr = window.devicePixelRatio || 1;

    // 先隐藏所有选区UI，避免被截入截图
    try { selOverlay.style.display = "none"; } catch(e) {}
    try { selRect.style.display = "none"; } catch(e) {}
    try { selBanner.style.display = "none"; } catch(e) {}

    // 等待浏览器重绘，确保UI已从屏幕消失
    await new Promise(function(r) { requestAnimationFrame(function() { requestAnimationFrame(r); }); });

    chrome.runtime.sendMessage({ action: "captureViewport" }, function(res) {
      if (gen !== window.__png_editor_gen) return;
      cleanupSelection();
      if (!res || !res.success) {
        alert("截图失败: " + (res ? res.error : "无响应"));
        cleanupAll();
        return;
      }
      var img = new Image();
      img.onload = function() {
        var cx = Math.round(rx * dpr);
        var cy = Math.round(ry * dpr);
        var cw = Math.round(rw * dpr);
        var ch = Math.round(rh * dpr);
        cx = Math.max(0, Math.min(cx, img.width));
        cy = Math.max(0, Math.min(cy, img.height));
        cw = Math.min(cw, img.width - cx);
        ch = Math.min(ch, img.height - cy);
        if (cw < 10 || ch < 10) { alert("选区太小"); cleanupAll(); return; }
        var cv = document.createElement("canvas");
        cv.width = cw; cv.height = ch;
        cv.getContext("2d").drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
        var dataUrl = cv.toDataURL("image/png");
        showEditor(dataUrl, cw, ch);
      };
      img.src = res.dataUrl;
    });
  }

  // ========== Phase 2: 编辑器蒙版 ==========
  var edOverlay, edCanvas, edCtx, edOverlayCv, edOverlayCtx;
  var detectedLines = [], linesDetected = false, undoStack = [], clickTimer = null;
  var MAX_UNDO = 30, origW = 0, origH = 0;

  function showEditor(dataUrl, w, h) {
    origW = w; origH = h;
    edOverlay = document.createElement("div");
    edOverlay.id = "__png_ed_overlay";

    var toolbar = document.createElement("div");
    toolbar.id = "__png_ed_toolbar";
    toolbar.innerHTML =
      '<span class="png-title">✏️ 截图编辑器</span>' +
      '<button class="png-btn" id="__png_detect">🔍 检测线条</button>' +
      '<button class="png-btn" id="__png_undo" disabled>↩️ 撤销</button>' +
      '<button class="png-btn" id="__png_save">💾 保存</button>' +
      '<button class="png-btn" id="__png_exit" style="color:#c62828;">✕ 退出</button>';

    var canvasWrap = document.createElement("div");
    canvasWrap.id = "__png_ed_canvas_wrap";

    var innerWrap = document.createElement("div");
    innerWrap.id = "__png_ed_inner";

    edCanvas = document.createElement("canvas");
    edCanvas.id = "__png_ed_canvas";
    edOverlayCv = document.createElement("canvas");
    edOverlayCv.id = "__png_ed_overlay_cv";

    var img = new Image();
    img.onload = function() {
      var maxW = window.innerWidth * 0.88;
      var maxH = window.innerHeight * 0.68;
      var scale = Math.min(1, maxW / img.width, maxH / img.height);
      var dispW = Math.round(img.width * scale);
      var dispH = Math.round(img.height * scale);
      edCanvas.width = img.width;
      edCanvas.height = img.height;
      edCanvas.style.width = dispW + "px";
      edCanvas.style.height = dispH + "px";
      edOverlayCv.width = img.width;
      edOverlayCv.height = img.height;
      edOverlayCv.style.width = dispW + "px";
      edOverlayCv.style.height = dispH + "px";
      edCtx = edCanvas.getContext("2d");
      edOverlayCtx = edOverlayCv.getContext("2d");
      edCtx.drawImage(img, 0, 0);
      innerWrap.appendChild(edCanvas);
      innerWrap.appendChild(edOverlayCv);
    };
    img.src = dataUrl;

    canvasWrap.appendChild(innerWrap);

    var status = document.createElement("div");
    status.id = "__png_ed_status";
    status.textContent = "就绪 — 点击“检测线条”开始";

    var help = document.createElement("div");
    help.id = "__png_ed_help";
    help.innerHTML = '<span>🖱️ 单击线条：擦除到交叉点</span><span>🖱️🖱️ 双击线条：擦除整条线</span><span>↩️ Ctrl+Z：撤销</span>';

    edOverlay.appendChild(toolbar);
    edOverlay.appendChild(help);
    edOverlay.appendChild(status);
    edOverlay.appendChild(canvasWrap);
    document.body.appendChild(edOverlay);

    setupEditorEvents();
  }

  function edStatus(text) {
    var el = document.getElementById("__png_ed_status");
    if (el) el.textContent = text;
  }

  function pushUndo() {
    undoStack.push(edCanvas.toDataURL("image/png"));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    var btn = document.getElementById("__png_undo");
    if (btn) btn.disabled = false;
  }

  function setupEditorEvents() {
    document.getElementById("__png_detect").addEventListener("click", function() {
      edStatus("正在检测线条...");
      setTimeout(function() {
        var imageData = edCtx.getImageData(0, 0, edCanvas.width, edCanvas.height);
        detectedLines = detectLinesFromImage(imageData);
        linesDetected = true;
        drawDetectedLines();
        edStatus("检测到 " + detectedLines.length + " 条线段 — 单击/双击线条擦除");
      }, 50);
    });

    document.getElementById("__png_undo").addEventListener("click", doUndo);

    document.getElementById("__png_save").addEventListener("click", function() {
      var dataUrl = edCanvas.toDataURL("image/png");
      chrome.runtime.sendMessage({ action: "downloadImage", url: dataUrl, filename: partNumber + "_edited.png" }, function(res) {
        if (res && res.success) edStatus("已保存 ✓");
        else edStatus("保存失败");
      });
    });

    document.getElementById("__png_exit").addEventListener("click", cleanupAll);

    edCanvas.addEventListener("click", function(e) {
      if (!linesDetected || detectedLines.length === 0) return;
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
      var pos = canvasCoords(e);
      var line = findNearestLine(pos.x, pos.y);
      if (!line) return;
      var cl = line, cx = pos.x, cy = pos.y;
      clickTimer = setTimeout(function() {
        clickTimer = null;
        eraseLineToIntersections(cl, cx, cy);
      }, 280);
    });

    edCanvas.addEventListener("dblclick", function(e) {
      if (!linesDetected || detectedLines.length === 0) return;
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      var pos = canvasCoords(e);
      var line = findNearestLine(pos.x, pos.y);
      if (!line) return;
      eraseFullLine(line);
    });

    edCanvas.addEventListener("mousemove", function(e) {
      if (!linesDetected || detectedLines.length === 0) return;
      var pos = canvasCoords(e);
      var line = findNearestLine(pos.x, pos.y);
      drawDetectedLines();
      if (line) {
        edOverlayCtx.strokeStyle = "rgba(255,50,50,0.8)";
        edOverlayCtx.lineWidth = 3;
        edOverlayCtx.setLineDash([]);
        edOverlayCtx.beginPath();
        edOverlayCtx.moveTo(line.x1, line.y1);
        edOverlayCtx.lineTo(line.x2, line.y2);
        edOverlayCtx.stroke();
        edCanvas.style.cursor = "pointer";
      } else {
        edCanvas.style.cursor = "crosshair";
      }
    });

    document.addEventListener("keydown", editorKeyHandler);
  }

  function editorKeyHandler(e) {
    if (gen !== window.__png_editor_gen) return;
    if (!edOverlay || edOverlay.style.display === "none") return;
    if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); doUndo(); }
    if (e.key === "Escape") {
      e.preventDefault();
      if (linesDetected) {
        linesDetected = false;
        detectedLines = [];
        edOverlayCtx.clearRect(0, 0, edOverlayCv.width, edOverlayCv.height);
        edCanvas.style.cursor = "crosshair";
        edStatus("已退出线条模式 — 再按 Esc 退出编辑器");
      } else {
        cleanupAll();
      }
    }
  }

  function doUndo() {
    if (undoStack.length === 0) return;
    var dataUrl = undoStack.pop();
    var img = new Image();
    img.onload = function() {
      edCtx.clearRect(0, 0, edCanvas.width, edCanvas.height);
      edCtx.drawImage(img, 0, 0);
      linesDetected = false;
      detectedLines = [];
      edOverlayCtx.clearRect(0, 0, edOverlayCv.width, edOverlayCv.height);
      edStatus("已撤销 — 重新检测线条");
      if (undoStack.length === 0) {
        var btn = document.getElementById("__png_undo");
        if (btn) btn.disabled = true;
      }
    };
    img.src = dataUrl;
  }

  function canvasCoords(e) {
    var rect = edCanvas.getBoundingClientRect();
    var scaleX = edCanvas.width / rect.width;
    var scaleY = edCanvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function cleanupEditor() {
    document.removeEventListener("keydown", editorKeyHandler);
    try { edOverlay.remove(); } catch(e) {}
    edOverlay = null;
  }

  // ===== 线段检测（Sobel + Hough） =====
  function detectLinesFromImage(imageData) {
    var w = imageData.width, h = imageData.height, data = imageData.data;
    var gray = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++)
      gray[i] = Math.round(data[i*4]*0.299 + data[i*4+1]*0.587 + data[i*4+2]*0.114);

    var edges = new Uint8Array(w * h);
    var thresh = 30;
    for (var y = 1; y < h-1; y++) {
      for (var x = 1; x < w-1; x++) {
        var idx = y*w+x;
        var gx = -gray[idx-w-1]+gray[idx-w+1]-2*gray[idx-1]+2*gray[idx+1]-gray[idx+w-1]+gray[idx+w+1];
        var gy = -gray[idx-w-1]-2*gray[idx-w]-gray[idx-w+1]+gray[idx+w-1]+2*gray[idx+w]+gray[idx+w+1];
        edges[idx] = Math.sqrt(gx*gx+gy*gy) > thresh ? 1 : 0;
      }
    }

    var angleBins = 180;
    var rhoMax = Math.ceil(Math.sqrt(w*w+h*h));
    var accum = new Int32Array(angleBins * (2*rhoMax+1));
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (!edges[y*w+x]) continue;
        for (var a = 0; a < angleBins; a++) {
          var theta = a * Math.PI / angleBins;
          var rho = Math.round(x*Math.cos(theta)+y*Math.sin(theta));
          accum[a*(2*rhoMax+1)+(rho+rhoMax)]++;
        }
      }
    }

    var voteThresh = Math.max(30, Math.min(w,h)*0.15);
    var raw = [];
    for (var a = 0; a < angleBins; a++) {
      for (var r = -rhoMax; r <= rhoMax; r++) {
        var v = accum[a*(2*rhoMax+1)+(r+rhoMax)];
        if (v < voteThresh) continue;
        var isMax = true;
        for (var da = -2; da <= 2 && isMax; da++) {
          for (var dr = -2; dr <= 2 && isMax; dr++) {
            if (da===0 && dr===0) continue;
            var na = ((a+da)%angleBins+angleBins)%angleBins;
            var nr = r+dr;
            if (nr < -rhoMax || nr > rhoMax) continue;
            if (accum[na*(2*rhoMax+1)+(nr+rhoMax)] > v) isMax = false;
          }
        }
        if (isMax) raw.push({theta:a*Math.PI/angleBins, rho:r, votes:v});
      }
    }

    raw.sort(function(a,b){return b.votes-a.votes;});
    var filtered = [];
    for (var i = 0; i < raw.length && filtered.length < 80; i++) {
      var l = raw[i]; var tooClose = false;
      for (var j = 0; j < filtered.length; j++) {
        var ad = Math.abs(l.theta-filtered[j].theta);
        if (ad > Math.PI/2) ad = Math.PI-ad;
        if (ad < 0.1 && Math.abs(l.rho-filtered[j].rho) < 10) { tooClose = true; break; }
      }
      if (!tooClose) filtered.push(l);
    }

    var result = [];
    for (var i = 0; i < filtered.length; i++) {
      var pts = getLineEndpoints(filtered[i], w, h);
      if (pts) result.push({theta:filtered[i].theta, rho:filtered[i].rho, x1:pts.x1, y1:pts.y1, x2:pts.x2, y2:pts.y2, votes:filtered[i].votes});
    }
    return result;
  }

  function getLineEndpoints(line, w, h) {
    var cosT = Math.cos(line.theta), sinT = Math.sin(line.theta);
    var pts = [];
    if (Math.abs(sinT) > 0.001) {
      var y0 = (line.rho)/sinT; if (y0>=0&&y0<=h) pts.push({x:0,y:y0});
      var y1 = (line.rho-w*cosT)/sinT; if (y1>=0&&y1<=h) pts.push({x:w,y:y1});
    }
    if (Math.abs(cosT) > 0.001) {
      var x0 = (line.rho)/cosT; if (x0>=0&&x0<=w) pts.push({x:x0,y:0});
      var x1 = (line.rho-h*sinT)/cosT; if (x1>=0&&x1<=w) pts.push({x:x1,y:h});
    }
    if (pts.length < 2) return null;
    return {x1:pts[0].x, y1:pts[0].y, x2:pts[1].x, y2:pts[1].y};
  }

  function drawDetectedLines() {
    edOverlayCtx.clearRect(0, 0, edOverlayCv.width, edOverlayCv.height);
    edOverlayCtx.strokeStyle = "rgba(0,120,212,0.5)";
    edOverlayCtx.lineWidth = 2;
    edOverlayCtx.setLineDash([6,4]);
    for (var i = 0; i < detectedLines.length; i++) {
      var l = detectedLines[i];
      edOverlayCtx.beginPath();
      edOverlayCtx.moveTo(l.x1, l.y1);
      edOverlayCtx.lineTo(l.x2, l.y2);
      edOverlayCtx.stroke();
    }
    edOverlayCtx.setLineDash([]);
  }

  // ===== 线段查找与擦除 =====
  function ptLineDist(px,py,x1,y1,x2,y2) {
    var dx=x2-x1, dy=y2-y1, lenSq=dx*dx+dy*dy;
    if (lenSq<0.001) return Math.sqrt((px-x1)*(px-x1)+(py-y1)*(py-y1));
    var t=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/lenSq));
    return Math.sqrt((px-(x1+t*dx))*(px-(x1+t*dx))+(py-(y1+t*dy))*(py-(y1+t*dy)));
  }

  function findNearestLine(mx,my) {
    var best=null, bd=Infinity;
    for (var i=0;i<detectedLines.length;i++) {
      var d=ptLineDist(mx,my,detectedLines[i].x1,detectedLines[i].y1,detectedLines[i].x2,detectedLines[i].y2);
      if (d<bd) {bd=d; best=detectedLines[i];}
    }
    return bd<15 ? best : null;
  }

  function lineIntersect(l1,l2) {
    var d=(l1.x1-l1.x2)*(l2.y1-l2.y2)-(l1.y1-l1.y2)*(l2.x1-l2.x2);
    if (Math.abs(d)<0.001) return null;
    var t=((l1.x1-l2.x1)*(l2.y1-l2.y2)-(l1.y1-l2.y1)*(l2.x1-l2.x2))/d;
    var ix=l1.x1+t*(l1.x2-l1.x1), iy=l1.y1+t*(l1.y2-l1.y1);
    if (t<0||t>1) return null;
    return {x:ix, y:iy, t:t};
  }

  function findIntersections(line) {
    var pts=[];
    for (var i=0;i<detectedLines.length;i++) {
      if (detectedLines[i]===line) continue;
      var ip=lineIntersect(line,detectedLines[i]);
      if (ip) pts.push(ip);
    }
    pts.sort(function(a,b){return a.t-b.t;});
    return pts;
  }

  function eraseSeg(x1,y1,x2,y2) {
    var dx=x2-x1, dy=y2-y1, len=Math.sqrt(dx*dx+dy*dy);
    if (len<0.5) return;
    var steps = Math.max(Math.ceil(len), 1);
    var brushR = 4;
    edCtx.save();
    edCtx.globalCompositeOperation = "destination-out";
    edCtx.fillStyle = "rgba(0,0,0,1)";
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var px = x1 + t * dx;
      var py = y1 + t * dy;
      edCtx.beginPath();
      edCtx.arc(px, py, brushR, 0, Math.PI * 2);
      edCtx.fill();
    }
    edCtx.restore();
    edCtx.save();
    edCtx.globalCompositeOperation = "destination-over";
    edCtx.fillStyle = "#ffffff";
    edCtx.fillRect(0, 0, edCanvas.width, edCanvas.height);
    edCtx.restore();
  }

  function eraseLineToIntersections(line, cx, cy) {
    var ints = findIntersections(line);
    var dx=line.x2-line.x1, dy=line.y2-line.y1, lenSq=dx*dx+dy*dy;
    var clickT = lenSq>0 ? ((cx-line.x1)*dx+(cy-line.y1)*dy)/lenSq : 0;
    var left = {x:line.x1, y:line.y1, t:0};
    for (var i=0;i<ints.length;i++) { if (ints[i].t<=clickT) left=ints[i]; else break; }
    var right = {x:line.x2, y:line.y2, t:1};
    for (var i=ints.length-1;i>=0;i--) { if (ints[i].t>=clickT) right=ints[i]; else break; }
    pushUndo();
    eraseSeg(left.x, left.y, right.x, right.y);
    var idx = detectedLines.indexOf(line);
    if (idx!==-1) detectedLines.splice(idx,1);
    drawDetectedLines();
    edStatus("已擦除线段到交叉点");
  }

  function eraseFullLine(line) {
    pushUndo();
    eraseSeg(line.x1, line.y1, line.x2, line.y2);
    var idx = detectedLines.indexOf(line);
    if (idx!==-1) detectedLines.splice(idx,1);
    drawDetectedLines();
    edStatus("已擦除整条线");
  }
}