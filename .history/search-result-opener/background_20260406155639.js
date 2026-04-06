// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openLinks') {
    openLinksWithNavigation(request.links, request.partNumber, request.supplier, request.searchEngine, request.createGroup, request.openSidebar, request.showThumbnails)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Error opening links:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // 保持消息通道开放
  } else if (request.action === 'switchToTab') {
    // 切换到指定标签页
    chrome.tabs.update(request.tabId, { active: true }, (tab) => {
      if (tab) {
        chrome.windows.update(tab.windowId, { focused: true });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false });
      }
    });
    return true;
  }
});

// 打开链接并创建导航页面
async function openLinksWithNavigation(links, partNumber, supplier, searchEngine, createGroup, openSidebar, showThumbnails) {
  try {
    // 安全性检查：确保 links 是数组
    if (!Array.isArray(links)) {
      console.error('Invalid links received:', links);
      throw new Error('未获取到有效的搜索结果');
    }

    // 兼容处理：如果是对象数组（包含预提取的标题/图标），则提取 URL
    const urls = links.map(l => typeof l === 'string' ? l : l.url);
    const metadata = links.map(l => typeof l === 'string' ? null : l);

    // 1. 创建导航页面
    const navTab = await chrome.tabs.create({
      url: chrome.runtime.getURL('navigation.html'),
      active: true
    });
    
    // 等待导航页面加载
    await waitForTabLoad(navTab.id);

    // 【关键】瞬间同步初始信息到导航页，解决 Header 显示 "-" 的问题
    // 增加重试逻辑，确保导航页已准备好接收消息
    (async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                await chrome.tabs.sendMessage(navTab.id, {
                    action: 'initNavigation',
                    data: {
                        partNumber: partNumber,
                        supplier: supplier,
                        searchEngine: searchEngine,
                        total: urls.length
                    }
                });
                break; 
            } catch (e) {
                await new Promise(r => setTimeout(r, 300));
            }
        }
    })();
    
    // 2. 快速循序渐进打开标签页 (不再分批等待，实现“一次性全抓”的用户体验)
    const resultTabs = [];
    let groupId = null;

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const data = metadata[i] || {};
        
        // 创建标签页
        const tab = await chrome.tabs.create({ url, active: false });
        resultTabs.push(tab);

        // 立即同步到导航页 (无需分批发送，让页面看起来是流式出现的)
        try {
            await chrome.tabs.sendMessage(navTab.id, {
                action: 'addScreenshot',
                index: i,
                screenshot: null,
                title: data.title || '加载中...',
                url: url,
                favIconUrl: data.favIconUrl || '',
                tabId: tab.id,
                total: urls.length
            });
        } catch (e) { console.error('Error sending info:', e); }

        // 标签页分组 (增量添加)
        if (createGroup) {
            if (i === 0) {
                groupId = await chrome.tabs.group({ tabIds: [navTab.id, tab.id] });
                await chrome.tabGroups.update(groupId, { title: partNumber, color: 'blue', collapsed: false });
            } else {
                await chrome.tabs.group({ groupId, tabIds: tab.id });
            }
        }

        // 异步注入处理：每个页面独立等待并注入 (不阻塞创建)
        (async (currTab, currIndex) => {
            try {
                await waitForTabLoad(currTab.id, 30000);
                const finalTab = await chrome.tabs.get(currTab.id);
                
                await chrome.tabs.sendMessage(navTab.id, {
                    action: 'updateScreenshot', 
                    index: currIndex,
                    screenshot: null, 
                    title: finalTab.title,
                    favIconUrl: finalTab.favIconUrl || (metadata[currIndex] ? metadata[currIndex].favIconUrl : '')
                });

                chrome.tabs.sendMessage(currTab.id, {
                    fAction: 'smartFillAndSearch',
                    partNumber: partNumber
                });
            } catch (e) {}
        })(tab, i);

        // 维持极短延迟 (150ms)，既保证一次性全开的感觉，又防止浏览器被瞬间指令冲爆
        await new Promise(r => setTimeout(r, 150));
    }
    
    // 4. 保存导航数据 (统一使用 currentGroup 键名，确保侧边栏能读取)
    const currentGroupData = {
      groupId: groupId,
      partNumber: partNumber,
      supplier: supplier,
      searchEngine: searchEngine,
      navTabId: navTab.id,
      tabIds: resultTabs.map(t => t.id),
      showThumbnails: showThumbnails,
      timestamp: Date.now()
    };
    
    await chrome.storage.local.set({
      navigationData: currentGroupData,
      currentGroup: currentGroupData
    });
    
    // 6. 激活导航页面
    await chrome.tabs.update(navTab.id, { active: true });
    
    // 7. 打开侧边栏
    if (openSidebar) {
      const tab = await chrome.tabs.get(navTab.id);
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
    
    return true;
  } catch (error) {
    console.error('Error in openLinksWithNavigation:', error);
    throw error;
  }
}

