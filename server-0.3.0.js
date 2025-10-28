// ==============================================
// BBB-VideoStreamer v0.3.1 (Bilibili Mirror Frontend - 修复版)
// Author: Coderroring
// Features:
//  - BlackBerry 9900 optimized Bilibili frontend (Homepage + Details)
//  - Fetches data using Bilibili API (Popular, View)
//  - Download Bilibili videos (360p or below)
//  - **修复多P视频下载后的文件重命名问题**
//  - Transcode for BlackBerry 9900 (Baseline H.264 320x240)
//  - Stream playable video over HTTP
//  - Cache management (view + replay)
//  - UTF-8 Support for Chinese characters
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

const cacheMap = new Map(); // videoId => { filePath, title, url }

// --- Utility: Inject UTF-8 Meta Tag (用于旧路由兼容) ---
const injectUtf8Meta = (html) => {
    // 确保替换，以防万一旧路由仍被调用
    if (!html.includes('charset=UTF-8')) {
      return html.replace('<head>', '<head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">');
    }
    return html;
};

app.use(express.urlencoded({ extended: true }));

// --- Utility: Bilibili API 调用函数 ---
async function getPopularVideos() {
    console.log('[API] 获取热门视频...');
    try {
        const response = await fetch('https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1', {
             headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
        const data = await response.json();
        if (data.code !== 0) throw new Error(`Bilibili API 错误: ${data.message || data.code}`);
        console.log('[API] 成功获取热门视频');
        return data.data.list;
    } catch (error) {
        console.error('[Error] 获取热门视频失败:', error.message);
        return [];
    }
}

async function getVideoDetails(bvid) {
     console.log(`[API] 获取视频详情 (BVID: ${bvid})...`);
    try {
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

// --- Utility: 格式化时长函数 ---
function formatDuration(seconds) {
    if (isNaN(seconds) || seconds < 0) return '未知';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
}


// ----------------------------------------------
// 新主页路由 (获取热门视频)
// ----------------------------------------------
app.get('/', async (req, res) => {
    const popularVideos = await getPopularVideos();
    let videoListHtml = '';

    if (popularVideos && popularVideos.length > 0) {
        videoListHtml += '<div class="video-grid">';
        popularVideos.forEach((video) => {
             videoListHtml += `
                <div class="video-item">
                    <a href="/details?bvid=${video.bvid}" class="video-link">
                         <p class="video-title">${video.title}</p>
                    </a>
                </div>
            `;
        });
         videoListHtml += '</div>';
    } else {
        videoListHtml = '<p>无法加载热门视频或列表为空。</p>';
    }

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>BBBili</title>
            <style>
                body { font-family: monospace; margin: 5px; }
                a { color: #0000EE; }
                .categories a { margin-right: 5px; }
                .video-grid::after { content: ""; display: table; clear: both; }
                .video-item {
                    float: left;
                    width: 48%;
                    margin: 1%;
                    box-sizing: border-box;
                    border: 1px solid #ccc;
                    padding: 4px;
                    height: 5em;
                    overflow: hidden;
                    background-color: #f9f9f9;
                }
                .video-link { text-decoration: none; color: black; }
                .video-title {
                    font-size: small;
                    margin: 0;
                    line-height: 1.3;
                    max-height: 2.6em;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                }
                h1, h3 { margin-top: 5px; margin-bottom: 5px;}
                hr { margin: 8px 0; }
                .nav-link { display: inline-block; margin-right: 10px; }
            </style>
        </head>
        <body>
            <h1>BBBili</h1>
            <div class="categories">
                <a>番剧</a> | <a>鬼畜</a> | <a>科技</a> | <a>音乐</a> | <a>美食</a> | <a>展开</a>
            </div>
            <hr>
            <h3>热门视频</h3>
            ${videoListHtml}
            <hr>
            <a href="/list" class="nav-link">查看缓存</a>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(html);
});

// ----------------------------------------------
// 新增: 视频详情页路由
// ----------------------------------------------
app.get('/details', async (req, res) => {
    const bvid = req.query.bvid;
    if (!bvid) {
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>缺少 BVID 参数。</body></html>'));
    }

    const details = await getVideoDetails(bvid);

    if (!details) {
         return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>无法加载视频详情。可能是 API 问题或视频不存在。</body></html>'));
    }

    const originalUrl = `https://www.bilibili.com/video/${details.bvid}/`;
    const durationFormatted = formatDuration(details.duration);
    const description = details.desc || '无简介';
    const stat = details.stat || {};

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <title>${details.title || '视频详情'} - BBBili</title>
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
            </style>
        </head>
        <body>
            <a href="/" class="nav-link">返回主页</a> | <a href="javascript:history.back();" class="nav-link">返回上一页</a>
            <hr>
            <h2>${details.title}</h2>
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
// 保留: 下载 + 转码 Handler
// ----------------------------------------------
app.get('/download', async (req, res) => {
    const videoUrl = req.query.url;
    const decodedUrl = decodeURIComponent(videoUrl || '');

    if (!decodedUrl) {
        return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>无 URL 提供。</body></html>'));
    }
     console.log(`[Request] 请求下载: ${decodedUrl}`);

    const videoId = crypto.createHash('md5').update(decodedUrl).digest('hex');
    let videoTitle = decodedUrl;

    // 尝试从 API 获取标题
    try {
        const urlParts = decodedUrl.match(/bilibili\.com\/video\/([a-zA-Z0-9]+)/);
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
    if (fs.existsSync(finalPathCheck)) {
        console.log(`[Cache] 命中 (文件存在): ${decodedUrl}`);
        if (!cacheMap.has(videoId)) {
             cacheMap.set(videoId, { filePath: finalPathCheck, title: videoTitle, url: decodedUrl });
             console.log(`[Cache] 重建缓存映射: ${videoId}`);
        }
        return res.redirect(`/watch?file=${path.basename(finalPathCheck)}`);
    }

    if(cacheMap.has(videoId)) {
        console.log(`[Cache] 发现失效缓存映射，移除: ${videoId}`);
        cacheMap.delete(videoId);
    }

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
            <meta http-equiv="refresh" content="5;url=/status?id=${videoId}&title=${encodeURIComponent(videoTitle)}&origUrl=${encodeURIComponent(decodedUrl)}">
             <hr>
             <a href="/">返回主页</a>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(processingHtml);

    // --- 开始后台处理 ---
    const outputPathRaw = path.join(cacheDir, `${videoId}_raw.part`); // 预期的临时文件名
    const outputPathFinal = finalPathCheck; // 最终文件名

    if (fs.existsSync(outputPathRaw)) {
        console.log(`[Job] 原始文件下载中 (${outputPathRaw})，跳过启动新任务.`);
        return;
    }

    // 强制不处理播放列表，只下载第一个P
    const ytArgs = [
        '-f', 'bv[height<=360][ext=mp4]+ba[ext=m4a]/b[height<=360][ext=mp4]/bv[height<=360]+ba/b[height<=360]',
        '--no-playlist', // <--- 【关键修复 1】强制单视频下载
        '-o', outputPathRaw,
        '--socket-timeout', '30',
        '--retries', '5',
        // 如果需要 Cookie，在这里添加: '--cookies', '/path/to/cookies.txt', 
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
            // 清理可能产生的 .part 文件
            if (fs.existsSync(outputPathRaw)) {
                try {
                    fs.unlinkSync(outputPathRaw);
                    console.log(`[Cleanup] 删除了失败的原始文件: ${outputPathRaw}`);
                } catch (unlinkErr) {
                    console.error(`[Error] 删除失败的原始文件时出错: ${unlinkErr.message}`);
                }
            }
            return;
        }

        // --- 【关键修复 2】增强文件重命名逻辑 ---
        const downloadedFilePath = path.join(cacheDir, `${videoId}_raw.mp4`); // 期望的重命名目标
        let sourcePath = outputPathRaw; // 预期的临时文件

        // 检查 yt-dlp 是否已自动重命名或合并
        if (!fs.existsSync(sourcePath)) {
            // 检查 yt-dlp 自动合并后的文件名 (e.g., ..._raw.part.mp4)
            const finalMergedPath = path.join(cacheDir, `${videoId}_raw.part.mp4`);
            if (fs.existsSync(finalMergedPath)) {
                sourcePath = finalMergedPath;
                console.log(`[Download] yt-dlp 已自动合并为 .part.mp4，使用此文件作为源。`);
            } else if (fs.existsSync(downloadedFilePath)) {
                 // 检查 yt-dlp 是否已经自动重命名到了我们期望的最终名 (..._raw.mp4)
                 sourcePath = downloadedFilePath;
                 console.log(`[Download] yt-dlp 自动重命名完成，跳过手动重命名。`);
            } else {
                 console.error(`[Error] yt-dlp 退出代码 0，但未找到原始文件进行转码。`);
                 cacheMap.set(videoId, { status: 'failed', error: 'yt-dlp完成但找不到文件', title: videoTitle, url: decodedUrl });
                 return;
            }
        }
        
        let downloadedFilePathForFFmpeg = downloadedFilePath;

        // 如果源文件是临时文件 (.part) 或合并文件名 (.part.mp4)，则手动重命名
        if (sourcePath !== downloadedFilePath) {
            try {
                fs.renameSync(sourcePath, downloadedFilePath); // 执行重命名到 ..._raw.mp4
                console.log(`[Download] 原始文件下载完成并手动重命名: ${downloadedFilePath}`);
                downloadedFilePathForFFmpeg = downloadedFilePath;
            } catch (renameErr) {
                 console.error(`[Error] 重命名原始文件失败: ${renameErr.message}`);
                 // 确保清理原始文件，不论是哪种命名
                 if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath); 
                 cacheMap.set(videoId, { status: 'failed', error: '重命名原始文件失败', title: videoTitle, url: decodedUrl });
                 return;
            }
        } else {
            // 文件已经是期望的 downloadedFilePath 命名，直接用它
            downloadedFilePathForFFmpeg = downloadedFilePath;
        }


        // 开始 FFmpeg 转码
        const ffmpegArgs = [
            '-i', downloadedFilePathForFFmpeg, // 使用正确的输入路径
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
            // 删除原始文件，无论成功与否
            try {
                if (fs.existsSync(downloadedFilePathForFFmpeg)) {
                    fs.unlinkSync(downloadedFilePathForFFmpeg);
                    console.log(`[Cleanup] 删除了原始文件: ${downloadedFilePathForFFmpeg}`);
                }
            } catch (unlinkErr) {
                console.error(`[Error] 删除原始文件时出错: ${unlinkErr.message}`);
            }

            if (c === 0) {
                // 转码成功
                cacheMap.set(videoId, { filePath: outputPathFinal, title: videoTitle, url: decodedUrl, status: 'completed' });
                console.log(`[Cache] 添加转码文件到缓存: ${outputPathFinal}`);
            } else {
                console.error(`[Error] ffmpeg 退出，代码: ${c}`);
                // 清理可能产生的最终文件
                if (fs.existsSync(outputPathFinal)) {
                    try {
                        fs.unlinkSync(outputPathFinal);
                         console.log(`[Cleanup] 删除了失败的转码文件: ${outputPathFinal}`);
                    } catch (unlinkErr) {
                         console.error(`[Error] 删除失败的转码文件时出错: ${unlinkErr.message}`);
                    }
                }
                cacheMap.set(videoId, { status: 'failed', error: `ffmpeg exited with code ${c}`, title: videoTitle, url: decodedUrl });
            }
        });

         ffmpeg.on('error', (err) => {
            console.error('[Error] 无法启动 ffmpeg:', err.message);
             if (fs.existsSync(downloadedFilePathForFFmpeg)) fs.unlinkSync(downloadedFilePathForFFmpeg);
             cacheMap.set(videoId, { status: 'failed', error: 'Failed to start ffmpeg', title: videoTitle, url: decodedUrl });
         });
    });

    ytdlp.on('error', (err) => {
        console.error('[Error] 无法启动 yt-dlp:', err.message);
         if (fs.existsSync(outputPathRaw)) fs.unlinkSync(outputPathRaw);
         cacheMap.set(videoId, { status: 'failed', error: 'Failed to start yt-dlp', title: videoTitle, url: decodedUrl });
    });
});

// ----------------------------------------------
// 保留: Status Page
// ----------------------------------------------
app.get('/status', (req, res) => {
    const videoId = req.query.id;
    const title = req.query.title || '视频';
    const origUrl = req.query.origUrl || '/';

    const cacheEntry = cacheMap.get(videoId);

    const finalPath = path.join(cacheDir, `${videoId}_final.mp4`);
    const fileExists = fs.existsSync(finalPath);

    if (fileExists) {
        if (!cacheEntry || cacheEntry.status !== 'completed') {
             console.log(`[Status] 文件存在但映射无效/丢失，重建映射: ${videoId}`);
             cacheMap.set(videoId, { filePath: finalPath, title: title, url: origUrl, status: 'completed' });
        }
        res.redirect(`/watch?file=${path.basename(finalPath)}`);
    } else if (cacheEntry && cacheEntry.status === 'failed') {
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
    } else {
        const processingHtml = `
            <html>
            <head>
                <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
                <title>状态</title>
                 <style>body { font-family: monospace; }</style>
                 <meta http-equiv="refresh" content="5;url=/status?id=${videoId}&title=${encodeURIComponent(title)}&origUrl=${encodeURIComponent(origUrl)}">
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
    const cachedItems = Array.from(cacheMap.entries());
    let listHtml = '';

    if (cachedItems.length > 0) {
        listHtml = cachedItems.map(([videoId, cacheData]) => {
            if (fs.existsSync(cacheData.filePath)) {
                 const fileName = path.basename(cacheData.filePath);
                 const title = cacheData.title || fileName;
                 return `<li><a href="/watch?file=${fileName}">${title}</a></li>`;
            }
            return '';
        }).join('');
    }

    const filesInDir = fs.readdirSync(cacheDir).filter(f => f.endsWith('_final.mp4'));
    if (listHtml === '' || filesInDir.length > cacheMap.size) {
         console.log("[List] Cache map不完整或为空，扫描目录...");
         const fileListHtml = filesInDir.map(f => {
             const videoIdFromFile = f.replace('_final.mp4', '');
             if (!cacheMap.has(videoIdFromFile)) {
                  const defaultTitle = f.replace(/^[a-f0-9]+_/, '').replace('_final.mp4', '') || f;
                  return `<li><a href="/watch?file=${f}">${defaultTitle} (无缓存标题)</a></li>`;
             }
             return '';
         }).join('');
         listHtml += fileListHtml;
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
    console.log(`  BBB-VideoStreamer v0.3.1 (Bilibili Mirror Frontend)`);
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
