// ==============================================
// BBB-VideoStreamer v0.4.0 (Bilibili 镜像前端)
// Author: Coderroring
// Features:
//  - v0.4.0: 添加了功能性分类导航, 分页, 搜索/URL输入页面, 详情页增强
//  - BlackBerry 9900 优化 (UI 调整为紧凑双列，标题美化)
//  - 优化视频状态检测速度 (3秒刷新)
//  - 修复多P视频下载后的文件重命名问题
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

// 状态现在可以为 'pending', 'completed', 'failed'
const cacheMap = new Map(); // videoId => { filePath, title, url, status }

// --- Utility: 注入 UTF-8 Meta (用于旧路由兼容) ---
const injectUtf8Meta = (html) => {
    if (!html.includes('charset=UTF-8')) {
      return html.replace('<head>', '<head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">');
    }
    return html;
};

app.use(express.urlencoded({ extended: true }));

// --- API 调用函数 (v0.4.0 新增) ---

// 1. 获取热门视频 (支持分页)
async function getPopularVideos(pn = 1) {
    console.log(`[API] 获取热门视频... 第 ${pn} 页`);
    try {
        // 使用 popular.md API
        const response = await fetch(`https://api.bilibili.com/x/web-interface/popular?ps=20&pn=${pn}`, {
             headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
        const data = await response.json();
        if (data.code !== 0) throw new Error(`Bilibili API 错误: ${data.message || data.code}`);
        console.log(`[API] 成功获取热门视频 (第 ${pn} 页)`);
        return data.data; // 返回包含 list 和 no_more 的 data 对象
    } catch (error) {
        console.error('[Error] 获取热门视频失败:', error.message);
        return { list: [], no_more: true }; // 返回空结构
    }
}

// 2. 获取视频详情 (复用)
async function getVideoDetails(bvid) {
     console.log(`[API] 获取视频详情 (BVID: ${bvid})...`);
    try {
        // 使用 info.md API
        const url = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
         const response = await fetch(url, {
             headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
        const data = await response.json();
         if (data.code !== 0) throw new Error(`Bilibili API 错误: ${data.message || data.code}`);
         console.log(`[API] 成功获取视频详情 (BVID: ${bvid})`);
        return data.data;
    } catch (error) {
        console.error(`[Error] 获取视频详情失败 (BVID: ${bvid}):`, error.message);
        return null;
    }
}

// 3. 获取分区视频 (v0.4.0 新增)
async function getVideosByCategory(rid, pn = 1) {
    console.log(`[API] 获取分区视频 (RID: ${rid}, 页码: ${pn})...`);
    try {
        // 使用 dynamic.md API
        const url = `https://api.bilibili.com/x/web-interface/dynamic/region?rid=${rid}&pn=${pn}&ps=20`;
        const response = await fetch(url, {
             headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
        const data = await response.json();
        if (data.code !== 0) throw new Error(`Bilibili API 错误: ${data.message || data.code}`);
        console.log(`[API] 成功获取分区视频 (RID: ${rid}, 页码: ${pn})`);
        return data.data; // 返回包含 archives 和 page 的 data 对象
    } catch (error) {
         console.error(`[Error] 获取分区视频失败 (RID: ${rid}):`, error.message);
        return { archives: [], page: { count: 0 } }; // 返回空结构
    }
}

// 4. 搜索视频 (v0.4.0 新增 - 警告: WBI)
async function searchBilibili(keyword, pn = 1) {
    console.log(`[API] 搜索视频 (关键词: ${keyword}, 页码: ${pn})...`);
    try {
        // 使用 search_request.md API (Web 端分类搜索)
        const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}&page=${pn}`;
        // 注意：此 API 在文档中注明需要 WBI 签名。如果 B站 强制执行，此调用可能会失败 (返回 -412)。
        // 我们暂时尝试不带 WBI 签名调用。
        const response = await fetch(url, {
             headers: { 
                 'User-Agent': 'Mozilla/5.0',
                 'Referer': 'https://www.bilibili.com' // 尝试添加 Referer
             }
        });
        if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
        const data = await response.json();
        if (data.code !== 0) throw new Error(`Bilibili API 错误 (可能需要WBI签名): ${data.message || data.code}`);
        console.log(`[API] 成功获取搜索结果 (关键词: ${keyword})`);
        return data.data; // 返回 data 对象
    } catch (error) {
        console.error(`[Error] 搜索失败 (关键词: ${keyword}):`, error.message);
        return { result: [], numResults: 0, pages: 0 }; // 返回空结构
    }
}

// --- Utility: 格式化时长函数 ---
function formatDuration(seconds) {
    if (isNaN(seconds) || seconds < 0) return '未知';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
}

// --- Utility: 渲染视频列表 (v0.4.0 新增) ---
// (此函数用于统一渲染 / 和 /category 页面)
function renderVideoGrid(videoList) {
    let videoListHtml = '<div class="video-grid">';
    videoList.forEach((video) => {
         videoListHtml += `
            <div class="video-item">
                <a href="/details?bvid=${video.bvid}" class="video-link">
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
// 主页路由 (v0.4.0 修改: 支持分页, 新增UI)
// ----------------------------------------------
app.get('/', async (req, res) => {
    const pn = parseInt(req.query.pn || '1', 10);
    const popularData = await getPopularVideos(pn); //
    const popularVideos = popularData.list || [];
    
    let videoListHtml = '<p>无法加载热门视频或列表为空。</p>';
    if (popularVideos && popularVideos.length > 0) {
        videoListHtml = renderVideoGrid(popularVideos);
    }
    
    // 分页 HTML
    let paginationHtml = '<div class_="pagination">';
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
            <title>黑莓哔哩哔哩</title>
            <style>
                body { font-family: monospace; margin: 5px; }
                a { color: #0000EE; text-decoration: none; }
                .header { overflow: hidden; } /* 清除浮动 */
                .logo {
                    font-size: large; color: #FF69B4; display: inline-block; margin: 5px 0;
                    float: left;
                }
                .header-buttons { float: right; margin-top: 5px; }
                .header-buttons a { 
                    font-size: small; border: 1px solid black; padding: 2px 4px; 
                    margin-left: 5px; color: black; background-color: #eee;
                }
                .categories { clear: both; } /* 确保分类栏在 logo 下方 */
                .categories a { margin-right: 2px; font-size: small; }
                .video-grid::after { content: ""; display: table; clear: both; }
                .video-item {
                    float: left; width: 47%; margin: 0.5%;
                    box-sizing: border-box; border: 1px solid #ccc;
                    padding: 4px; height: 5.5em; overflow: hidden;
                    background-color: #f9f9f9;
                }
                .video-link { text-decoration: none; color: black; }
                .video-title {
                    font-size: small; margin: 0; line-height: 1.3;
                    max-height: 3.9em; overflow: hidden;
                    text-overflow: ellipsis; 
                }
                h3 { margin-top: 5px; margin-bottom: 5px;}
                hr { margin: 8px 0; }
                .nav-link { display: inline-block; margin-right: 10px; }
                .pagination { margin-top: 10px; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1 class="logo">BBBili</h1>
                <div class="header-buttons">
                    <a href="/search">搜索</a>
                    <a href="/url_input">URL</a>
                </div>
            </div>
            <div class="categories">
                <a href="/category?rid=13&name=番剧">番剧</a> |
                <a href="/category?rid=119&name=鬼畜">鬼畜</a> |
                <a href="/category?rid=188&name=科技">科技</a> |
                <a href="/category?rid=3&name=音乐">音乐</a> |
                <a href="/category?rid=211&name=美食">美食</a> |
                <a href="/categories">展开</a>
            </div>
            <hr>
            <h3>热门视频 (第 ${pn} 页)</h3>
            ${videoListHtml}
            ${paginationHtml}
            <hr>
            <a href="/list" class="nav-link">查看缓存</a>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 新增: 分类详情页 (v0.4.0)
// ----------------------------------------------
app.get('/category', async (req, res) => {
    const rid = req.query.rid;
    const name = req.query.name || '分类';
    const pn = parseInt(req.query.pn || '1', 10);

    if (!rid) {
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>缺少分区 ID (rid)。</body></html>'));
    }

    const categoryData = await getVideosByCategory(rid, pn); //
    const categoryVideos = categoryData.archives || [];
    
    let videoListHtml = `<p>无法加载 ${name} 分区视频或列表为空。</p>`;
    if (categoryVideos && categoryVideos.length > 0) {
        videoListHtml = renderVideoGrid(categoryVideos);
    }
    
    // 分页 HTML
    const pageInfo = categoryData.page || { count: 0, num: pn, size: 20 };
    const totalPages = Math.ceil(pageInfo.count / pageInfo.size);
    
    let paginationHtml = '<div class="pagination">';
    if (pn > 1) {
        paginationHtml += `<a href="/category?rid=${rid}&name=${name}&pn=${pn - 1}" class="nav-link">上一页</a>`;
    }
    // 注意：dynamic/region API 不提供 "no_more"，我们用总页数来判断
    if (pn < totalPages) {
        paginationHtml += `<a href="/category?rid=${rid}&name=${name}&pn=${pn + 1}" class="nav-link" style="margin-left: 10px;">下一页</a>`;
    }
    paginationHtml += `<a href="/" class="nav-link" style="margin-left: 10px;">主页</a></div>`;

    // 使用和主页相同的 CSS
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>${name} - 黑莓哔哩哔哩</title>
            <style>
                body { font-family: monospace; margin: 5px; }
                a { color: #0000EE; text-decoration: none; }
                .logo { font-size: large; color: #FF69B4; margin: 5px 0; }
                .video-grid::after { content: ""; display: table; clear: both; }
                .video-item {
                    float: left; width: 47%; margin: 0.5%;
                    box-sizing: border-box; border: 1px solid #ccc;
                    padding: 4px; height: 5.5em; overflow: hidden;
                    background-color: #f9f9f9;
                }
                .video-link { text-decoration: none; color: black; }
                .video-title {
                    font-size: small; margin: 0; line-height: 1.3;
                    max-height: 3.9em; overflow: hidden;
                    text-overflow: ellipsis; 
                }
                h3 { margin-top: 5px; margin-bottom: 5px;}
                hr { margin: 8px 0; }
                .nav-link { display: inline-block; margin-right: 10px; }
                .pagination { margin-top: 10px; }
            </style>
        </head>
        <body>
            <a href="/"><h1 class="logo">BBBili</h1></a>
            <hr>
            <h3>${name} (第 ${pn} 页)</h3>
            ${videoListHtml}
            ${paginationHtml}
            <hr>
            <a href="/list" class="nav-link">查看缓存</a>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 新增: 全部分区页 (v0.4.0)
// ----------------------------------------------
app.get('/categories', (req, res) => {
    // 数据基于 video_zone.md
    const zones = [
        { name: "动画", rid: 1 }, { name: "番剧", rid: 13 }, { name: "国创", rid: 167 },
        { name: "音乐", rid: 3 }, { name: "舞蹈", rid: 129 }, { name: "游戏", rid: 4 },
        { name: "知识", rid: 36 }, { name: "科技", rid: 188 }, { name: "运动", rid: 234 },
        { name: "汽车", rid: 223 }, { name: "生活", rid: 160 }, { name: "美食", rid: 211 },
        { name: "动物圈", rid: 217 }, { name: "鬼畜", rid: 119 }, { name: "时尚", rid: 155 },
        { name: "资讯", rid: 202 }, { name: "娱乐", rid: 5 }, { name: "影视", rid: 181 },
        { name: "纪录片", rid: 177 }, { name: "电影", rid: 23 }, { name: "电视剧", rid: 11 }
    ];

    let listHtml = '<ul>';
    zones.forEach(zone => {
        listHtml += `<li><a href="/category?rid=${zone.rid}&name=${zone.name}">${zone.name}</a></li>`;
    });
    listHtml += '</ul>';

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>全部分区 - 黑莓哔哩哔哩</title>
            <style>
                body { font-family: monospace; margin: 5px; }
                a { color: #0000EE; text-decoration: none; }
                li { margin-bottom: 5px; }
            </style>
        </head>
        <body>
            <a href="/">← 返回主页</a>
            <hr>
            <h3>全部分区</h3>
            ${listHtml}
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 新增: URL 输入页 (v0.4.0)
// ----------------------------------------------
app.get('/url_input', (req, res) => {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>URL 播放 - 黑莓哔哩哔哩</title>
            <style>body { font-family: monospace; margin: 5px; }</style>
        </head>
        <body>
            <a href="/">← 返回主页</a>
            <hr>
            <h3>通过 URL 或 BV/AV 号播放</h3>
            <form action="/download" method="get">
                <label>输入 Bilibili URL 或 BV/AV 号:</label><br>
                <input type="text" name="url" size="60"><br><br>
                <input type="submit" value="转码并播放">
            </form>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 新增: 搜索输入页 (v0.4.0)
// ----------------------------------------------
app.get('/search', (req, res) => {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>搜索 - 黑莓哔哩哔哩</title>
            <style>body { font-family: monospace; margin: 5px; }</style>
        </head>
        <body>
            <a href="/">← 返回主页</a>
            <hr>
            <h3>搜索视频</h3>
            <form action="/search_results" method="get">
                <label>输入关键词:</label><br>
                <input type="text" name="keyword" size="60"><br><br>
                <input type="submit" value="搜索">
            </form>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 新增: 搜索结果页 (v0.4.0)
// ----------------------------------------------
app.get('/search_results', async (req, res) => {
    const keyword = req.query.keyword;
    const pn = parseInt(req.query.pn || '1', 10);
    
    if (!keyword) {
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>请输入关键词。</body></html>'));
    }

    const searchData = await searchBilibili(keyword, pn); //
    // 搜索结果的视频列表在 data.result
    const searchVideos = searchData.result || [];
    
    let videoListHtml = `<p>未找到关于 "${keyword}" 的视频，或 API 调用失败 (WBI)。</p>`;
    
    if (searchVideos && searchVideos.length > 0) {
        // 渲染搜索结果
        videoListHtml = '<div class="video-grid">';
        searchVideos.forEach((video) => {
            // 搜索结果的标题包含 <em> 标签，需要移除
            const cleanTitle = (video.title || '').replace(/<em class="keyword">/g, '').replace(/<\/em>/g, '');
             videoListHtml += `
                <div class="video-item">
                    <a href="/details?bvid=${video.bvid}" class="video-link">
                         <p class="video-title">${cleanTitle}</p>
                    </a>
                </div>
            `;
        });
        videoListHtml += '</div>';
    }
    
    // 分页
    const numPages = searchData.numPages || 0;
    
    let paginationHtml = '<div class="pagination">';
    if (pn > 1) {
        paginationHtml += `<a href="/search_results?keyword=${keyword}&pn=${pn - 1}" class="nav-link">上一页</a>`;
    }
    if (pn < numPages) {
        paginationHtml += `<a href="/search_results?keyword=${keyword}&pn=${pn + 1}" class="nav-link" style="margin-left: 10px;">下一页</a>`;
    }
    paginationHtml += `<a href="/" class="nav-link" style="margin-left: 10px;">主页</a></div>`;

    // 使用和主页相同的 CSS
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>搜索: ${keyword} - 黑莓哔哩哔哩</title>
            <style>
                body { font-family: monospace; margin: 5px; }
                a { color: #0000EE; text-decoration: none; }
                .logo { font-size: large; color: #FF69B4; margin: 5px 0; }
                .video-grid::after { content: ""; display: table; clear: both; }
                .video-item {
                    float: left; width: 47%; margin: 0.5%;
                    box-sizing: border-box; border: 1px solid #ccc;
                    padding: 4px; height: 5.5em; overflow: hidden;
                    background-color: #f9f9f9;
                }
                .video-link { text-decoration: none; color: black; }
                .video-title {
                    font-size: small; margin: 0; line-height: 1.3;
                    max-height: 3.9em; overflow: hidden;
                    text-overflow: ellipsis; 
                }
                h3 { margin-top: 5px; margin-bottom: 5px;}
                hr { margin: 8px 0; }
                .nav-link { display: inline-block; margin-right: 10px; }
                .pagination { margin-top: 10px; }
            </style>
        </head>
        <body>
            <a href="/"><h1 class="logo">BBBili</h1></a>
            <hr>
            <h3>搜索 "${keyword}" (第 ${pn} 页)</h3>
            ${videoListHtml}
            ${paginationHtml}
            <hr>
            <a href="/list" class="nav-link">查看缓存</a>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 视频详情页路由 (v0.4.0 修改: 增强信息)
// ----------------------------------------------
app.get('/details', async (req, res) => {
    const bvid = req.query.bvid;
    if (!bvid) {
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>缺少 BVID 参数。</body></html>'));
    }

    const details = await getVideoDetails(bvid); //

    if (!details) {
         return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>无法加载视频详情。可能是 API 问题或视频不存在。</body></html>'));
    }

    const originalUrl = `https://www.bilibili.com/video/${details.bvid}/`;
    const durationFormatted = formatDuration(details.duration);
    const description = details.desc || '无简介';
    const stat = details.stat || {};
    const owner = details.owner || { name: '未知UP主' }; //

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>${details.title || '视频详情'} - 黑莓哔哩哔哩</title>
            <style>
                body { font-family: monospace; margin: 5px; }
                a { color: #0000EE; }
                h2 { margin-top: 5px; margin-bottom: 5px; font-size: medium; }
                h3 { margin-top: 8px; margin-bottom: 3px; font-size: small; }
                p { margin: 3px 0; font-size: small; }
                pre {
                    white-space: pre-wrap;
                    word-wrap: break-word;
                    font-size: small;
                    border: 1px solid #eee;
                    padding: 5px;
                    margin: 5px 0;
                }
                .play-button {
                    display: inline-block;
                    font-size: medium;
                    padding: 8px 12px;
                    border: 1px solid black;
                    background-color: #eee;
                    text-decoration: none;
                    color: black;
                    margin-top: 10px;
                    margin-bottom: 10px;
                }
                hr { margin: 8px 0; }
                .nav-link { display: inline-block; margin-right: 10px; }
                .video-meta { color: #555; }
            </style>
        </head>
        <body>
            <a href="/" class="nav-link">返回主页</a> | <a href="javascript:history.back();" class="nav-link">返回上一页</a>
            <hr>
            <h2>${details.title}</h2>
            
            <p class="video-meta">UP主: ${owner.name}</p>
            <p class="video-meta">BVID: ${details.bvid} / AVID: ${details.aid}</p>
            
            <p>播放: ${stat.view || '未知'} | 点赞: ${stat.like || '未知'} | 投币: ${stat.coin || '未知'} | 时长: ${durationFormatted}</p>
            <hr>
            <h3>简介:</h3>
            <pre>${description}</pre>
            <hr>
            <a href="/download?url=${encodeURIComponent(originalUrl)}" class="play-button">播放视频</a>
            <br><br>
            <p>分享链接 (原始地址):<br>${originalUrl}</p>
            <hr>
            <a href="/list" class="nav-link">查看缓存</a>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});


// ----------------------------------------------
// 下载 + 转码 Handler (v0.4.0 修改: 支持 BV/AV 号)
// ----------------------------------------------
app.get('/download', async (req, res) => {
    let videoUrl = req.query.url;
    // v0.4.0 增强: 允许直接输入 BV/AV 号
    if (videoUrl && (videoUrl.startsWith('BV') || videoUrl.startsWith('av'))) {
        console.log(`[Info] 检测到 BV/AV 号, 自动补全 URL...`);
        videoUrl = `https://www.bilibili.com/video/${videoUrl}/`;
    }
    
    const decodedUrl = decodeURIComponent(videoUrl || '');

    if (!decodedUrl) {
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>无 URL 提供。</body></html>'));
    }
     console.log(`[Request] 请求下载: ${decodedUrl}`);

    const videoId = crypto.createHash('md5').update(decodedUrl).digest('hex');
    let videoTitle = decodedUrl;

    // 尝试从 API 获取标题
    try {
        const urlParts = decodedUrl.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/i);
        if (urlParts && urlParts[1]) {
            const bvid = urlParts[1];
            const details = await getVideoDetails(bvid);
            if (details && details.title) {
                videoTitle = details.title;
                console.log(`[Info] 获取到标题: ${videoTitle}`);
            }
        }
    } catch (e) {
        console.warn('[Warning] 获取视频标题失败，将使用 URL 作为标题。');
    }

    // 检查缓存
    const finalPathCheck = path.join(cacheDir, `${videoId}_final.mp4`);
    const cacheEntry = cacheMap.get(videoId);
    
    // 检查是否已完成
    if (cacheEntry && cacheEntry.status === 'completed' && fs.existsSync(finalPathCheck)) {
        console.log(`[Cache] 命中 (状态已完成): ${decodedUrl}`);
        return res.redirect(`/watch?file=${path.basename(finalPathCheck)}`);
    }

    // 检查是否正在处理
    if (cacheEntry && cacheEntry.status === 'pending') {
        console.log(`[Cache] 命中 (任务正在运行): ${decodedUrl}`);
        const pendingHtml = `
            <html>
            <head>
                <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
                <title>处理中</title>
                <style>body { font-family: monospace; }</style>
            </head>
            <body>
                <p>[服务器] 视频 "${videoTitle}" 正在处理中...</p>
                <p>页面将自动刷新检查状态。</p>
                <meta http-equiv="refresh" content="3;url=/status?id=${videoId}&title=${encodeURIComponent(videoTitle)}&origUrl=${encodeURIComponent(decodedUrl)}">
                 <hr>
                 <a href="/">返回主页</a>
            </body>
            </html>
        `;
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        return res.send(pendingHtml);
    }
    
    if(cacheMap.has(videoId)) {
        console.log(`[Cache] 发现失效缓存映射，移除: ${videoId}`);
        cacheMap.delete(videoId);
    }

    // --- 开始后台处理前，设置状态为 pending ---
    cacheMap.set(videoId, { title: videoTitle, url: decodedUrl, status: 'pending' });
    console.log(`[Job] 启动新任务并设置状态为 pending: ${videoId}`);
    
    // 发送处理中页面
    const processingHtml = `
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>处理中</title>
            <style>body { font-family: monospace; }</style>
        </head>
        <body>
            <p>[服务器] 正在处理您的请求...</p>
            <p>视频: ${videoTitle}</p>
            <p>请稍候，处理时间取决于视频长度和服务器性能。</p>
            <p>页面将自动刷新检查状态。</p>
            <meta http-equiv="refresh" content="3;url=/status?id=${videoId}&title=${encodeURIComponent(videoTitle)}&origUrl=${encodeURIComponent(decodedUrl)}">
             <hr>
             <a href="/">返回主页</a>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(processingHtml);

    // --- 开始后台处理 ---
    const outputPathRaw = path.join(cacheDir, `${videoId}_raw.part`);
    const outputPathFinal = finalPathCheck;
    
    if (fs.existsSync(outputPathRaw)) {
        console.log(`[Job] 原始文件下载中 (${outputPathRaw})，跳过启动新任务.`);
        return;
    }

    const ytArgs = [
        '-f', 'bv[height<=360][ext=mp4]+ba[ext=m4a]/b[height<=360][ext=mp4]/bv[height<=360]+ba/b[height<=360]',
        '--no-playlist', // 修复多P视频问题
        '-o', outputPathRaw,
        '--socket-timeout', '30',
        '--retries', '5',
        decodedUrl
    ];
    console.log(`[Download] yt-dlp ${ytArgs.join(' ')}`);

    const ytdlp = spawn('yt-dlp', ytArgs);
    let ytdlpOutput = '';

    ytdlp.stdout.on('data', d => {
        const line = d.toString();
        process.stdout.write(line);
        ytdlpOutput += line;
    });
    ytdlp.stderr.on('data', d => {
        const line = d.toString();
        process.stderr.write(line);
        ytdlpOutput += line;
    });

    ytdlp.on('close', code => {
        if (code !== 0) {
            console.error(`[Error] yt-dlp 退出，代码: ${code}`);
            if (fs.existsSync(outputPathRaw)) {
                try {
                    fs.unlinkSync(outputPathRaw);
                    console.log(`[Cleanup] 删除了失败的原始文件: ${outputPathRaw}`);
                } catch (unlinkErr) {
                    console.error(`[Error] 删除失败的原始文件时出错: ${unlinkErr.message}`);
                }
            }
            cacheMap.set(videoId, { ...cacheMap.get(videoId), status: 'failed', error: `yt-dlp exited with code ${code}` });
            return;
        }

        // --- 增强文件重命名逻辑 ---
        const downloadedFilePath = path.join(cacheDir, `${videoId}_raw.mp4`);
        let sourcePath = outputPathRaw; 

        if (!fs.existsSync(sourcePath)) {
            const finalMergedPath = path.join(cacheDir, `${videoId}_raw.part.mp4`);
            if (fs.existsSync(finalMergedPath)) {
                sourcePath = finalMergedPath;
                console.log(`[Download] yt-dlp 已自动合并为 .part.mp4，使用此文件作为源。`);
            } else if (fs.existsSync(downloadedFilePath)) {
                 sourcePath = downloadedFilePath;
                 console.log(`[Download] yt-dlp 自动重命名完成，跳过手动重命名。`);
            } else {
                 console.error(`[Error] yt-dlp 退出代码 0，但未找到原始文件进行转码。`);
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


        // 开始 FFmpeg 转码
        const ffmpegArgs = [
            '-i', downloadedFilePathForFFmpeg,
            '-vf', "scale='if(gt(a,320/240),320,-2)':'if(gt(a,320/240),-2,240)',pad=320:240:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p",
            '-vcodec', 'libx264',
            '-profile:v', 'baseline',
            '-level', '3.0',
            '-preset', 'veryfast',
            '-crf', '28',
            '-acodec', 'aac',
            '-ar', '44100',
            '-b:a', '96k',
            '-movflags', '+faststart',
            '-y',
            outputPathFinal
        ];

        console.log(`[FFmpeg] 开始转码 ${downloadedFilePathForFFmpeg} -> ${outputPathFinal}`);
        const ffmpeg = spawn('ffmpeg', ffmpegArgs);
        let ffmpegOutput = '';

        ffmpeg.stdout.on('data', d => { process.stdout.write(d.toString()); ffmpegOutput += d.toString(); });
        ffmpeg.stderr.on('data', d => { process.stderr.write(d.toString()); ffmpegOutput += d.toString(); });

        ffmpeg.on('close', c => {
            try {
                if (fs.existsSync(downloadedFilePathForFFmpeg)) {
                    fs.unlinkSync(downloadedFilePathForFFmpeg);
                    console.log(`[Cleanup] 删除了原始文件: ${downloadedFilePathForFFmpeg}`);
                }
            } catch (unlinkErr) {
                console.error(`[Error] 删除原始文件时出错: ${unlinkErr.message}`);
            }

            if (c === 0) {
                // ***转码成功，更新状态为 'completed'***
                cacheMap.set(videoId, { ...cacheMap.get(videoId), filePath: outputPathFinal, status: 'completed' });
                console.log(`[Cache] 添加转码文件到缓存并设置状态为 completed: ${outputPathFinal}`);
            } else {
                console.error(`[Error] ffmpeg 退出，代码: ${c}`);
                if (fs.existsSync(outputPathFinal)) {
                    try {
                        fs.unlinkSync(outputPathFinal);
                         console.log(`[Cleanup] 删除了失败的转码文件: ${outputPathFinal}`);
                    } catch (unlinkErr) {
                         console.error(`[Error] 删除失败的转码文件时出错: ${unlinkErr.message}`);
                    }
                }
                cacheMap.set(videoId, { ...cacheMap.get(videoId), status: 'failed', error: `ffmpeg exited with code ${c}` });
            }
        });

         ffmpeg.on('error', (err) => {
            console.error('[Error] 无法启动 ffmpeg:', err.message);
             if (fs.existsSync(downloadedFilePathForFFmpeg)) fs.unlinkSync(downloadedFilePathForFFmpeg);
             cacheMap.set(videoId, { ...cacheMap.get(videoId), status: 'failed', error: 'Failed to start ffmpeg' });
         });
    });

    ytdlp.on('error', (err) => {
        console.error('[Error] 无法启动 yt-dlp:', err.message);
         if (fs.existsSync(outputPathRaw)) fs.unlinkSync(outputPathRaw);
         cacheMap.set(videoId, { ...cacheMap.get(videoId), status: 'failed', error: 'Failed to start yt-dlp' });
    });
});

// ----------------------------------------------
// Status Page (v0.4.0 修改: 严格状态检查)
// ----------------------------------------------
app.get('/status', (req, res) => {
    const videoId = req.query.id;
    const title = req.query.title || '视频';
    const origUrl = req.query.origUrl || '/';

    const cacheEntry = cacheMap.get(videoId);
    const finalPath = path.join(cacheDir, `${videoId}_final.mp4`);
    const fileExists = fs.existsSync(finalPath);

    // 1. 检查任务是否已在内存中标记为 'completed' (最可靠)
    if (cacheEntry && cacheEntry.status === 'completed') {
        if (fileExists) {
             return res.redirect(`/watch?file=${path.basename(finalPath)}`);
        } else {
            console.log(`[Status Error] 缓存映射显示完成，但文件丢失。清理映射: ${videoId}`);
            cacheMap.delete(videoId); 
        }
    } 
    // 2. 检查孤立的已完成文件 (服务器重启)
    else if (!cacheEntry && fileExists) {
        console.log(`[Status] 文件存在但映射丢失 (可能服务器重启)，重建映射并尝试播放: ${videoId}`);
        const tempTitle = title || path.basename(finalPath);
        cacheMap.set(videoId, { filePath: finalPath, title: tempTitle, url: origUrl, status: 'completed' });
        return res.redirect(`/watch?file=${path.basename(finalPath)}`);
    }
    // 3. 检查任务是否失败
    else if (cacheEntry && cacheEntry.status === 'failed') {
        const errorHtml = `
            <html>
            <head>
                <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
                <title>处理失败</title>
                <style>body { font-family: monospace; }</style>
            </head>
            <body>
                <p>[服务器] 处理视频 "${title}" 时遇到错误。</p>
                <p>错误信息: ${cacheEntry.error || '未知错误'}</p>
                <p><a href="/download?url=${encodeURIComponent(origUrl)}">重试</a> | <a href="/">返回主页</a></p>
            </body>
            </html>
        `;
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        res.status(500).send(errorHtml);
    } 
    // 4. 任务仍在进行中 ('pending')
    else {
        // 继续使用 3 秒刷新
        const processingHtml = `
            <html>
            <head>
                <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
                <title>状态</title>
                 <style>body { font-family: monospace; }</style>
                 <meta http-equiv="refresh" content="3;url=/status?id=${videoId}&title=${encodeURIComponent(title)}&origUrl=${encodeURIComponent(origUrl)}">
            </head>
            <body>
                <p>[服务器] 视频 "${title}" 仍在处理中...</p>
                <p>请稍候，页面将自动刷新。</p>
                 <hr>
                 <a href="/">返回主页</a>
            </body>
            </html>
        `;
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        res.send(processingHtml);
    }
});


// ----------------------------------------------
// 保留: Watch Page
// ----------------------------------------------
app.get('/watch', (req, res) => {
    const file = req.query.file;
    if (!file || !file.endsWith('_final.mp4')) {
         return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>无效的文件名。</body></html>'));
    }

    const filePath = path.join(cacheDir, file);
    if (!fs.existsSync(filePath)) {
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>缓存的视频文件未找到，可能已被清理。</body></html>'));
    }

    const videoId = file.replace('_final.mp4', '');
    const cacheEntry = cacheMap.get(videoId);
    const videoTitle = cacheEntry ? cacheEntry.title : file.replace(/^[a-f0-9]+_/, '').replace('_final.mp4', '');

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>播放准备就绪</title>
            <style>body { font-family: monospace; margin: 5px; } h3 { font-size: medium; } .play-link { font-size: large; margin: 10px 0; display: inline-block; } .nav-link { margin-right: 10px; }</style>
        </head>
        <body>
            <h3>准备播放:</h3>
            <p>${videoTitle}</p>
            <a href="/stream/${file}" class="play-link">▶ 在播放器中播放</a>
            <hr>
            <a href="/list" class="nav-link">← 返回缓存列表</a> | <a href="/" class="nav-link">← 返回主页</a>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 保留: List Cached Videos
// ----------------------------------------------
app.get('/list', (req, res) => {
    let listHtml = '';
    
    // 扫描目录以查找所有完成的文件 (对服务器重启更鲁棒)
    const filesInDir = fs.readdirSync(cacheDir).filter(f => f.endsWith('_final.mp4'));

    if (filesInDir.length > 0) {
         listHtml = filesInDir.map(f => {
            const videoId = f.replace('_final.mp4', '');
            const cacheEntry = cacheMap.get(videoId);
            
            // 优先使用内存中的标题，否则使用默认标题
            const title = cacheEntry ? cacheEntry.title : `${videoId.substring(0, 8)}... (已缓存)`;
            
            // 如果内存中没有，则补上
            if (!cacheEntry) {
                 cacheMap.set(videoId, { 
                     filePath: path.join(cacheDir, f), 
                     title: title, 
                     url: "未知URL (来自重启)", 
                     status: 'completed' 
                 });
            }
            return `<li><a href="/watch?file=${f}">${title}</a></li>`;
         }).join('');
    }

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>缓存视频</title>
            <style>body { font-family: monospace; margin: 5px; } ul { padding-left: 20px; } li { margin-bottom: 5px; } .nav-link { margin-right: 10px; }</style>
        </head>
        <body>
            <h3>已缓存视频</h3>
            <ul>${listHtml || '<li>暂无有效缓存视频。</li>'}</ul>
            <hr>
            <a href="/" class="nav-link">← 返回主页</a> |
            <a href="/confirm_clear" class="nav-link">清理缓存</a>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 保留: Clear Cache Confirmation Page
// ----------------------------------------------
app.get('/confirm_clear', (req, res) => {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>确认清理</title>
             <style>body { font-family: monospace; margin: 5px; } a { margin-right: 10px; }</style>
        </head>
        <body>
            <h3>确认清理缓存</h3>
            <p>这将永久删除所有已下载和转码的视频文件。</p>
            <a href="/clear_cache">是, 清理所有缓存</a> |
            <a href="/">取消</a>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 保留: Clear Cache Action
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
             <style>body { font-family: monospace; margin: 5px; }</style>
        </head>
        <body>
            <h3>缓存已清理</h3>
            <p>删除了 ${clearedCount} 个文件。</p>
            ${errorCount > 0 ? `<p style="color: red;">删除过程中遇到 ${errorCount} 个错误，请检查服务器日志。</p>` : ''}
            <a href="/">← 返回主页</a>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 保留: Stream Video
// ----------------------------------------------
app.get('/stream/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!filename || filename.includes('..') || !filename.endsWith('_final.mp4')) {
        return res.status(400).send('Invalid filename');
    }

    const filePath = path.join(cacheDir, filename);

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
            console.log(`[Stream] 发送 Range: ${start}-${end}/${stats.size} for ${filename}`);
        } else {
             console.log(`[Stream] 发送完整文件: ${filename} (${stats.size} bytes)`);
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
    console.log(`  BBB-VideoStreamer v0.4.0 (功能扩展版)`);
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
