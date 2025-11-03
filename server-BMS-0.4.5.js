// ==============================================
// BBB-VideoStreamer v0.4.5 (iOS 圆角 UI 修复版)
// Author: Coderroring
// Features:
//  - v0.4.5: (UI 修复) 调整卡片宽度/边距，强制双列布局。
//          (UI 优化) 全面增加 border-radius 至 8px，模拟 iOS 圆角。
//  - v0.4.4: 修复 BILI_HEADERS 未定义的 bug
// ==============================================

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
// 确保 Node.js >= 18，否则需要安装并导入 node-fetch
// const fetch = require('node-fetch');

const app = express();
const port = 3000;

const cacheDir = path.join(__dirname, 'cache');
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);

// 状态: 'pending', 'completed', 'failed'
const cacheMap = new Map(); // videoId => { filePath, title, url, status }

// --- Utility: 注入 UTF-8 Meta ---
const injectUtf8Meta = (html) => {
    if (!html.includes('charset-UTF-8')) {
      return html.replace('<head>', '<head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">');
    }
    return html;
};

app.use(express.urlencoded({ extended: true }));

// --- (v0.4.5) 全局 CSS 样式表 (iOS 12 风格 + 修复) ---
const globalCSS = `
    body { 
        font-family: Arial, Helvetica, sans-serif;
        margin: 0; 
        padding: 0;
        background-color: #FFFFFF;
        color: #000000;
        -webkit-text-size-adjust: 100%;
    }
    a { 
        color: #007AFF; /* iOS 蓝色 */
        text-decoration: none; 
    }
    .header {
        background-color: #F8F8F8;
        border-bottom: 1px solid #C8C8C8;
        padding: 10px 8px;
        overflow: hidden;
    }
    .logo {
        font-size: 1.1em;
        font-weight: bold;
        color: #FF69B4;
        float: left;
        margin: 0;
    }
    .header-buttons { float: right; margin-top: 5px; }
    .header-buttons a { 
        font-size: small;
        border: 1px solid #007AFF;
        color: #007AFF;
        background-color: #FFFFFF;
        padding: 2px 5px; 
        margin-left: 5px; 
        border-radius: 8px; /* iOS 圆角 */
    }
    .categories {
        padding: 8px;
        background-color: #F8F8F8;
        border-bottom: 1px solid #E0E0E0;
    }
    .categories a { 
        margin-right: 5px; 
        font-size: 0.9em;
    }
    .timeline-link { font-size: 0.8em; color: #8E8E93; }

    /* 内容区域 */
    .content {
        padding: 8px;
    }
    h3 { 
        font-size: 1.0em; 
        font-weight: bold;
        margin-top: 10px; 
        margin-bottom: 5px;
    }
    hr { 
        border: 0;
        border-top: 1px solid #E0E0E0;
        margin: 10px 0;
    }
    
    /* v0.4.5 修复: 双列布局 */
    .video-grid::after { content: ""; display: table; clear: both; }
    .video-item {
        float: left; 
        width: 46%; /* 宽度减小 */
        margin: 2%; /* 边距增大 */
        box-sizing: border-box; 
        border: 1px solid #E0E0E0;
        border-radius: 8px; /* iOS 圆角 */
        padding: 5px; 
        height: 6.0em;
        overflow: hidden;
        background-color: #F8F8F8;
    }
    .video-link { color: #000000; }
    .video-title {
        font-size: 0.9em; 
        margin: 0; 
        line-height: 1.3;
        max-height: 3.9em; /* 3 行 */
        overflow: hidden;
        text-overflow: ellipsis; 
    }

    /* 按钮 (v0.4.5 圆角) */
    .button-primary {
        display: inline-block;
        font-size: 1.0em;
        font-weight: bold;
        padding: 8px 12px;
        border: 1px solid #007AFF;
        background-color: #007AFF;
        text-decoration: none;
        color: #FFFFFF;
        margin-top: 10px;
        margin-bottom: 10px;
        border-radius: 8px; /* iOS 圆角 */
    }
    .button-secondary {
        display: inline-block;
        font-size: 0.9em;
        padding: 5px 10px;
        border: 1px solid #007AFF;
        background-color: #FFFFFF;
        text-decoration: none;
        color: #007AFF;
        margin-top: 5px;
        border-radius: 8px; /* iOS 圆角 */
    }
    .button-danger {
        color: #FF3B30;
        border-color: #FF3B30;
    }

    /* 导航 (返回, 分页) */
    .nav-link { 
        display: inline-block; 
        margin-right: 10px; 
        font-size: 0.9em;
    }
    .pagination { margin-top: 10px; }
    .nav-bar {
        background-color: #F8F8F8;
        border-bottom: 1px solid #C8C8C8;
        padding: 8px;
    }
    
    /* 列表 (v0.4.5 圆角) */
    .list-view {
        list-style-type: none;
        padding-left: 0;
        margin: 0;
        border: 1px solid #E0E0E0;
        border-radius: 8px;
        overflow: hidden; /* 配合圆角 */
    }
    .list-view li {
        padding: 10px 8px;
        border-bottom: 1px solid #E0E0E0;
        font-size: 0.9em;
        background-color: #FFFFFF;
        overflow: hidden;
    }
    .list-view li:last-child {
        border-bottom: none; /* 列表最后一项无边框 */
    }
    .list-view li a {
        display: block;
        float: left;
    }
    .list-view li a.delete-link {
        color: #FF3B30;
        font-size: 0.9em;
        margin-left: 10px;
        float: right;
        padding: 2px 5px;
        border: 1px solid #FF3B30;
        border-radius: 8px; /* iOS 圆角 */
    }

    /* 表单 (v0.4.5 圆角) */
    input[type="text"] {
        width: 95%;
        padding: 8px;
        font-size: 0.9em;
        border: 1px solid #C8C8C8;
        border-radius: 8px; /* iOS 圆角 */
    }
    input[type="submit"] {
        display: inline-block;
        font-size: 1.0em;
        font-weight: bold;
        padding: 8px 12px;
        border: 1px solid #007AFF;
        background-color: #007AFF;
        text-decoration: none;
        color: #FFFFFF;
        margin-top: 10px;
        margin-bottom: 10px;
        border-radius: 8px; /* iOS 圆角 */
    }
    
    /* 详情页 (v0.4.5 圆角) */
    .video-meta { color: #8E8E93; font-size: 0.9em; }
    h2 { font-size: 1.1em; margin: 10px 0; }
    pre {
        white-space: pre-wrap; word-wrap: break-word; font-size: 0.9em;
        background-color: #F8F8F8;
        padding: 8px; /* 增加内边距 */
        margin: 5px 0; 
        border-radius: 8px; /* iOS 圆角 */
    }
    
    /* 状态页 */
    .status-message {
        padding: 20px 10px;
        text-align: center;
        font-size: 0.9em;
    }
`;

