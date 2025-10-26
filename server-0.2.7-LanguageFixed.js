// ==============================================
// BBB-VideoStreamer v0.2.7 (with UTF-8 Fix)
// Author: Coderroring
// Features:
//  - Download Bilibili videos (360p or below)
//  - Transcode for BlackBerry 9900 (Baseline H.264 320x240)
//  - Stream playable video over HTTP
//  - Cache management (view + replay)
//  - Cache clearing with confirmation
// ==============================================

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const port = 3000;

const cacheDir = path.join(__dirname, 'cache');
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);

const cacheMap = new Map(); // videoId => { filePath, title, url }

// --- Utility: Inject UTF-8 Meta Tag ---
const injectUtf8Meta = (html) => {
    return html.replace('<head>', '<head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">');
};

app.use(express.urlencoded({ extended: true }));

// ----------------------------------------------
// Home page
// ----------------------------------------------
app.get('/', (req, res) => {
    const html = `
        <html>
        <head><title>BBB-VideoStreamer 主页</title></head>
        <body style="font-family:monospace;">
        <h3>BBB-VideoStreamer</h3>
        <p>为您的黑莓手机转换 Bilibili 视频</p>
        <form action="/download" method="get">
            <label>输入 Bilibili 视频 URL:</label><br>
            <input type="text" name="url" size="60"><br><br>
            <input type="submit" value="下载并流媒体播放">
        </form>
        <hr>
        <a href="/list">查看缓存视频</a> |
        <a href="/confirm_clear">清理缓存</a>
        </body></html>
    `;
    res.send(injectUtf8Meta(html));
});

// ----------------------------------------------
// Download + Transcode Handler
// ----------------------------------------------
app.get('/download', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>无 URL 提供。</body></html>'));

    // In a real application, you'd fetch the title before the download starts.
    // For now, we use the URL as a placeholder title.
    const placeholderTitle = videoUrl; 
    const videoId = crypto.createHash('md5').update(videoUrl).digest('hex');
    
    // Check Cache
    const cached = cacheMap.get(videoId);
    if (cached && fs.existsSync(cached.filePath)) {
        console.log(`[Cache] 命中: ${videoUrl}`);
        return res.redirect(`/watch?file=${path.basename(cached.filePath)}`);
    }

    // Start Processing Message (Immediate response to prevent timeout)
    const html = `
        <html>
        <head><title>处理中</title></head>
        <body style="font-family:monospace;">
        <p>[服务器] 正在处理您的请求... 请稍候。</p>
        <meta http-equiv="refresh" content="3;url=/status?id=${videoId}">
        </body></html>
    `;
    res.send(injectUtf8Meta(html));
    
    // --- Start Background Job ---
    const outputPath = path.join(cacheDir, `${videoId}_raw.mp4`);
    
    // Ensure the job doesn't run twice if the user refreshes quickly
    if (fs.existsSync(outputPath) || (cached && !fs.existsSync(cached.filePath))) {
        console.log(`[Job] 任务已在运行或文件正在下载，跳过 yt-dlp 启动.`);
        return;
    }

    const ytArgs = ['-f', 'bv*[height<=360]+ba/b[height<=360]', '-o', outputPath, videoUrl];
    console.log(`[Download] yt-dlp ${ytArgs.join(' ')}`);

    const ytdlp = spawn('yt-dlp', ytArgs);
    ytdlp.stdout.on('data', d => process.stdout.write(d.toString()));
    ytdlp.stderr.on('data', d => process.stdout.write(d.toString()));

    ytdlp.on('close', code => {
        if (code !== 0) {
            console.error(`[Error] yt-dlp 退出代码: ${code}`);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            return;
        }

        const finalPath = path.join(cacheDir, `${videoId}_final.mp4`);
        const ffmpegArgs = [
            '-i', outputPath,
            '-vf', "scale='if(gt(a,4/3),320,-2)':'if(gt(a,4/3),-2,240)',pad=320:240:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p",
            // We remove the rotate=90 metadata line unless you specifically need to fix vertical videos,
            // as it can sometimes confuse older players.
            '-vcodec', 'libx264', '-profile:v', 'baseline',
            '-preset', 'veryfast', '-crf', '28',
            '-acodec', 'aac', '-ar', '44100', '-b:a', '96k',
            '-movflags', '+faststart',
            '-y', finalPath
        ];

        console.log(`[FFmpeg] 转码中 ${outputPath} -> ${finalPath}`);
        const ffmpeg = spawn('ffmpeg', ffmpegArgs);
        ffmpeg.stdout.on('data', d => process.stdout.write(d.toString()));
        ffmpeg.stderr.on('data', d => process.stdout.write(d.toString()));

        ffmpeg.on('close', c => {
            if (c === 0) {
                // Success: Add to cache, and get actual title (optional future feature)
                cacheMap.set(videoId, { filePath: finalPath, title: placeholderTitle, url: videoUrl });
                fs.unlinkSync(outputPath); // Delete raw file
                console.log(`[Cache] 添加 ${finalPath}`);
            } else {
                console.error(`[Error] ffmpeg 退出代码: ${c}`);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            }
        });
    });
});

