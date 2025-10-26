// ==============================================
// BBB-VideoStreamer v0.2.7
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

const cacheMap = new Map(); // videoId => { filePath, title }

app.use(express.urlencoded({ extended: true }));

// ----------------------------------------------
// Home page
// ----------------------------------------------
app.get('/', (req, res) => {
    res.send(`
        <html><body style="font-family:monospace;">
        <h3>BBB-VideoStreamer</h3>
        <form action="/download" method="get">
            <label>Enter Bilibili Video URL:</label><br>
            <input type="text" name="url" size="60"><br><br>
            <input type="submit" value="Download & Stream">
        </form>
        <hr>
        <a href="/list">View Cached Videos</a> |
        <a href="/confirm_clear">Clear Cache</a>
        </body></html>
    `);
});

// ----------------------------------------------
// Download + Transcode Handler
// ----------------------------------------------
app.get('/download', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.send('No URL provided.');

    const videoId = crypto.createHash('md5').update(videoUrl).digest('hex');
    const cached = cacheMap.get(videoId);
    if (cached && fs.existsSync(cached.filePath)) {
        console.log(`[Cache] Hit for ${videoUrl}`);
        return res.redirect(`/watch?file=${path.basename(cached.filePath)}`);
    }

    res.send(`
        <html><body style="font-family:monospace;">
        <p>[Server] Processing your request... Please wait.</p>
        <meta http-equiv="refresh" content="3;url=/status?id=${videoId}">
        </body></html>
    `);

    const outputPath = path.join(cacheDir, `${videoId}_raw.mp4`);
    const ytArgs = ['-f', 'bv*[height<=360]+ba/b[height<=360]', '-o', outputPath, videoUrl];
    console.log(`[Download] yt-dlp ${ytArgs.join(' ')}`);

    const ytdlp = spawn('yt-dlp', ytArgs);
    ytdlp.stdout.on('data', d => process.stdout.write(d.toString()));
    ytdlp.stderr.on('data', d => process.stdout.write(d.toString()));

    ytdlp.on('close', code => {
        if (code !== 0) {
            console.error(`[Error] yt-dlp exited with code ${code}`);
            return;
        }

        const finalPath = path.join(cacheDir, `${videoId}_final.mp4`);
        const ffmpegArgs = [
            '-i', outputPath,
            '-vf', "scale='if(gt(a,4/3),320,-2)':'if(gt(a,4/3),-2,240)',pad=320:240:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p",
            '-metadata:s:v:0', 'rotate=90',
            '-vcodec', 'libx264', '-profile:v', 'baseline',
            '-preset', 'veryfast', '-crf', '28',
            '-acodec', 'aac', '-ar', '44100', '-b:a', '96k',
            '-movflags', '+faststart',
            '-y', finalPath
        ];

        console.log(`[FFmpeg] Transcoding ${outputPath} -> ${finalPath}`);
        const ffmpeg = spawn('ffmpeg', ffmpegArgs);
        ffmpeg.stdout.on('data', d => process.stdout.write(d.toString()));
        ffmpeg.stderr.on('data', d => process.stdout.write(d.toString()));

        ffmpeg.on('close', c => {
            if (c === 0) {
                cacheMap.set(videoId, { filePath: finalPath, title: videoUrl });
                fs.unlinkSync(outputPath);
                console.log(`[Cache] Added ${finalPath}`);
            } else {
                console.error(`[Error] ffmpeg exited with code ${c}`);
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
        res.send(`
            <html><body style="font-family:monospace;">
            <p>[Server] Still processing video...</p>
            <meta http-equiv="refresh" content="5;url=/status?id=${videoId}">
            </body></html>
        `);
    }
});

// ----------------------------------------------
// Watch Page
// ----------------------------------------------
app.get('/watch', (req, res) => {
    const file = req.query.file;
    const filePath = path.join(cacheDir, file);
    if (!fs.existsSync(filePath)) return res.send('Video not found.');

    res.send(`
        <html><body style="font-family:monospace;">
        <h3>BBB-VideoStreamer Player</h3>
        <a href="/stream/${file}">▶ Play in BlackBerry Player</a><br><br>
        <a href="/list">← Back to Cached List</a>
        </body></html>
    `);
});

// ----------------------------------------------
// List Cached Videos
// ----------------------------------------------
app.get('/list', (req, res) => {
    const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('_final.mp4'));
    const list = files.map(f => {
        const title = Array.from(cacheMap.values()).find(v => path.basename(v.filePath) === f)?.title || f;
        return `<li><a href="/watch?file=${f}">${title}</a></li>`;
    }).join('');

    res.send(`
        <html><body style="font-family:monospace;">
        <h3>Cached Videos</h3>
        <ul>${list || '<li>No cached videos yet.</li>'}</ul>
        <a href="/">← Back to Home</a> |
        <a href="/confirm_clear">Clear Cache</a>
        </body></html>
    `);
});

// ----------------------------------------------
// Clear Cache Confirmation Page
// ----------------------------------------------
app.get('/confirm_clear', (req, res) => {
    res.send(`
        <html><body style="font-family:monospace;">
        <h3>Confirm Cache Clearing</h3>
        <p>This will delete all cached videos permanently.</p>
        <a href="/clear_cache">Yes, clear all cache</a> |
        <a href="/">Cancel</a>
        </body></html>
    `);
});

// ----------------------------------------------
// Clear Cache Action
// ----------------------------------------------
app.get('/clear_cache', (req, res) => {
    const files = fs.readdirSync(cacheDir);
    files.forEach(f => {
        const p = path.join(cacheDir, f);
        if (p.endsWith('.mp4')) fs.unlinkSync(p);
    });
    cacheMap.clear();

    res.send(`
        <html><body style="font-family:monospace;">
        <h3>Cache Cleared</h3>
        <p>All cached videos have been deleted.</p>
        <a href="/">← Back to Home</a>
        </body></html>
    `);
});

// ----------------------------------------------
// Stream Video
// ----------------------------------------------
app.get('/stream/:filename', (req, res) => {
    const filePath = path.join(cacheDir, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

    res.setHeader('Content-Type', 'video/mp4');
    fs.createReadStream(filePath).pipe(res);
});

// ----------------------------------------------
app.listen(port, '0.0.0.0', () => {
    console.log(`BBB-VideoStreamer v1.4 running on http://0.0.0.0:${port}`);
});