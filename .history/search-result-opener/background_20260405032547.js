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
    
    // 2. 分批打开搜索结果页面 (5个一组)
    const resultTabs = [];
    const BATCH_SIZE = 5;
    let groupId = null;

    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
      const chunk = urls.slice(i, i + BATCH_SIZE);
      const chunkMetadata = metadata.slice(i, i + BATCH_SIZE);
      
      // 并发创建当前批次的标签页
      const batchPromises = chunk.map(url => chrome.tabs.create({ url, active: false }));
      const batchTabs = await Promise.all(batchPromises);
      resultTabs.push(...batchTabs);

      // 立即将本批次信息发送给导航页展示 (增量更新)
      for (let j = 0; j < batchTabs.length; j++) {
        const tab = batchTabs[j];
        const data = chunkMetadata[j] || {};
        const absoluteIndex = i + j;
        
        try {
          await chrome.tabs.sendMessage(navTab.id, {
            action: 'addScreenshot',
            index: absoluteIndex,
            screenshot: null,
            title: data.title || '加载中...',
            url: chunk[j],
            favIconUrl: data.favIconUrl || '',
            tabId: tab.id,
            total: urls.length
          });
        } catch (e) { console.error('Error sending batch info:', e); }
      }

      // 动态更新标签页组
      if (createGroup) {
        const batchTabIds = batchTabs.map(t => t.id);
        if (i === 0) {
          // 第一批：创建组并包含导航页
          groupId = await chrome.tabs.group({ tabIds: [navTab.id, ...batchTabIds] });
          await chrome.tabGroups.update(groupId, { title: partNumber, color: 'blue', collapsed: false });
        } else {
          // 后续批次：加入现有组
          await chrome.tabs.group({ groupId, tabIds: batchTabIds });
        }
      }

      // 批次间短暂延迟，降低 CPU 峰值
      if (i + BATCH_SIZE < urls.length) {
        await new Promise(r => setTimeout(r, 600));
      }
    }
    
    // 4. 保存导航数据
    await chrome.storage.local.set({
      navigationData: {
        partNumber: partNumber,
        supplier: supplier,
        searchEngine: searchEngine,
        navTabId: navTab.id,
        resultTabIds: resultTabs.map(t => t.id),
        showThumbnails: showThumbnails
      }
    });

    // 5. 异步更新页面最终信息，并触发站内二次搜索
    (async () => {
      for (let i = 0; i < resultTabs.length; i++) {
        const tab = resultTabs[i];
        try {
          await waitForTabLoad(tab.id);
          const finalTab = await chrome.tabs.get(tab.id);
          
          // 1. 更新导航页卡片状态
          await chrome.tabs.sendMessage(navTab.id, {
            action: 'updateScreenshot', 
            index: i,
            screenshot: null, 
            title: finalTab.title,
            favIconUrl: finalTab.favIconUrl || (metadata[i] ? metadata[i].favIconUrl : '')
          });

          // 2. 发送指令给目标页执行智能填充与搜索
          chrome.tabs.sendMessage(tab.id, {
            fAction: 'smartFillAndSearch',
            partNumber: partNumber
          });
        } catch (e) {
          console.error('Async processing error:', e);
        }
      }
    })();
    
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

// 等待标签页加载完成
function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const checkTab = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') {
          // 再等待一下确保content script加载
          setTimeout(resolve, 500);
        } else {
          setTimeout(checkTab, 100);
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
