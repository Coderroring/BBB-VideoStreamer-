/*
 * Project: BBB-videotransformer
 * Author: Coderroring
 * Description: Node.js server to convert Bilibili videos into BlackBerry 9900 compatible format 
 * (H.264 Baseline Profile 320x240) using yt-dlp and ffmpeg, with asynchronous processing 
 * to prevent BlackBerry browser timeout.
 */

const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// Output paths
const tempVideoPath = path.join(__dirname, 'temp_download.mp4');
const finalVideoPath = path.join(__dirname, 'bb_video.mp4');

// State management for the asynchronous job
let currentTask = {
    id: null,
    status: 'idle', // idle, downloading, converting, complete, failed
    url: null,
    startTime: null,
    progress: 0, 
    error: null
};

// Serve static files
app.use(express.static(__dirname));

/**
 * Clears old files and resets the task state.
 * This is now wrapped in a function for reuse in /clear_cache.
 */
function resetTaskAndClearFiles() {
    if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
    if (fs.existsSync(finalVideoPath)) fs.unlinkSync(finalVideoPath);
    currentTask = {
        id: null,
        status: 'idle',
        url: null,
        startTime: null,
        progress: 0,
        error: null
    };
    console.log("[Cache] Server cache and state cleared.");
}

/**
 * Converts a video file to a BlackBerry 9900 compatible format.
 */
function convertVideo(inputPath, outputPath, jobId) {
    currentTask.status = 'converting';
    currentTask.progress = 50;
    
const ffmpegArgs = [
    '-i', inputPath,
    '-vf',
    "scale='if(gt(a,4/3),320,-2)':'if(gt(a,4/3),-2,240)',pad=320:240:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p",
    '-metadata:s:v:0', 'rotate=90', // 对竖版视频标记旋转
    '-vcodec', 'libx264',
    '-profile:v', 'baseline',
    '-preset', 'veryfast',
    '-crf', '28',
    '-acodec', 'aac',
    '-ar', '44100',
    '-b:a', '96k',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-y',
    outputPath
];

    console.log(`[Job ${jobId}] Starting FFmpeg conversion...`);
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    ffmpeg.stderr.on('data', (data) => {
        // FFmpeg writes progress info to stderr, which is normal.
        console.error(`[FFmpeg] ${data}`);
    });

    ffmpeg.on('close', (code) => {
        // Cleanup temp file regardless of success
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);

        if (code === 0) {
            currentTask.status = 'complete';
            currentTask.progress = 100;
            console.log(`[Job ${jobId}] Conversion successful.`);
        } else {
            currentTask.status = 'failed';
            currentTask.error = `FFmpeg failed with code ${code}`;
            console.error(`[Job ${jobId}] Conversion failed.`);
        }
    });
}

/**
 * Starts the yt-dlp download process.
 */
function startDownload(videoUrl, jobId) {
    currentTask.status = 'downloading';
    currentTask.url = videoUrl;
    
    // Use height filter for robustness
    const ytFormat = 'bestvideo[height<=480]+bestaudio/best[height<=480]/best';
    
    console.log(`[Job ${jobId}] Starting yt-dlp for ${videoUrl} with format: ${ytFormat}`);

    const yt = spawn('yt-dlp', [
        '-f', ytFormat,
        '--no-playlist',
        '-o', tempVideoPath,
        videoUrl
    ]);

    yt.stderr.on('data', (data) => {
        const dataStr = data.toString();
        // Update simple progress for downloading phase
        if (dataStr.includes('% of')) {
            const match = dataStr.match(/(\d+\.\d+)% of/);
            if (match) {
                currentTask.progress = Math.min(49, Math.floor(parseFloat(match[1]) * 0.5)); 
            }
        }
        console.error(`[Download] ${dataStr}`);
    });

    yt.on('close', (code) => {
        if (code === 0) {
            console.log(`[Job ${jobId}] Download finished.`);
            // Move to conversion stage
            convertVideo(tempVideoPath, finalVideoPath, jobId);
        } else {
            currentTask.status = 'failed';
            currentTask.error = `Download failed with code ${code}. Check server logs.`;
            // Cleanup temp file
            if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
            console.error(`[Job ${jobId}] Download failed.`);
        }
    });
}

