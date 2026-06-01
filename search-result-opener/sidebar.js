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
      setTimeout(() => { btn.querySelector("span:last-child").textContent = "保存图片"; }, 2000);
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
    setTimeout(() => { btn.querySelector("span:last-child").textContent = "保存图片"; }, 2000);
  }
}

// ============================================================
// 元素捕捉器（注入到目标标签页执行）
// 类似 DevTools inspect + Save to Notion：
// 鼠标移动 → 蓝色遮罩跟随 → 点击截图保存 → Esc 退出
// ============================================================
function injectImageCapture(partNumber) {
  // --- 清理上一次残留 ---
  if (window.__img_capture_timer) { clearTimeout(window.__img_capture_timer); window.__img_capture_timer = null; }
  ["__img_capture_banner", "__img_capture_overlay", "__img_capture_style"].forEach(function (id) {
    try { var old = document.getElementById(id); if (old) old.remove(); } catch (e) {}
  });

  // --- 代数标记 ---
  window.__img_capture_gen = (window.__img_capture_gen || 0) + 1;
  var currentGen = window.__img_capture_gen;

  // --- 注入样式 ---
  var style = document.createElement("style");
  style.id = "__img_capture_style";
  style.textContent =
    "#__img_capture_banner{" +
      "position:fixed;top:0;left:0;right:0;z-index:2147483647;" +
      "padding:8px 16px;text-align:center;pointer-events:none;" +
      "background:linear-gradient(135deg,#1a73e8,#1557b0);color:#fff;font-size:13px;" +
      "font-family:system-ui,'Microsoft YaHei',sans-serif;" +
      "box-shadow:0 2px 12px rgba(0,0,0,0.2);" +
    "}" +
    "#__img_capture_overlay{" +
      "position:fixed;z-index:2147483646;pointer-events:none;" +
      "background:rgba(26,115,232,0.15);" +
      "outline:2px solid rgba(26,115,232,0.55);" +
      "display:none;" +
      "box-shadow:0 0 0 4px rgba(26,115,232,0.08);" +
    "}";
  document.head.appendChild(style);

  // --- 创建 UI ---
  var banner = document.createElement("div");
  banner.id = "__img_capture_banner";
  banner.textContent = "\u{1F4F7} 元素捕捉模式 — 移动鼠标对准任意元素，单击保存为图片，Esc 退出";

  var overlay = document.createElement("div");
  overlay.id = "__img_capture_overlay";

  document.body.appendChild(banner);
  document.body.appendChild(overlay);

  // --- 状态 ---
  var hoveredEl = null;
  var overlayVisible = false;

  // --- 我们的元素 ID 集合 ---
  var OUR_IDS = { "__img_capture_banner": true, "__img_capture_overlay": true };

  function isOurUI(el) {
    for (var e = el; e; e = e.parentElement) {
      if (OUR_IDS[e.id]) return true;
    }
    return false;
  }

  // --- 核心：获取鼠标下方的真实页面元素 ---
  // 先隐藏 overlay → elementsFromPoint → 取第一个真实元素 → 恢复 overlay
  function getElementAtPoint(x, y) {
    var wasShowing = overlayVisible;
    if (wasShowing) overlay.style.display = "none";

    var all = document.elementsFromPoint(x, y);

    if (wasShowing) overlay.style.display = "";

    if (!all || all.length === 0) return null;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!el || el === document.body || el === document.documentElement) continue;
      if (el.id === "__img_capture_banner" || el.id === "__img_capture_overlay") continue;
      var r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
    return null;
  }

  // --- 显示 / 隐藏遮罩 ---
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

  // --- 清理 ---
  function cleanup() {
    if (window.__img_capture_timer) { clearTimeout(window.__img_capture_timer); window.__img_capture_timer = null; }
    try { document.body.removeChild(banner); } catch (e) {}
    try { document.body.removeChild(overlay); } catch (e) {}
    try { document.head.removeChild(style); } catch (e) {}
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
  }

  // --- mousemove: 鼠标移到哪，遮罩跟到哪 ---
  function onMouseMove(e) {
    if (window.__img_capture_gen !== currentGen) return;
    var el = getElementAtPoint(e.clientX, e.clientY);
    if (el) {
      hoveredEl = el;
      showOverlay(el);
    }
  }

  // --- click: 点击选中元素 → 截图保存 ---
  function onClick(e) {
    if (window.__img_capture_gen !== currentGen) return;
    if (!hoveredEl) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // 闪烁确认
    overlay.style.background = "rgba(26,115,232,0.35)";
    overlay.style.outline = "3px solid rgba(26,115,232,0.85)";
    overlay.style.boxShadow = "0 0 0 6px rgba(26,115,232,0.18)";

    var el = hoveredEl;
    setTimeout(function () { captureAndSave(el); }, 120);
  }

  // --- keydown: Esc 退出 ---
  function onKeyDown(e) {
    if (window.__img_capture_gen !== currentGen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
    }
  }

  // --- 截图 & 下载（全部统一为 PNG 格式） ---

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
        "color","background-color","font-family","font-size","font-weight","font-style",
        "text-align","text-decoration","line-height","letter-spacing",
        "padding-left","padding-right","padding-top","padding-bottom",
        "margin-left","margin-right","margin-top","margin-bottom",
        "border-left","border-right","border-top","border-bottom","border-radius",
        "display","overflow","white-space","word-break","opacity",
        "width","height","max-width","max-height"
      ];
      var cssText = "";
      for (var i = 0; i < styleProps.length; i++) {
        var p = styleProps[i];
        var v = computed.getPropertyValue(p);
        if (v && v !== "none" && v !== "normal" && v !== "auto" &&
            v !== "rgba(0, 0, 0, 0)" && v !== "transparent" && v !== "0px") {
          cssText += p + ":" + v + ";";
        }
      }

      var clone = el.cloneNode(true);
      var html = clone.outerHTML || el.outerHTML || el.innerHTML;
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + fw + '" height="' + fh + '">' +
        '<foreignObject width="100%" height="100%">' +
        '<div xmlns="http://www.w3.org/1999/xhtml" style="' + cssText + 'width:' + w + 'px;height:' + h + 'px;overflow:hidden;">' +
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

  async function captureAndSave(el) {
    overlay.style.display = "none";
    overlayVisible = false;

    var tag = el.tagName;
    var r = el.getBoundingClientRect();
    var downloadUrl = null;

    try {
      if (tag === "IMG") {
        var srcUrl = el.src;
        // 尝试直接绘制（同源图片）
        try {
          var cv1 = document.createElement("canvas");
          cv1.width = el.naturalWidth; cv1.height = el.naturalHeight;
          cv1.getContext("2d").drawImage(el, 0, 0);
          downloadUrl = cv1.toDataURL("image/png", 0.95);
        } catch (directErr) {
          // 跨域图片：通过新建 Image 带 CORS 重新加载，再绘制为 PNG
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
            // 彻底失败：用 SVG foreignObject 渲染（跨域图可能空白但不会保留原始格式）
            downloadUrl = await captureElementAsImage(el);
          }
        }
      } else if (tag === "CANVAS") {
        try { downloadUrl = el.toDataURL("image/png"); } catch (e) {}
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
        try { chrome.runtime.sendMessage({ action: "downloadImage", url: downloadUrl, filename: partNumber + ".png" }); } catch (e) {}
      }
      window.__img_capture_timer = setTimeout(cleanup, 300);
    } catch (err) {
      console.error("captureAndSave:", err);
      cleanup();
    }
  }

  // --- 启动事件监听 ---
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
}

// 定期刷新
setInterval(() => {
  loadTabGroup();
}, 3000);
