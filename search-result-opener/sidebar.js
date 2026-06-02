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
      // 不是批量打开的标签页，从 URL 提取有意义的文件名
      try {
        const url = new URL(tab.url);
        const pathParts = url.pathname.split("/").filter(Boolean);
        const lastPath = pathParts.length > 0 ? pathParts[pathParts.length - 1] : "";
        // 如果最后一段路径像文件名，使用它；否则用 hostname
        if (lastPath && /\.[a-z0-9]+$/i.test(lastPath)) {
          partNumber = lastPath.replace(/\.[^.]+$/, "").replace(/[<>:"/\|?*]/g, "_") || "capture";
        } else {
          partNumber = url.hostname.replace(/^www\./, "").replace(/[<>:"/\|?*]/g, "_") || "capture";
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
    var IDS = ["__imgc_banner", "__imgc_style"];
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
      "}";
    document.head.appendChild(style);

    // ================================================================
    // 创建 UI（仅 banner）
    // ================================================================
    var banner = document.createElement("div");
    banner.id = "__imgc_banner";
    banner.innerHTML = '📷 <b>截图模式</b> — <kbd>单击</kbd> 保存光标处元素 &nbsp;|&nbsp; <kbd>Esc</kbd> 退出';

    document.body.appendChild(banner);

    // ================================================================
    // 状态
    // ================================================================
    var hoveredEl = null;
    var OUR_IDS = {};
    IDS.forEach(function (id) { OUR_IDS[id] = true; });

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

        if (isBlock || isListOrCard || hasContent || cr.width >= 100 || cr.height >= 40) {
          var curTag = cur.tagName;
          if (!/^(IMG|VIDEO|CANVAS|SVG)$/i.test(curTag)) {
            var imgs = cur.querySelectorAll("img, video, canvas");
            if (imgs.length === 1) {
              var ir = imgs[0].getBoundingClientRect();
              if (ir.width >= 20 && ir.height >= 20) {
                return imgs[0];
              }
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
          if (rr.width >= 20 && rr.height >= 20) {
            return el;
          }
        }
      }

      // 第二遍：常规元素查找
      for (var j = 0; j < all.length; j++) {
        var el2 = all[j];
        if (!el2 || el2 === document.body || el2 === document.documentElement) continue;
        if (OUR_IDS[el2.id]) continue;
        var rr2 = el2.getBoundingClientRect();
        if (rr2.width > 0 && rr2.height > 0) {
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
      try { document.body.removeChild(banner); } catch (e) {}
      try { document.head.removeChild(style); } catch (e) {}
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
    }

    // ================================================================
    // SVG foreignObject 方式渲染元素
    // ================================================================
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

    // ================================================================
    // 元素截图入口（修正 Bug 2：容器内图片穿透）
    // ================================================================
    async function captureElement(el) {
      // 修正 Bug 2：如果捕获目标不是媒体元素，检查是否包含主要图片
      var tag = el.tagName;
      if (!/^(IMG|VIDEO|CANVAS|SVG)$/i.test(tag)) {
        var childMedia = el.querySelector("img:not([width='1']):not([height='1']), video, canvas");
        if (childMedia) {
          var cmRect = childMedia.getBoundingClientRect();
          if (cmRect.width >= 20 && cmRect.height >= 20) {
            var elRect = el.getBoundingClientRect();
            var areaRatio = (cmRect.width * cmRect.height) / (elRect.width * elRect.height);
            if (areaRatio >= 0.3) {
              el = childMedia;
              tag = el.tagName;
            }
          }
        }
      }

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

    // ================================================================
    // 事件处理器
    // ================================================================
    function onMouseMove(e) {
      if (window.__img_capture_gen !== currentGen) return;
      var el = getElementAtPoint(e.clientX, e.clientY);
      if (el) { hoveredEl = el; }
    }

    function onClick(e) {
      if (window.__img_capture_gen !== currentGen) return;
      if (!hoveredEl) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      var el = hoveredEl;
      setTimeout(function () { captureElement(el); }, 120);
    }

    function onKeyDown(e) {
      if (window.__img_capture_gen !== currentGen) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
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
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("contextmenu", onContextMenu, true);

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