// Route to start the download and conversion job
app.get('/start_job', (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) {
        return res.send('Please provide a video URL, e.g. /start_job?url=...');
    }
    
    // Prevent starting a new job if one is already running
    if (currentTask.status !== 'idle' && currentTask.status !== 'complete' && currentTask.status !== 'failed') {
        return res.redirect('/status');
    }
    
    // Generate new job ID and reset state
    resetTaskAndClearFiles();
    const jobId = crypto.randomBytes(4).toString('hex');
    currentTask.id = jobId;
    currentTask.startTime = Date.now();
    
    // Start the process asynchronously
    startDownload(videoUrl, jobId);

    // CRITICAL: Immediately redirect the browser to the status page to avoid timeout
    res.redirect(`/status?id=${jobId}`);
});

// Route for the status page (BlackBerry browser will poll this)
app.get('/status', (req, res) => {
    const status = currentTask.status;
    const progress = currentTask.progress;
    
    let content;

    if (status === 'complete') {
        // Job is finished, redirect to stream!
        content = `
            <meta http-equiv="refresh" content="1; url=/stream">
            <h3>Conversion Complete!</h3>
            <p>Redirecting to stream...</p>
        `;
    } else if (status === 'failed') {
        // Job failed
        content = `
            <h3>Job Failed!</h3>
            <p>Error: ${currentTask.error || 'Unknown error'}</p>
            <p><a href="/">Start New Job</a></p>
        `;
    } else if (status !== 'idle' && currentTask.id) {
        // Job is running (downloading or converting) - show progress and auto-refresh
        const elapsed = Math.round((Date.now() - currentTask.startTime) / 1000);
        
        content = `
            <meta http-equiv="refresh" content="5"> <h3>Processing Video...</h3>
            <p>Status: ${status.toUpperCase()}</p>
            <p>Progress: ${progress}%</p>
            <p>Elapsed Time: ${elapsed} seconds</p>
            <p>Please wait. Do NOT close this tab. The page will update automatically.</p>
        `;
    } else {
        // No active job found or task is idle
        content = `
            <h3>No Active Job</h3>
            <p><a href="/">Start a new download</a></p>
        `;
    }
    
    res.send(`
        <html>
            <head><title>BlackBerry Status</title></head>
            <body>${content}</body>
        </html>
    `);
});

// NEW ROUTE: Clears the server cache and redirects to the homepage
app.get('/clear_cache', (req, res) => {
    resetTaskAndClearFiles();
    res.send(`
        <html>
            <head><title>Cache Cleared</title></head>
            <body>
                <h3>Server Cache Cleared!</h3>
                <p>The previous video file has been deleted.</p>
                <p><a href="/">Go to Home</a></p>
            </body>
        </html>
    `);
});


// Route to stream video via HTTP (BlackBerry compatible)
app.get('/stream', (req, res) => {
    if (!fs.existsSync(finalVideoPath) || currentTask.status !== 'complete') {
        return res.send('Video not available or conversion incomplete. Please start a job first.');
    }

    // Set content type for video/mp4 (Progressive Download)
    res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': fs.statSync(finalVideoPath).size
    });

    const readStream = fs.createReadStream(finalVideoPath);
    readStream.pipe(res);
});

// Homepage: simple HTML to input Bilibili URL
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>BBB-videotransformer</title></head>
            <body>
                <h2>Download Bilibili Video for BlackBerry 9900</h2>
                <form action="/start_job" method="get">
                    <input type="text" name="url" placeholder="Paste Bilibili video URL" style="width:300px;">
                    <button type="submit">Start Download & Convert</button>
                </form>
                <hr>
                <p>
                    <a href="/clear_cache">Clear Server Cache</a>
                </p>
                <p style="font-size: small;">Project: BBB-videotransformer | Author: Coderroring</p>
            </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});
