const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Output path for video
const videoPath = path.join(__dirname, 'video.mp4');

// Serve static files (for the webpage)
app.use(express.static(__dirname));

// Route to download and convert Bilibili video
app.get('/download', (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.send('Please provide a video URL, e.g. /download?url=...');
  }

  // If a previous video exists, delete it
  if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

  // Spawn yt-dlp to download 360p video (dynamic format selection)
  const yt = spawn('yt-dlp', [
    '-f', 'bestvideo[height<=360]+bestaudio/best[height<=360]/best',
    '--no-playlist',
    '-o', videoPath,
    videoUrl
  ]);

  yt.stdout.on('data', (data) => {
    console.log(`[Download] ${data}`);
  });

  yt.stderr.on('data', (data) => {
    console.error(`[Download] ${data}`);
  });

  yt.on('close', (code) => {
    if (code === 0) {
      console.log('Download finished, ready for streaming.');
      res.send(`
        <html>
          <head><title>BlackBerry Video</title></head>
          <body>
            <h3>Video Download Complete</h3>
            <a href="/stream" target="_blank">Click to Play Video</a>
            <p>Note: It will open in BlackBerry native player if supported.</p>
          </body>
        </html>
      `);
    } else {
      res.send(`Download failed with code ${code}`);
    }
  });
});

// Route to stream video via HTTP (BlackBerry compatible)
app.get('/stream', (req, res) => {
  if (!fs.existsSync(videoPath)) {
    return res.send('Video not available, please download first.');
  }

  // Set content type for video/mp4
  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Content-Length': fs.statSync(videoPath).size
  });

  const readStream = fs.createReadStream(videoPath);
  readStream.pipe(res);
});

// Homepage: simple HTML to input Bilibili URL
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>BlackBerry Video Downloader</title></head>
      <body>
        <h2>Download Bilibili Video for BlackBerry 9900</h2>
        <form action="/download" method="get">
          <input type="text" name="url" placeholder="Paste Bilibili video URL" style="width:300px;">
          <button type="submit">Download & Prepare for Streaming</button>
        </form>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});