// 截取页面截图 (改进：不再强行激活标签页，避免页面跳动)
async function capturePageScreenshot(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.active) {
      return null; // 非活跃标签页不截图，由 Favicon 占位
    }
    
    const screenshot = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: 80
    });
    
    return screenshot;
  } catch (e) {
    console.error('Screenshot error:', e);
    return null;
  }
}

// 批量打开链接并创建标签页组（保留用于兼容性）
async function openLinksInGroup(links, partNumber, supplier, createGroup, openSidebar) {
  try {
    const tabIds = [];
    
    // 按顺序创建标签页（保持搜索引擎排序）
    for (const url of links) {
      const tab = await chrome.tabs.create({ 
        url: url, 
        active: false 
      });
      tabIds.push(tab.id);
      
      // 添加小延迟，避免浏览器卡顿
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    let groupId = -1;
    
    // 创建标签页组
    if (createGroup && tabIds.length > 0) {
      groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title: partNumber,
        color: 'blue',
        collapsed: false
      });
    }
    
    // 激活第一个标签页
    if (tabIds.length > 0) {
      await chrome.tabs.update(tabIds[0], { active: true });
    }
    
    // 保存组信息到storage
    await chrome.storage.local.set({
      currentGroup: {
        groupId: groupId,
        partNumber: partNumber,
        supplier: supplier,
        tabIds: tabIds,
        timestamp: Date.now()
      }
    });
    
    // 等待第一个页面加载完成
    if (tabIds.length > 1) {
      await waitForTabLoad(tabIds[0]);
      
      // 获取其他标签页信息
      const otherTabs = [];
      for (let i = 1; i < tabIds.length; i++) {
        try {
          const tab = await chrome.tabs.get(tabIds[i]);
          otherTabs.push({
            id: tab.id,
            title: tab.title,
            url: tab.url,
            favIconUrl: tab.favIconUrl
          });
        } catch (e) {
          console.error('Error getting tab:', e);
        }
      }
      
      // 向第一个页面注入缩略图面板
      if (otherTabs.length > 0) {
        try {
          await chrome.tabs.sendMessage(tabIds[0], {
            action: 'showThumbnailPanel',
            tabs: otherTabs
          });
        } catch (e) {
          console.error('Error showing thumbnail panel:', e);
        }
      }
    }
    
    // 打开侧边栏
    if (openSidebar && tabIds.length > 0) {
      // 获取当前窗口
      const tab = await chrome.tabs.get(tabIds[0]);
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
    
    return true;
  } catch (error) {
    console.error('Error in openLinksInGroup:', error);
    throw error;
  }
}

// 等待标签页加载完成 (增加超时处理，防止某个页面卡死导致全局阻塞)
function waitForTabLoad(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkTab = async () => {
      // 检查是否超时
      if (Date.now() - startTime > timeout) {
        console.warn(`Tab ${tabId} load timeout after ${timeout}ms`);
        resolve();
        return;
      }

      try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab) {
          resolve();
          return;
        }
        if (tab.status === 'complete') {
          // 再等待一下确保 content script 加载
          setTimeout(resolve, 500);
        } else {
          setTimeout(checkTab, 200); // 稍微调大轮询间隔，减少 CPU 开销
        }
      } catch (e) {
        resolve(); // 标签页可能已关闭
      }
    };
    checkTab();
  });
}

// 监听标签页关闭事件，更新存储的组信息
chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const data = await chrome.storage.local.get('currentGroup');
    if (data.currentGroup && data.currentGroup.tabIds) {
      const updatedTabIds = data.currentGroup.tabIds.filter(id => id !== tabId);
      
      if (updatedTabIds.length > 0) {
        data.currentGroup.tabIds = updatedTabIds;
        await chrome.storage.local.set({ currentGroup: data.currentGroup });
      } else {
        // 所有标签页都关闭了，清除存储
        await chrome.storage.local.remove('currentGroup');
      }
    }
  } catch (error) {
    console.error('Error updating tab list:', error);
  }
});