// ----------------------------------------------
// Status Page
// ----------------------------------------------
app.get('/status', (req, res) => {
    const videoId = req.query.id;
    const cached = cacheMap.get(videoId);

    if (cached && fs.existsSync(cached.filePath)) {
        res.redirect(`/watch?file=${path.basename(cached.filePath)}`);
    } else {
        const html = `
            <html>
            <head><title>状态</title></head>
            <body style="font-family:monospace;">
            <p>[服务器] 视频仍在处理中...</p>
            <meta http-equiv="refresh" content="5;url=/status?id=${videoId}">
            </body></html>
        `;
        res.send(injectUtf8Meta(html));
    }
});

// ----------------------------------------------
// Watch Page
// ----------------------------------------------
app.get('/watch', (req, res) => {
    const file = req.query.file;
    const filePath = path.join(cacheDir, file);
    if (!fs.existsSync(filePath)) return res.send(injectUtf8Meta('<html><head><title>错误</title></head><body>视频未找到。</body></html>'));

    // Find the title from the cache map
    const cacheEntry = Array.from(cacheMap.values()).find(v => path.basename(v.filePath) === file);
    const videoTitle = cacheEntry ? cacheEntry.title : file;

    const html = `
        <html>
        <head><title>播放器</title></head>
        <body style="font-family:monospace;">
        <h3>正在观看: ${videoTitle}</h3>
        <a href="/stream/${file}">▶ 在 BlackBerry 播放器中播放</a><br><br>
        <a href="/list">← 返回缓存列表</a>
        </body></html>
    `;
    res.send(injectUtf8Meta(html));
});

// ----------------------------------------------
// List Cached Videos
// ----------------------------------------------
app.get('/list', (req, res) => {
    const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('_final.mp4'));
    const list = files.map(f => {
        const cacheEntry = Array.from(cacheMap.values()).find(v => path.basename(v.filePath) === f);
        const title = cacheEntry ? cacheEntry.title : f;
        return `<li><a href="/watch?file=${f}">${title}</a></li>`;
    }).join('');

    const html = `
        <html>
        <head><title>缓存视频</title></head>
        <body style="font-family:monospace;">
        <h3>已缓存视频</h3>
        <ul>${list || '<li>暂无缓存视频。</li>'}</ul>
        <a href="/">← 返回主页</a> |
        <a href="/confirm_clear">清理缓存</a>
        </body></html>
    `;
    res.send(injectUtf8Meta(html));
});

// ----------------------------------------------
// Clear Cache Confirmation Page
// ----------------------------------------------
app.get('/confirm_clear', (req, res) => {
    const html = `
        <html>
        <head><title>确认清理</title></head>
        <body style="font-family:monospace;">
        <h3>确认清理缓存</h3>
        <p>这将永久删除所有缓存视频。</p>
        <a href="/clear_cache">是, 清理所有缓存</a> |
        <a href="/">取消</a>
        </body></html>
    `;
    res.send(injectUtf8Meta(html));
});

// ----------------------------------------------
// Clear Cache Action
// ----------------------------------------------
app.get('/clear_cache', (req, res) => {
    const files = fs.readdirSync(cacheDir);
    files.forEach(f => {
        const p = path.join(cacheDir, f);
        // Delete both raw and final files
        if (p.endsWith('.mp4')) fs.unlinkSync(p);
    });
    cacheMap.clear();

    const html = `
        <html>
        <head><title>缓存已清理</title></head>
        <body style="font-family:monospace;">
        <h3>缓存已清理</h3>
        <p>所有缓存视频已被删除。</p>
        <a href="/">← 返回主页</a>
        </body></html>
    `;
    res.send(injectUtf8Meta(html));
});

// ----------------------------------------------
// Stream Video (No HTML response, no need for UTF-8 fix)
// ----------------------------------------------
app.get('/stream/:filename', (req, res) => {
    const filePath = path.join(cacheDir, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

    res.setHeader('Content-Type', 'video/mp4');
    // Set Content-Length header for better Progressive Download support on older browsers
    res.setHeader('Content-Length', fs.statSync(filePath).size); 
    fs.createReadStream(filePath).pipe(res);
});

// ----------------------------------------------
app.listen(port, '0.0.0.0', () => {
    console.log(`BBB-VideoStreamer v0.2.7 (UTF-8 Ready) running on http://0.0.0.0:${port}`);
});