// --- (v0.4.4) 修复：重新添加 BILI_HEADERS 定义 ---
const BILI_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/5.3.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/5.3.36',
    'Referer': 'https://www.bilibili.com',
    // 在此处添加你的 Cookie (如果需要，特别是 PGC):
    // 'Cookie': 'SESSDATA=xxxxxxxxxx;' 
};


// --- API 调用函数 (保持不变) ---

// 1. 获取热门视频
async function getPopularVideos(pn = 1) {
    console.log(`[API] 获取热门视频... 第 ${pn} 页`);
    try {
        const response = await fetch(`https://api.bilibili.com/x/web-interface/popular?ps=20&pn=${pn}`, { headers: BILI_HEADERS });
        if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
        const data = await response.json();
        if (data.code !== 0) throw new Error(`Bilibili API 错误: ${data.message || data.code}`);
        console.log(`[API] 成功获取热门视频 (第 ${pn} 页)`);
        return data.data; 
    } catch (error) {
        console.error('[Error] 获取热门视频失败:', error.message);
        return { list: [], no_more: true };
    }
}

// 2. 获取UGC视频详情
async function getVideoDetails(id) {
     console.log(`[API] 获取UGC视频详情 (ID: ${id})...`);
     let aid = null, bvid = null;
     if (id.toLowerCase().startsWith('bv')) bvid = id;
     else if (id.toLowerCase().startsWith('av')) aid = id.substring(2);
     else if (!isNaN(parseInt(id))) aid = id;
     else bvid = id;
     
    try {
        const url = `https://api.bilibili.com/x/web-interface/view?${bvid ? 'bvid=' + bvid : 'aid=' + aid}`;
        const response = await fetch(url, { headers: BILI_HEADERS });
        if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
        const data = await response.json();
        if (data.code !== 0) throw new Error(`Bilibili API 错误: ${data.message || data.code}`);
        console.log(`[API] 成功获取UGC视频详情 (ID: ${id})`);
        return data.data;
    } catch (error) {
        console.error(`[Error] 获取UGC视频详情失败 (ID: ${id}):`, error.message);
        return null;
    }
}

// 3. 获取分区视频
async function getVideosByCategory(rid, pn = 1) {
    console.log(`[API] 获取分区视频 (RID: ${rid}, 页码: ${pn})...`);
    try {
        const url = `https://api.bilibili.com/x/web-interface/dynamic/region?rid=${rid}&pn=${pn}&ps=20`;
        const response = await fetch(url, { headers: BILI_HEADERS });
        if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
        const data = await response.json();
        if (data.code !== 0) throw new Error(`Bilibili API 错误: ${data.message || data.code}`);
        console.log(`[API] 成功获取分区视频 (RID: ${rid}, 页码: ${pn})`);
        return data.data; 
    } catch (error) {
         console.error(`[Error] 获取分区视频失败 (RID: ${rid}):`, error.message);
        return { archives: [], page: { count: 0 } };
    }
}

// 4. 搜索视频 (WBI 警告)
async function searchBilibili(keyword, pn = 1) {
    console.log(`[API] 搜索视频 (关键词: ${keyword}, 页码: ${pn})...`);
    try {
        const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}&page=${pn}`;
        const response = await fetch(url, { headers: BILI_HEADERS });
        if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
        const data = await response.json();
        if (data.code !== 0) throw new Error(`Bilibili API 错误 (WBI?): ${data.message || data.code}`);
        console.log(`[API] 成功获取搜索结果 (关键词: ${keyword})`);
        return data.data; 
    } catch (error) {
        console.error(`[Error] 搜索失败 (关键词: ${keyword}):`, error.message);
        return { result: [], numResults: 0, pages: 0 };
    }
}

// 5. 获取PGC (番剧) 详情
async function getPgcDetails(id) {
    console.log(`[API] 获取PGC详情 (ID: ${id})...`);
    let ep_id = null, season_id = null;
    if (id.toLowerCase().startsWith('ep')) ep_id = id.substring(2);
    else if (id.toLowerCase().startsWith('ss')) season_id = id.substring(2);
    else if (!isNaN(parseInt(id))) ep_id = id;
    else return null;

    try {
        const url = `https://api.bilibili.com/pgc/view/web/season?${ep_id ? 'ep_id=' + ep_id : 'season_id=' + season_id}`;
        const response = await fetch(url, { headers: BILI_HEADERS });
        if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
        const data = await response.json();
        if (data.code !== 0) throw new Error(`Bilibili PGC API 错误: ${data.message || data.code}`);
        console.log(`[API] 成功获取PGC详情 (ID: ${id})`);
        return data.result;
    } catch (error) {
        console.error(`[Error] 获取PGC详情失败 (ID: ${id}):`, error.message);
        return null;
    }
}

// 6. 获取PGC (番剧) 视频流
async function getPgcStreamUrl(cid, ep_id) {
    console.log(`[API] 获取PGC视频流 (EP: ${ep_id}, CID: ${cid})...`);
    try {
        const url = `https://api.bilibili.com/pgc/player/web/playurl?ep_id=${ep_id}&cid=${cid}&qn=16&fnval=0`;
        const response = await fetch(url, { headers: BILI_HEADERS });
        if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
        const data = await response.json();
        if (data.code !== 0) throw new Error(`Bilibili PGC Stream API 错误 (需要SESSDATA?): ${data.message || data.code}`);
        console.log(`[API] 成功获取PGC视频流 (EP: ${ep_id})`);
        return data.result;
    } catch (error) {
        console.error(`[Error] 获取PGC视频流失败 (EP: ${ep_id}):`, error.message);
        return null;
    }
}

// 7. 获取番剧时间线
async function getTimeline() {
    console.log(`[API] 获取番剧时间线...`);
    try {
        const url = `https://api.bilibili.com/pgc/web/timeline?types=1&before=3&after=3`;
        const response = await fetch(url, { headers: BILI_HEADERS });
        if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
        const data = await response.json();
        if (data.code !== 0) throw new Error(`Bilibili Timeline API 错误: ${data.message || data.code}`);
        console.log(`[API] 成功获取番剧时间线`);
        return data.result;
    } catch (error) {
        console.error('[Error] 获取番剧时间线失败:', error.message);
        return [];
    }
}


// --- Utility: 格式化时长函数 ---
function formatDuration(seconds) {
    if (isNaN(seconds) || seconds < 0) return '未知';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
}

