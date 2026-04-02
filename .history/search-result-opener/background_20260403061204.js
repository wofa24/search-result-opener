// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openLinks') {
    openLinksWithNavigation(request.links, request.partNumber, request.supplier, request.searchEngine, request.createGroup, request.openSidebar)
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
async function openLinksWithNavigation(links, partNumber, supplier, searchEngine, createGroup, openSidebar) {
  try {
    // 1. 创建导航页面
    const navTab = await chrome.tabs.create({
      url: chrome.runtime.getURL('navigation.html'),
      active: true
    });
    
    // 等待导航页面加载
    await waitForTabLoad(navTab.id);
    
    // 2. 打开所有搜索结果页面
    const resultTabs = [];
    for (const url of links) {
      const tab = await chrome.tabs.create({ 
        url: url, 
        active: false 
      });
      resultTabs.push(tab);
      
      // 添加小延迟，避免浏览器卡顿
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // 3. 创建标签页组
    if (createGroup) {
      const allTabIds = [navTab.id, ...resultTabs.map(t => t.id)];
      const groupId = await chrome.tabs.group({ tabIds: allTabIds });
      await chrome.tabGroups.update(groupId, {
        title: partNumber,
        color: 'blue',
        collapsed: false
      });
    }
    
    // 4. 保存导航数据
    await chrome.storage.local.set({
      navigationData: {
        partNumber: partNumber,
        supplier: supplier,
        searchEngine: searchEngine,
        navTabId: navTab.id,
        resultTabIds: resultTabs.map(t => t.id)
      }
    });
    
    // 5. 依次截取每个页面并发送到导航页面
    for (let i = 0; i < resultTabs.length; i++) {
      const tab = resultTabs[i];
      
      // 激活该标签页
      await chrome.tabs.update(tab.id, { active: true });
      
      // 等待页面加载完成
      await waitForTabLoad(tab.id);
      
      // 等待一下让页面渲染完成
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 截取页面
      const screenshot = await capturePageScreenshot(tab.id);
      
      // 发送截图到导航页面
      try {
        await chrome.tabs.sendMessage(navTab.id, {
          action: 'addScreenshot',
          index: i,
          screenshot: screenshot,
          title: tab.title,
          url: tab.url,
          tabId: tab.id,
          total: resultTabs.length
        });
      } catch (e) {
        console.error('Error sending screenshot:', e);
      }
    }
    
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

// 截取页面截图
async function capturePageScreenshot(tabId) {
  try {
    // 确保标签页是活跃的
    await chrome.tabs.update(tabId, { active: true });
    
    // 等待更长时间让页面完全渲染
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('Capturing screenshot for tab:', tabId);
    
    // 尝试截图
    const screenshot = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: 100
    });
    
    console.log('Screenshot captured successfully');
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
