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

  // 监听存储变化（当新搜索发起时，currentGroup 会更新；_capReq 触发截图）
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.currentGroup) {
      loadTabGroup();
    }
    if (changes._capReq && changes._capReq.newValue) {
      handleCaptureRequest(changes._capReq.newValue);
    }
  });

  async function handleCaptureRequest(req) {
    const { rect, dpr, fn, ts } = req;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error("无法获取当前标签页");
      const dataUrl = await new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, (result) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(result);
        });
      });
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("加载截图失败"));
        i.src = dataUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = rect.width;
      canvas.height = rect.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, rect.left * dpr, rect.top * dpr, rect.width * dpr, rect.height * dpr, 0, 0, rect.width, rect.height);
      const croppedUrl = canvas.toDataURL("image/png", 0.95);
      await new Promise((resolve, reject) => {
        chrome.downloads.download({ url: croppedUrl, filename: fn, saveAs: true }, (downloadId) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(downloadId);
        });
      });
      chrome.storage.local.set({ _capRes: { success: true, ts } });
    } catch (err) {
      chrome.storage.local.set({ _capRes: { success: false, error: err.message, ts } });
    }
  }

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
    if (!tab) { console.error("[截图捕获] 无法获取当前标签页"); return; }

    // 检查是否为受限页面（chrome://, chrome-extension:// 等无法注入脚本）
    if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:") || tab.url.startsWith("edge-extension://"))) {
      btn.querySelector("span:last-child").textContent = "此页面不支持";
      setTimeout(() => { btn.querySelector("span:last-child").textContent = "保存截图"; }, 2000);
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
    partNumber = partNumber.replace(/\s+/g, "");

    console.log("[截图捕获] 正在注入到标签页", tab.id, tab.url, "partNumber:", partNumber);
    const injectResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectImageCapture,
      args: [partNumber],
    });
    if (chrome.runtime.lastError) {
      console.error("[截图捕获] 注入错误:", chrome.runtime.lastError.message);
      throw new Error(chrome.runtime.lastError.message);
    }
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
  console.log("[截图捕获] 开始注入, partNumber:", partNumber);
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

    // 修正 Bug 2：优先返回媒体元素，解决放大镜/缩放图片无法捕获的问题
    function getMeaningfulElement(el) {
      if (!el) return null;
      var tag = el.tagName;
      var r = el.getBoundingClientRect();

      if (/^(IMG|VIDEO|CANVAS|SVG)$/i.test(tag) && r.width >= 20 && r.height >= 20) {
        return el;
      }

      var cur = el;
      while (cur && cur !== document.body && cur !== document.documentElement) {
        var cr = cur.getBoundingClientRect();
        var display = getComputedStyle(cur).display;
        var isBlock = display === "block" || display === "flex" || display === "grid" ||
                      display === "inline-block" || display === "inline-flex" || display === "table";
        var hasContent = (cur.querySelector("img, svg, video, canvas"));
        var isListOrCard = /^(LI|ARTICLE|SECTION|DIV|MAIN|ASIDE|HEADER|FOOTER|NAV|FIGURE|FORM)$/i.test(cur.tagName);

        // 检查 CSS background-image（用于捕获背景图容器）
        var bgImage = getComputedStyle(cur).backgroundImage;
        var hasBgImage = bgImage && bgImage !== "none" && bgImage.indexOf("url(") !== -1;

        if (isBlock || isListOrCard || hasContent || hasBgImage || cr.width >= 100 || cr.height >= 40) {
          var curTag = cur.tagName;
          if (!/^(IMG|VIDEO|CANVAS|SVG)$/i.test(curTag)) {
            var imgs = cur.querySelectorAll("img, video, canvas");
            // 优先穿透：如果只有一个子媒体元素，返回它
            if (imgs.length === 1) {
              var ir = imgs[0].getBoundingClientRect();
              if (ir.width >= 20 && ir.height >= 20) {
                return imgs[0];
              }
            }
            // 多子媒体元素时：优先查找占据主要面积的 canvas（360°查看器常见模式）
            if (imgs.length > 1) {
              for (var mi = 0; mi < imgs.length; mi++) {
                var mEl = imgs[mi];
                if (mEl.tagName === "CANVAS") {
                  var mr = mEl.getBoundingClientRect();
                  if (mr.width >= 100 && mr.height >= 100) {
                    var areaRatio2 = (mr.width * mr.height) / (cr.width * cr.height);
                    if (areaRatio2 >= 0.5) {
                      return mEl;
                    }
                  }
                }
              }
            }
            // 如果有背景图但无子媒体元素，返回容器本身（交给 captureElement 的 background-image 路径）
            if (hasBgImage && imgs.length === 0 && /^(DIV|LI|A|SPAN)$/i.test(curTag)) {
              return cur;
            }
          }
          return cur;
        }
        cur = cur.parentElement;
      }
      return el;
    }

    // 修正 Bug 2：两遍扫描 — 第一遍优先找媒体元素
    function getElementAtPoint(x, y) {
      var all = document.elementsFromPoint(x, y);
      if (!all || all.length === 0) return null;

      // 第一遍：优先找媒体元素
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (!el || el === document.body || el === document.documentElement) continue;
        if (OUR_IDS[el.id]) continue;
        if (/^(IMG|VIDEO|CANVAS)$/i.test(el.tagName)) {
          var rr = el.getBoundingClientRect();
          // canvas 放宽阈值（360°查看器的 canvas 可能较小）
          var minW = el.tagName === "CANVAS" ? 10 : 20;
          var minH = el.tagName === "CANVAS" ? 10 : 20;
          if (rr.width >= minW && rr.height >= minH) {
            return el;
          }
        }
      }

      // 第二遍：常规元素查找（跳过 zoom lens 遮罩）
      var ZOOM_LENS_CLASSES = ["zoom-lens", "zoomLens", "cloud-zoom-lens", "img-zoom-lens",
                               "magnify-lens", "magnifier-lens", "zoomContainer", "zoomWindow"];
      for (var j = 0; j < all.length; j++) {
        var el2 = all[j];
        if (!el2 || el2 === document.body || el2 === document.documentElement) continue;
        if (OUR_IDS[el2.id]) continue;
        // 跳过 zoom lens 遮罩层（不修改 DOM，仅在元素选择时过滤）
        var isZoomLens = false;
        var elClass = el2.className || "";
        if (typeof elClass === "string") {
          for (var z = 0; z < ZOOM_LENS_CLASSES.length; z++) {
            if (elClass.indexOf(ZOOM_LENS_CLASSES[z]) !== -1) { isZoomLens = true; break; }
          }
        }
        if (isZoomLens) continue;
        // 跳过透明/隐藏/极小元素（遮罩层常见特征）
        try {
          var el2Style = getComputedStyle(el2);
          if (el2Style.opacity === "0" || el2Style.visibility === "hidden") continue;
        } catch (e) {}
        var rr2 = el2.getBoundingClientRect();
        if (rr2.width > 1 && rr2.height > 1) {
          return getMeaningfulElement(el2);
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
    // 元素截图入口（修正 Bug 2：容器内图片穿透）
    // 返回: Promise<string|null> — 成功返回 dataURL，失败返回 null
    // ================================================================
    async function captureElement(el) {
      // 修正 Bug 2+：若捕获目标不是媒体元素，找 DIV 内最佳子图片
      // 不再依赖面积比（areaRatio >= 0.3 容易漏掉卡片布局中的产品图），
      // 而是遍历所有子 img，按显示面积排序选最大的，保底也检查 video/canvas
      var tag = el.tagName;
      if (!/^(IMG|VIDEO|CANVAS|SVG)$/i.test(tag)) {
        var bestChild = null, bestArea = 0;
        var allChildImgs = el.querySelectorAll("img");
        for (var ci = 0; ci < allChildImgs.length; ci++) {
          var cImg = allChildImgs[ci];
          var cr = cImg.getBoundingClientRect();
          // 跳过极小图 / 占位图 / 懒加载 1×1 占位
          if (cr.width < 30 || cr.height < 30) continue;
          if (cImg.naturalWidth === 1 && cImg.naturalHeight === 1) continue;
          var ca = cr.width * cr.height;
          if (ca > bestArea) { bestArea = ca; bestChild = cImg; }
        }
        // 无合适 img 时检查 video / canvas
        if (!bestChild) {
          var childMedia = el.querySelector("video, canvas");
          if (childMedia) {
            var cmr = childMedia.getBoundingClientRect();
            if (cmr.width >= 20 && cmr.height >= 20) { bestChild = childMedia; }
          }
        }
        // 穿透到最佳子元素
        if (bestChild) {
          el = bestChild;
          tag = el.tagName;
        }
      }

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
          // background-image 失败 → storage 通信让侧边栏截图+裁剪+下载
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
              if (clipRect.width <= 0 || clipRect.height <= 0) throw new Error("element outside viewport");
              var ts = Date.now();
              await new Promise(function(resolve, reject) {
                chrome.storage.local.set({ _capReq: { rect: clipRect, dpr: capDpr, fn: partNumber + ".png", ts: ts } }, function() {
                  if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
                  var count = 0;
                  var poll = setInterval(function() {
                    count++;
                    chrome.storage.local.get('_capRes', function(data) {
                      if (data._capRes && data._capRes.ts === ts) {
                        clearInterval(poll);
                        chrome.storage.local.remove('_capRes');
                        if (data._capRes.success) resolve();
                        else reject(new Error(data._capRes.error || "capture failed"));
                      } else if (count >= 50) {
                        clearInterval(poll);
                        reject(new Error("capture timeout"));
                      }
                    });
                  }, 200);
                });
              });
              downloadUrl = "__captured__";
            } catch (captureErr) {
              console.error("captureStorage failed:", captureErr);
              downloadUrl = null;
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
        if (downloadUrl === "__captured__") {
          setStatus("已保存 ✓", false);
          window.__img_capture_timer = setTimeout(cleanup, 1500);
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
}

// 定期刷新
setInterval(() => {
  loadTabGroup();
}, 3000);