// --- Utility: 渲染视频列表 ---
function renderVideoGrid(videoList) {
    let videoListHtml = '<div class="video-grid">';
    videoList.forEach((video) => {
         videoListHtml += `
            <div class="video-item">
                <a href="/details?id=${video.bvid}" class="video-link">
                     <p class="video-title">${video.title}</p>
                </a>
            </div>
        `;
    });
    videoListHtml += '</div>';
    return videoListHtml;
}


// --- 页面路由 ---

// ----------------------------------------------
// 主页路由 (v0.4.3 UI)
// ----------------------------------------------
app.get('/', async (req, res) => {
    const pn = parseInt(req.query.pn || '1', 10);
    const popularData = await getPopularVideos(pn);
    const popularVideos = popularData.list || [];
    
    let videoListHtml = '<p>无法加载热门视频或列表为空。</p>';
    if (popularVideos && popularVideos.length > 0) {
        videoListHtml = renderVideoGrid(popularVideos);
    }
    
    let paginationHtml = '<div class="pagination">';
    if (pn > 1) {
        paginationHtml += `<a href="/?pn=${pn - 1}" class="nav-link">上一页</a>`;
    }
    if (!popularData.no_more) {
        paginationHtml += `<a href="/?pn=${pn + 1}" class="nav-link" style="margin-left: 10px;">下一页</a>`;
    }
    paginationHtml += `<a href="/" class="nav-link" style="margin-left: 10px;">主页</a></div>`;

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>BBBili</title>
            <style>${globalCSS}</style>
        </head>
        <body>
            <div class="header">
                <a href="/"><h1 class="logo">BBBili</h1></a>
                <div class="header-buttons">
                    <a href="/search">搜索</a>
                    <a href="/url_input">URL</a>
                </div>
            </div>
            <div class="categories">
                <a href="/category?rid=13&name=番剧">番剧</a><a href="/timeline" class="timeline-link">[时间线]</a> |
                <a href="/category?rid=119&name=鬼畜">鬼畜</a> |
                <a href="/category?rid=188&name=科技">科技</a> |
                <a href="/category?rid=3&name=音乐">音乐</a> |
                <a href="/category?rid=211&name=美食">美食</a> |
                <a href="/categories">展开</a>
            </div>
            
            <div class="content">
                <h3>热门视频 (第 ${pn} 页)</h3>
                ${videoListHtml}
                ${paginationHtml}
                <hr>
                <a href="/list" class="nav-link">查看缓存</a>
            </div>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 分类详情页 (v0.4.3 UI)
// ----------------------------------------------
app.get('/category', async (req, res) => {
    const rid = req.query.rid;
    const name = req.query.name || '分类';
    const pn = parseInt(req.query.pn || '1', 10);

    if (!rid) {
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>缺少分区 ID (rid)。</body></html>'));
    }

    const categoryData = await getVideosByCategory(rid, pn);
    const categoryVideos = categoryData.archives || [];
    
    let videoListHtml = `<p>无法加载 ${name} 分区视频或列表为空。</p>`;
    if (categoryVideos && categoryVideos.length > 0) {
        videoListHtml = '<div class="video-grid">';
        categoryVideos.forEach((video) => {
            const id = video.bvid || `av${video.aid}`;
             videoListHtml += `
                <div class="video-item">
                    <a href="/details?id=${id}" class="video-link">
                         <p class="video-title">${video.title}</p>
                    </a>
                </div>
            `;
        });
        videoListHtml += '</div>';
    }
    
    const pageInfo = categoryData.page || { count: 0, num: pn, size: 20 };
    const totalPages = Math.ceil(pageInfo.count / pageInfo.size);
    
    let paginationHtml = '<div class="pagination">';
    if (pn > 1) {
        paginationHtml += `<a href="/category?rid=${rid}&name=${name}&pn=${pn - 1}" class="nav-link">上一页</a>`;
    }
    if (pn < totalPages) {
        paginationHtml += `<a href="/category?rid=${rid}&name=${name}&pn=${pn + 1}" class="nav-link" style="margin-left: 10px;">下一页</a>`;
    }
    paginationHtml += `<a href="/" class="nav-link" style="margin-left: 10px;">主页</a></div>`;

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>${name} - BBBili</title>
            <style>${globalCSS}</style>
        </head>
        <body>
            <div class="nav-bar">
                <a href="/" class="nav-link">← 返回主页</a>
            </div>
            
            <div class="content">
                <h3>${name} (第 ${pn} 页)</h3>
                ${videoListHtml}
                ${paginationHtml}
                <hr>
                <a href="/list" class="nav-link">查看缓存</a>
            </div>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 全部分区页 (v0.4.3 UI)
// ----------------------------------------------
app.get('/categories', (req, res) => {
    const zones = [
        { name: "动画", rid: 1 }, { name: "番剧", rid: 13 }, { name: "国创", rid: 167 },
        { name: "音乐", rid: 3 }, { name: "舞蹈", rid: 129 }, { name: "游戏", rid: 4 },
        { name: "知识", rid: 36 }, { name: "科技", rid: 188 }, { name: "运动", rid: 234 },
        { name: "汽车", rid: 223 }, { name: "生活", rid: 160 }, { name: "美食", rid: 211 },
        { name: "动物圈", rid: 217 }, { name: "鬼畜", rid: 119 }, { name: "时尚", rid: 155 },
        { name: "资讯", rid: 202 }, { name: "娱乐", rid: 5 }, { name: "影视", rid: 181 },
        { name: "纪录片", rid: 177 }, { name: "电影", rid: 23 }, { name: "电视剧", rid: 11 }
    ];

    let listHtml = '<ul class="list-view">';
    zones.forEach(zone => {
        listHtml += `<li><a href="/category?rid=${zone.rid}&name=${zone.name}">${zone.name}</a></li>`;
    });
    listHtml += '</ul>';

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>全部分区 - BBBili</title>
            <style>${globalCSS}</style>
        </head>
        <body>
            <div class="nav-bar">
                <a href="/" class="nav-link">← 返回主页</a>
            </div>
            <div class="content">
                <h3>全部分区</h3>
                ${listHtml}
            </div>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 番剧时间线 (v0.4.3 UI)
// ----------------------------------------------
app.get('/timeline', async (req, res) => {
    const timelineData = await getTimeline();
    let timelineHtml = '<p>番剧时间线加载失败，可能需要 SESSDATA Cookie。</p>';

    if (timelineData && timelineData.length > 0) {
        timelineHtml = '<ul class="list-view">';
        timelineData.forEach(day => {
            const isToday = day.is_today ? ' (今天)' : '';
            timelineHtml += `<li style="${day.is_today ? 'background-color: #f0f8ff;' : ''}">`;
            timelineHtml += `<h4 style="margin: 0 0 5px 0;">${day.date}${isToday} (星期${day.day_of_week})</h4>`;
            
            if (day.episodes && day.episodes.length > 0) {
                timelineHtml += '<ul style="list-style-type: circle; margin-left: 20px; padding-left: 0;">';
                day.episodes.forEach(ep => {
                    timelineHtml += `<li style="border: none; padding: 2px 0;">[${ep.pub_time}] <a href="/details_pgc?id=ss${ep.season_id}">${ep.title}</a> - ${ep.pub_index}</li>`;
                });
                timelineHtml += '</ul>';
            } else {
                timelineHtml += '<p style="font-size:small; margin: 5px 0 0 20px;">当日无更新。</p>';
            }
            timelineHtml += '</li>';
        });
        timelineHtml += '</ul>';
    }

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>番剧时间线 - BBBili</title>
            <style>${globalCSS}</style>
        </head>
        <body>
            <div class="nav-bar">
                <a href="/" class="nav-link">← 返回主页</a>
            </div>
            <div class="content">
                <h3>番剧时间线</h3>
                ${timelineHtml}
            </div>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});


// ----------------------------------------------
// URL 输入页 (v0.4.3 UI)
// ----------------------------------------------
app.get('/url_input', (req, res) => {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>ID 播放 - BBBili</title>
            <style>${globalCSS}</style>
        </head>
        <body>
            <div class="nav-bar">
                <a href="/" class="nav-link">← 返回主页</a>
            </div>
            <div class="content">
                <h3>通过 ID 播放</h3>
                <form action="/go" method="get">
                    <label>输入 BV / AV / EP / SS 号:</label><br>
                    <input type="text" name="id" size="60"><br><br>
                    <input type="submit" value="跳转到详情页">
                </form>
            </div>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 搜索输入页 (v0.4.3 UI)
// ----------------------------------------------
app.get('/search', (req, res) => {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>搜索 - BBBili</title>
            <style>${globalCSS}</style>
        </head>
        <body>
            <div class="nav-bar">
                <a href="/" class="nav-link">← 返回主页</a>
            </div>
            <div class="content">
                <h3>搜索视频</h3>
                <form action="/search_results" method="get">
                    <label>输入关键词:</label><br>
                    <input type="text" name="keyword" size="60"><br><br>
                    <input type="submit" value="搜索">
                </form>
            </div>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// ID 跳转路由 (v0.4.1)
// ----------------------------------------------
app.get('/go', (req, res) => {
    const id = (req.query.id || "").trim();
    if (!id) {
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>请输入ID。</body></html>'));
    }
    
    const id_lower = id.toLowerCase();
    
    if (id_lower.startsWith('ep') || id_lower.startsWith('ss')) {
        res.redirect(`/details_pgc?id=${id}`);
    } 
    else if (id_lower.startsWith('bv') || id_lower.startsWith('av') || !isNaN(parseInt(id))) {
        res.redirect(`/details?id=${id}`);
    } 
    else if (id.includes('bilibili.com')) {
        let videoId = null;
        const bvMatch = id.match(/(BV[a-zA-Z0-9]+)/i);
        const avMatch = id.match(/\/av([0-9]+)/i);
        const epMatch = id.match(/\/ep([0-9]+)/i);
        const ssMatch = id.match(/\/ss([0-9]+)/i);

        if (epMatch) {
            res.redirect(`/details_pgc?id=ep${epMatch[1]}`);
            return;
        }
        if (ssMatch) {
            res.redirect(`/details_pgc?id=ss${ssMatch[1]}`);
            return;
        }
        if (bvMatch) {
            res.redirect(`/details?id=${bvMatch[1]}`);
            return;
        }
        if (avMatch) {
            res.redirect(`/details?id=av${avMatch[1]}`);
            return;
        }
        
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>URL中未识别到AV/BV/EP/SS号。</body></html>'));
    }
    else {
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>无法识别的ID格式。</body></html>'));
    }
});


// ----------------------------------------------
// 搜索结果页 (v0.4.3 UI)
// ----------------------------------------------
app.get('/search_results', async (req, res) => {
    const keyword = req.query.keyword;
    const pn = parseInt(req.query.pn || '1', 10);
    
    if (!keyword) {
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>请输入关键词。</body></html>'));
    }

    const searchData = await searchBilibili(keyword, pn);
    const searchVideos = searchData.result || [];
    
    let videoListHtml = `<p>未找到关于 "${keyword}" 的视频，或 API 调用失败 (WBI 签名需要 Cookie)。</p>`;
    
    if (searchVideos && searchVideos.length > 0) {
        videoListHtml = '<div class="video-grid">';
        searchVideos.forEach((video) => {
            const cleanTitle = (video.title || '').replace(/<em class="keyword">/g, '').replace(/<\/em>/g, '');
             videoListHtml += `
                <div class="video-item">
                    <a href="/details?id=${video.bvid}" class="video-link">
                         <p class="video-title">${cleanTitle}</p>
                    </a>
                </div>
            `;
        });
        videoListHtml += '</div>';
    }
    
    const numPages = searchData.numPages || 0;
    
    let paginationHtml = '<div class="pagination">';
    if (pn > 1) {
        paginationHtml += `<a href="/search_results?keyword=${keyword}&pn=${pn - 1}" class="nav-link">上一页</a>`;
    }
    if (pn < numPages) {
        paginationHtml += `<a href="/search_results?keyword=${keyword}&pn=${pn + 1}" class="nav-link" style="margin-left: 10px;">下一页</a>`;
    }
    paginationHtml += `<a href="/" class="nav-link" style="margin-left: 10px;">主页</a></div>`;

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>搜索: ${keyword} - BBBili</title>
            <style>${globalCSS}</style>
        </head>
        <body>
            <div class="nav-bar">
                <a href="/" class="nav-link">← 返回主页</a>
            </div>
            <div class="content">
                <h3>搜索 "${keyword}" (第 ${pn} 页)</h3>
                ${videoListHtml}
                ${paginationHtml}
                <hr>
                <a href="/list" class="nav-link">查看缓存</a>
            </div>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// UGC 视频详情页 (v0.4.3 UI)
// ----------------------------------------------
app.get('/details', async (req, res) => {
    const id = req.query.id;
    if (!id) {
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>缺少 ID 参数。</body></html>'));
    }

    const details = await getVideoDetails(id); 

    if (!details) {
         return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>无法加载视频详情。可能是 API 问题或视频不存在。</body></html>'));
    }

    const originalUrl = `https://www.bilibili.com/video/${details.bvid}/`;
    const durationFormatted = formatDuration(details.duration);
    const description = details.desc || '无简介';
    const stat = details.stat || {};
    const owner = details.owner || { name: '未知UP主' };
    const pages = details.pages || [{ cid: details.cid, part: 'P1', page: 1 }];

    let pageHtml = '<h4>分P列表:</h4><ul class="list-view">';
    pages.forEach(p => {
        pageHtml += `
            <li style="margin-bottom: 5px;">
                ${p.part} (P${p.page})
                <a href="/download_task?bvid=${details.bvid}&cid=${p.cid}&title=${encodeURIComponent(details.title + ' - ' + p.part)}&type=ugc&page=${p.page}" 
                   class="button-secondary" style="float: right; padding: 2px 5px; margin: 0;">
                   播放/转码
                </a>
            </li>
        `;
    });
    pageHtml += '</ul>';

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>${details.title || '视频详情'} - BBBili</title>
            <style>${globalCSS}</style>
        </head>
        <body>
            <div class="nav-bar">
                <a href="/" class="nav-link">← 主页</a> | <a href="javascript:history.back();" class="nav-link">← 返回</a>
            </div>
            <div class="content">
                <h2>${details.title}</h2>
                <p class="video-meta">UP主: ${owner.name}</p>
                <p class="video-meta">BVID: ${details.bvid} / AVID: ${details.aid}</p>
                <p>播放: ${stat.view || '未知'} | 点赞: ${stat.like || '未知'} | 投币: ${stat.coin || '未知'} | 时长: ${durationFormatted}</p>
                <hr>
                <h3>简介:</h3>
                <pre>${description}</pre>
                <hr>
                ${pageHtml}
                <hr>
                <p>分享链接: <a href="${originalUrl}">原始视频地址</a></p>
                <a href="/list" class="nav-link">查看缓存</a>
            </div>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// PGC (番剧) 详情页 (v0.4.3 UI)
// ----------------------------------------------
app.get('/details_pgc', async (req, res) => {
    const id = req.query.id;
    if (!id) {
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>缺少 ID (EP/SS) 参数。</body></html>'));
    }

    const details = await getPgcDetails(id); 

    if (!details) {
         return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>无法加载番剧详情。可能是 API 问题、需要 Cookie 或 ID 错误。</body></html>'));
    }

    const originalUrl = details.share_url || `https://www.bilibili.com/bangumi/play/${details.season_id ? 'ss' + details.season_id : 'ep' + (details.ep_id || id)}`;
    const description = details.evaluate || '无简介';
    const stat = details.stat || {};
    const episodes = details.episodes || [];
    const sections = details.section || [];

    let pageHtml = '<h4>正片:</h4><ul class="list-view">';
    episodes.forEach(ep => {
        pageHtml += `
            <li style="margin-bottom: 5px;">
                ${ep.long_title}
                <a href="/download_task?ep_id=${ep.id}&cid=${ep.cid}&aid=${ep.aid}&title=${encodeURIComponent(details.title + ' - ' + ep.long_title)}&type=pgc" 
                   class="button-secondary" style="float: right; padding: 2px 5px; margin: 0;">
                   播放/转码
                </a>
            </li>
        `;
    });
    pageHtml += '</ul>';
    
    sections.forEach(sec => {
        pageHtml += `<h4 style="margin-top: 10px;">${sec.title || '其它'}:</h4><ul class="list-view">`;
        (sec.episodes || []).forEach(ep => {
            pageHtml += `
            <li style="margin-bottom: 5px;">
                ${ep.long_title}
                <a href="/download_task?ep_id=${ep.id}&cid=${ep.cid}&aid=${ep.aid}&title=${encodeURIComponent(details.title + ' - ' + ep.long_title)}&type=pgc" 
                   class="button-secondary" style="float: right; padding: 2px 5px; margin: 0;">
                   播放/转码
                </a>
            </li>
        `;
        });
        pageHtml += '</ul>';
    });


    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>${details.title || '番剧详情'} - BBBili</title>
            <style>${globalCSS}</style>
        </head>
        <body>
            <div class="nav-bar">
                <a href="/" class="nav-link">← 主页</a> | <a href="javascript:history.back();" class="nav-link">← 返回</a>
            </div>
            <div class="content">
                <h2>${details.title} (${details.season_title || ''})</h2>
                <p class="video-meta">SSID: ${details.season_id} / MDID: ${details.media_id}</p>
                <p>播放: ${stat.views || '未知'} | 点赞: ${stat.likes || '未知'} | 投币: ${stat.coins || '未知'}</p>
                <hr>
                <h3>简介:</h3>
                <pre>${description}</pre>
                <hr>
                ${pageHtml}
                <hr>
                <p>分享链接: <a href="${originalUrl}">原始视频地址</a></p>
                <a href="/list" class="nav-link">查看缓存</a>
            </div>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});


// ----------------------------------------------
// 核心下载/转码路由 (v0.4.2 修复)
// ----------------------------------------------
app.get('/download_task', async (req, res) => {
    // type=ugc 或 type=pgc
    const { bvid, aid, cid, title, ep_id, type, page } = req.query;

    if (!cid || !title || !type) {
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>参数不足 (cid, title, type)。</body></html>'));
    }

    const uniqueId = (type === 'pgc') ? `ep${ep_id}` : (bvid || `av${aid}`);
    const cacheId = `${uniqueId}_${cid}`; 
    const videoId = crypto.createHash('md5').update(cacheId).digest('hex');
    
    const finalPathCheck = path.join(cacheDir, `${videoId}_final.mp4`);
    const cacheEntry = cacheMap.get(videoId);

    // 检查缓存
    if (cacheEntry && cacheEntry.status === 'completed' && fs.existsSync(finalPathCheck)) {
        console.log(`[Cache] 命中 (状态已完成): ${title}`);
        return res.redirect(`/watch?file=${path.basename(finalPathCheck)}`);
    }
    if (cacheEntry && cacheEntry.status === 'pending') {
        console.log(`[Cache] 命中 (任务正在运行): ${title}`);
        return res.redirect(`/status?id=${videoId}&title=${encodeURIComponent(title)}&origUrl=/`);
    }
    if(cacheMap.has(videoId)) {
        cacheMap.delete(videoId);
    }

    // --- 任务开始 ---
    cacheMap.set(videoId, { title: title, url: (bvid || ep_id), status: 'pending' });
    console.log(`[Job] 启动新任务 (${type}) 并设置状态为 pending: ${videoId}`);
    
    // 立即发送处理中页面 (v0.4.3 UI)
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>处理中</title>
            <style>${globalCSS}</style>
            <meta http-equiv="refresh" content="3;url=/status?id=${videoId}&title=${encodeURIComponent(title)}&origUrl=/">
        </head>
        <body>
            <div class="nav-bar">
                <a href="/" class="nav-link">← 返回主页</a>
            </div>
            <div class="content status-message">
                <p>[服务器] 正在处理您的请求...</p>
                <p>${title}</p>
                <p>请稍候，页面将自动刷新。</p>
            </div>
        </body>
        </html>
    `);

    // --- 后台处理 ---
    const outputPathRaw = path.join(cacheDir, `${videoId}_raw.part`);
    const outputPathFinal = finalPathCheck;
    
    if (type === 'ugc') {
        // --- UGC (普通视频) 逻辑 (v0.4.2 修复) ---
        let videoUrl = `https://www.bilibili.com/video/${bvid || 'av' + aid}`;
        if (page && parseInt(page, 10) > 1) {
            videoUrl += `?p=${page}`;
        }
        
        const ytArgs = [
            '-f', 'bv[height<=360][ext=mp4]+ba[ext=m4a]/b[height<=360][ext=mp4]/bv[height<=360]+ba/b[height<=360]',
            '--no-playlist',
            '-o', outputPathRaw,
            '--socket-timeout', '30',
            '--retries', '5',
            videoUrl 
        ];
        console.log(`[Download UGC] yt-dlp ${ytArgs.join(' ')}`);
        runYtdlp(ytArgs, videoId, title, outputPathRaw, outputPathFinal);

    } else if (type === 'pgc') {
        // --- PGC (番剧) 逻辑 ---
        console.log(`[Download PGC] 启动 PGC 转码 (EP: ${ep_id}, CID: ${cid})`);
        runPgcFfmpeg(cid, ep_id, videoId, title, outputPathRaw, outputPathFinal);
    }
});

// ----------------------------------------------
// UGC (yt-dlp) 转码执行器 (v0.4.2)
// ----------------------------------------------
function runYtdlp(ytArgs, videoId, title, outputPathRaw, outputPathFinal) {
    const ytdlp = spawn('yt-dlp', ytArgs);
    ytdlp.stdout.on('data', d => { process.stdout.write(d.toString()); });
    ytdlp.stderr.on('data', d => { process.stderr.write(d.toString()); });

    ytdlp.on('close', code => {
        if (code !== 0) {
            console.error(`[Error] yt-dlp 退出，代码: ${code}`);
            if (fs.existsSync(outputPathRaw)) fs.unlinkSync(outputPathRaw);
            cacheMap.set(videoId, { ...cacheMap.get(videoId), status: 'failed', error: `yt-dlp exited with code ${code}` });
            return;
        }

        const downloadedFilePath = path.join(cacheDir, `${videoId}_raw.mp4`);
        let sourcePath = outputPathRaw; 

        if (!fs.existsSync(sourcePath)) {
            const finalMergedPath = path.join(cacheDir, `${videoId}_raw.part.mp4`);
            if (fs.existsSync(finalMergedPath)) sourcePath = finalMergedPath;
            else if (fs.existsSync(downloadedFilePath)) sourcePath = downloadedFilePath;
            else {
                 console.error(`[Error] yt-dlp 退出代码 0，但未找到原始文件。`);
                 cacheMap.set(videoId, { ...cacheMap.get(videoId), status: 'failed', error: 'yt-dlp完成但找不到文件' });
                 return;
            }
        }
        
        let downloadedFilePathForFFmpeg = downloadedFilePath;

        if (sourcePath !== downloadedFilePath) {
            try {
                fs.renameSync(sourcePath, downloadedFilePath); 
                console.log(`[Download] 原始文件下载完成并手动重命名: ${downloadedFilePath}`);
                downloadedFilePathForFFmpeg = downloadedFilePath;
            } catch (renameErr) {
                 console.error(`[Error] 重命名原始文件失败: ${renameErr.message}`);
                 if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath); 
                 cacheMap.set(videoId, { ...cacheMap.get(videoId), status: 'failed', error: '重命名原始文件失败' });
                 return;
            }
        } else {
            downloadedFilePathForFFmpeg = downloadedFilePath;
        }
        runFfmpeg(downloadedFilePathForFFmpeg, outputPathFinal, videoId, title);
    });

    ytdlp.on('error', (err) => {
        console.error('[Error] 无法启动 yt-dlp:', err.message);
         if (fs.existsSync(outputPathRaw)) fs.unlinkSync(outputPathRaw);
         cacheMap.set(videoId, { ...cacheMap.get(videoId), status: 'failed', error: 'Failed to start yt-dlp' });
    });
}

// ----------------------------------------------
// PGC (ffmpeg) 转码执行器 (v0.4.1)
// ----------------------------------------------
async function runPgcFfmpeg(cid, ep_id, videoId, title, outputPathRaw, outputPathFinal) {
    const streamData = await getPgcStreamUrl(cid, ep_id);
    if (!streamData) {
        console.error(`[Error PGC] 无法获取视频流 (EP: ${ep_id})。可能需要 SESSDATA Cookie。`);
        cacheMap.set(videoId, { ...cacheMap.get(videoId), status: 'failed', error: '无法获取PGC流(需Cookie?)' });
        return;
    }
    let ffmpegArgs;
    let inputSource = outputPathRaw; 

    if (streamData.dash && streamData.dash.video && streamData.dash.audio) {
        const videoUrl = streamData.dash.video[0].baseUrl || streamData.dash.video[0].base_url;
        const audioUrl = streamData.dash.audio[0].baseUrl || streamData.dash.audio[0].base_url;
        console.log(`[PGC] 检测到 DASH 流。`);
        ffmpegArgs = [
            '-i', videoUrl, '-i', audioUrl,
            '-vf', "scale='if(gt(a,320/240),320,-2)':'if(gt(a,320/240),-2,240)',pad=320:240:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p",
            '-vcodec', 'libx264', '-profile:v', 'baseline', '-level', '3.0',
            '-preset', 'veryfast', '-crf', '28',
            '-acodec', 'aac', '-ar', '44100', '-b:a', '96k',
            '-movflags', '+faststart', '-y',
            outputPathFinal
        ];
        inputSource = null;
    } else if (streamData.durl && streamData.durl.length > 0) {
        const streamUrl = streamData.durl[0].url;
        console.log(`[PGC] 检测到 DURL (FLV/MP4) 流...`);
        ffmpegArgs = [
            '-i', streamUrl,
            '-vf', "scale='if(gt(a,320/240),320,-2)':'if(gt(a,320/240),-2,240)',pad=320:240:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p",
            '-vcodec', 'libx264', '-profile:v', 'baseline', '-level', '3.0',
            '-preset', 'veryfast', '-crf', '28',
            '-acodec', 'aac', '-ar', '44100', '-b:a', '96k',
            '-movflags', '+faststart', '-y',
            outputPathFinal
        ];
        inputSource = null;
    } else {
        console.error(`[Error PGC] 未能在API响应中找到 durl 或 dash 流。`);
        cacheMap.set(videoId, { ...cacheMap.get(videoId), status: 'failed', error: '未找到PGC流(durl/dash)' });
        return;
    }
    runFfmpeg(inputSource, outputPathFinal, videoId, title, ffmpegArgs);
}


// ----------------------------------------------
// 通用 FFmpeg 执行器
// ----------------------------------------------
function runFfmpeg(inputSource, outputPathFinal, videoId, title, customFfmpegArgs = null) {
    let ffmpegArgs = customFfmpegArgs;
    if (!ffmpegArgs) {
        ffmpegArgs = [
            '-i', inputSource,
            '-vf', "scale='if(gt(a,320/240),320,-2)':'if(gt(a,320/240),-2,240)',pad=320:240:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p",
            '-vcodec', 'libx264', '-profile:v', 'baseline', '-level', '3.0',
            '-preset', 'veryfast', '-crf', '28',
            '-acodec', 'aac', '-ar', '44100', '-b:a', '96k',
            '-movflags', '+faststart', '-y',
            outputPathFinal
        ];
    }
    
    console.log(`[FFmpeg] 开始转码 -> ${outputPathFinal}`);
    
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    ffmpeg.stdout.on('data', d => { process.stdout.write(d.toString()); });
    ffmpeg.stderr.on('data', d => { process.stderr.write(d.toString()); });

    ffmpeg.on('close', c => {
        if (inputSource && fs.existsSync(inputSource)) {
            try {
                fs.unlinkSync(inputSource);
                console.log(`[Cleanup] 删除了原始文件: ${inputSource}`);
            } catch (unlinkErr) {
                console.error(`[Error] 删除原始文件时出错: ${unlinkErr.message}`);
            }
        }
        if (c === 0) {
            cacheMap.set(videoId, { ...cacheMap.get(videoId), filePath: outputPathFinal, status: 'completed' });
            console.log(`[Cache] 添加转码文件到缓存并设置状态为 completed: ${outputPathFinal}`);
        } else {
            console.error(`[Error] ffmpeg 退出，代码: ${c}`);
            if (fs.existsSync(outputPathFinal)) {
                try { fs.unlinkSync(outputPathFinal); } catch (e) {}
            }
            cacheMap.set(videoId, { ...cacheMap.get(videoId), status: 'failed', error: `ffmpeg exited with code ${c}` });
        }
    });

     ffmpeg.on('error', (err) => {
        console.error('[Error] 无法启动 ffmpeg:', err.message);
         if (inputSource && fs.existsSync(inputSource)) fs.unlinkSync(inputSource);
         cacheMap.set(videoId, { ...cacheMap.get(videoId), status: 'failed', error: 'Failed to start ffmpeg' });
     });
}


// ----------------------------------------------
// Status Page (v0.4.3 UI)
// ----------------------------------------------
app.get('/status', (req, res) => {
    const videoId = req.query.id;
    const title = req.query.title || '视频';
    const origUrl = req.query.origUrl || '/';

    const cacheEntry = cacheMap.get(videoId);
    const finalPath = path.join(cacheDir, `${videoId}_final.mp4`);
    const fileExists = fs.existsSync(finalPath);

    let htmlBody = '';

    if (cacheEntry && cacheEntry.status === 'completed') {
        if (fileExists) {
             return res.redirect(`/watch?file=${path.basename(finalPath)}`);
        } else {
            console.log(`[Status Error] 缓存映射显示完成，但文件丢失。清理映射: ${videoId}`);
            cacheMap.delete(videoId); 
            htmlBody = `<div class="content status-message"><p>错误：缓存文件丢失，请重试。</p><p><a href="/" class="button-secondary">返回主页</a></p></div>`;
        }
    } 
    else if (!cacheEntry && fileExists) {
        console.log(`[Status] 文件存在但映射丢失 (可能服务器重启)，重建映射并尝试播放: ${videoId}`);
        const tempTitle = title || path.basename(finalPath);
        cacheMap.set(videoId, { filePath: finalPath, title: tempTitle, url: origUrl, status: 'completed' });
        return res.redirect(`/watch?file=${path.basename(finalPath)}`);
    }
    else if (cacheEntry && cacheEntry.status === 'failed') {
        htmlBody = `
            <div class="content status-message">
                <p>[服务器] 处理视频 "${title}" 时遇到错误。</p>
                <p>错误信息: ${cacheEntry.error || '未知错误'}</p>
                <p><a href="/" class="button-secondary">返回主页</a></p>
            </div>
        `;
    } 
    else {
        htmlBody = `
            <div class="content status-message">
                <p>[服务器] 视频 "${title}" 仍在处理中...</p>
                <p>请稍候，页面将自动刷新。</p>
                <meta http-equiv="refresh" content="3;url=/status?id=${videoId}&title=${encodeURIComponent(title)}&origUrl=${encodeURIComponent(origUrl)}">
            </div>
        `;
    }
    
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>状态 - BBBili</title>
             <style>${globalCSS}</style>
        </head>
        <body>
            <div class="nav-bar">
                <a href="/" class="nav-link">← 返回主页</a>
            </div>
            ${htmlBody}
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});


// ----------------------------------------------
// Watch Page (v0.4.3 UI)
// ----------------------------------------------
app.get('/watch', (req, res) => {
    const file = req.query.file;
    if (!file || !file.endsWith('_final.mp4')) {
         return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>无效的文件名。</body></html>'));
    }
    const safeFile = path.basename(file);
    const filePath = path.join(cacheDir, safeFile);

    if (!fs.existsSync(filePath)) {
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>缓存的视频文件未找到，可能已被清理。</body></html>'));
    }

    const videoId = safeFile.replace('_final.mp4', '');
    const cacheEntry = cacheMap.get(videoId);
    const videoTitle = cacheEntry ? cacheEntry.title : safeFile.replace(/^[a-f0-9]+_/, '').replace('_final.mp4', '');

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>播放准备就绪</title>
            <style>${globalCSS}</style>
        </head>
        <body>
            <div class="nav-bar">
                <a href="/list" class="nav-link">← 缓存列表</a> | <a href="/" class="nav-link">← 主页</a>
            </div>
            <div class="content">
                <h3>准备播放:</h3>
                <p>${videoTitle}</p>
                <a href="/stream/${safeFile}" class="button-primary">▶ 在播放器中播放</a>
            </div>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 缓存列表 (v0.4.3 UI)
// ----------------------------------------------
app.get('/list', (req, res) => {
    let listHtml = '';
    
    const filesInDir = fs.readdirSync(cacheDir).filter(f => f.endsWith('_final.mp4'));

    if (filesInDir.length > 0) {
         listHtml = '<ul class="list-view">';
         filesInDir.forEach(f => {
            const videoId = f.replace('_final.mp4', '');
            let cacheEntry = cacheMap.get(videoId);
            
            if (!cacheEntry) {
                 const defaultTitle = decodeURIComponent(f.replace(/^[a-f0-9]+_/, '').replace('_final.mp4', '')) || f;
                 cacheMap.set(videoId, { 
                     filePath: path.join(cacheDir, f), 
                     title: defaultTitle, 
                     url: "#", 
                     status: 'completed' 
                 });
                 cacheEntry = cacheMap.get(videoId);
            }
            
            listHtml += `
                <li>
                    <a href="/delete_one?file=${f}" class="delete-link">[删除]</a>
                    <a href="/watch?file=${f}">${cacheEntry.title}</a>
                </li>
            `;
         });
         listHtml += '</ul>';
    }

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>缓存视频</title>
            <style>${globalCSS}</style>
        </head>
        <body>
            <div class="nav-bar">
                <a href="/" class="nav-link">← 返回主页</a>
            </div>
            <div class="content">
                <h3>已缓存视频</h3>
                ${listHtml || '<ul><li style="border-bottom: none;">暂无有效缓存视频。</li></ul>'}
                <hr>
                <a href="/confirm_clear" class="button-secondary button-danger">清理所有缓存</a>
            </div>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 单个删除
// ----------------------------------------------
app.get('/delete_one', (req, res) => {
    const file = req.query.file;
    if (!file) {
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>缺少文件名。</body></html>'));
    }
    
    const safeFile = path.basename(file);
    if (!safeFile.endsWith('_final.mp4')) {
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>无效的文件。</body></html>'));
    }

    const filePath = path.join(cacheDir, safeFile);
    const videoId = safeFile.replace('_final.mp4', '');

    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            cacheMap.delete(videoId);
            console.log(`[Cache] 已删除单个文件: ${safeFile}`);
            res.redirect('/list');
        } else {
            return res.send(injectUtf8Meta(`<html><head><title>错误</title></head><body>文件 ${safeFile} 未找到。</body></html>`));
        }
    } catch (err) {
        console.error(`[Error] 删除文件 ${safeFile} 失败:`, err.message);
        return res.send(injectUtf8Meta(`<html><head><title>错误</title></head><body>删除文件失败: ${err.message}</body></html>`));
    }
});


// ----------------------------------------------
// 确认清理全部 (v0.4.3 UI)
// ----------------------------------------------
app.get('/confirm_clear', (req, res) => {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>确认清理</title>
             <style>${globalCSS}</style>
        </head>
        <body>
            <div class="nav-bar">
                <a href="/list" class="nav-link">← 返回缓存列表</a>
            </div>
            <div class="content" style="text-align: center;">
                <h3>确认清理缓存?</h3>
                <p>这将永久删除所有已下载和转码的视频文件。</p>
                <a href="/clear_cache" class="button-primary button-danger" style="margin-right: 10px;">是, 清理</a>
                <a href="/list" class="button-secondary">取消</a>
            </div>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 清理全部 (v0.4.3 UI)
// ----------------------------------------------
app.get('/clear_cache', (req, res) => {
     let clearedCount = 0;
     let errorCount = 0;
    try {
        const files = fs.readdirSync(cacheDir);
        files.forEach(f => {
            const p = path.join(cacheDir, f);
            if (p.endsWith('.mp4') || p.endsWith('.part')) {
                try {
                    fs.unlinkSync(p);
                    clearedCount++;
                    console.log(`[ClearCache] Deleted: ${f}`);
                } catch (unlinkErr) {
                    errorCount++;
                    console.error(`[ClearCache] Error deleting ${f}: ${unlinkErr.message}`);
                }
            }
        });
        cacheMap.clear();
        console.log(`[ClearCache] Cache map cleared.`);
    } catch (readErr) {
        console.error(`[ClearCache] Error reading cache directory: ${readErr.message}`);
         return res.status(500).send(injectUtf8Meta('<html><head><title>错误</title></head><body>读取缓存目录时出错。</body></html>'));
    }

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
             <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>缓存已清理</title>
             <style>${globalCSS}</style>
        </head>
        <body>
            <div class="nav-bar">
                <a href="/" class="nav-link">← 返回主页</a>
            </div>
            <div class="content status-message">
                <h3>缓存已清理</h3>
                <p>删除了 ${clearedCount} 个文件。</p>
                ${errorCount > 0 ? `<p style="color: #FF3B30;">删除过程中遇到 ${errorCount} 个错误。</p>` : ''}
                <a href="/" class="button-primary" style="margin-top: 10px;">返回主页</a>
            </div>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 视频流
// ----------------------------------------------
app.get('/stream/:filename', (req, res) => {
    const filename = req.params.filename;
    const safeFile = path.basename(filename);
    if (!safeFile || safeFile.includes('..') || !safeFile.endsWith('_final.mp4')) {
        return res.status(400).send('Invalid filename');
    }

    const filePath = path.join(cacheDir, safeFile);

    fs.stat(filePath, (err, stats) => {
        if (err) {
            if (err.code === 'ENOENT') {
                 console.error(`[Stream] 文件未找到: ${filePath}`);
                return res.status(404).send('Not Found');
            }
            console.error(`[Stream] 获取文件状态错误: ${err.message}`);
            return res.status(500).send('Internal Server Error');
        }

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Accept-Ranges', 'bytes');

        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
            const chunksize = (end - start) + 1;

             if (start >= stats.size || end >= stats.size) {
                 res.status(416).send('Requested range not satisfiable');
                 return;
             }

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${stats.size}`,
                'Content-Length': chunksize,
            });
            fs.createReadStream(filePath, { start, end }).pipe(res);
            console.log(`[Stream] 发送 Range: ${start}-${end}/${stats.size} for ${safeFile}`);
        } else {
             console.log(`[Stream] 发送完整文件: ${safeFile} (${stats.size} bytes)`);
            fs.createReadStream(filePath).pipe(res);
        }
    });
});

// ----------------------------------------------
// 服务器启动
// ----------------------------------------------
app.listen(port, '0.0.0.0', () => {
    const networkInterfaces = require('os').networkInterfaces();
    let localIp = '127.0.0.1';
    for (const name of Object.keys(networkInterfaces)) {
        for (const net of networkInterfaces[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                localIp = net.address;
                break;
            }
        }
        if (localIp !== '127.0.0.1') break;
    }

    console.log(`=======================================================`);
    console.log(`  BBB-VideoStreamer v0.4.4 (BILI_HEADERS 修复版)`);
    console.log(`  服务器正在运行!`);
    console.log(`  请在黑莓浏览器中访问: http://${localIp}:${port}`);
    console.log(`=======================================================`);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] 未捕获的异常:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] 未处理的 Promise Rejection:', promise, '原因:', reason);
});
