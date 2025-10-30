# BBB-VideoStreamer

A server tool for playing Bilibili videos online on BlackBerry 9900 and other BlackBerry OS7 devices using HTTP media streaming. (You can use Termux for Android or other Linux distributions, but currently only the Android version of Termux is available.)

No need to download videos to your BlackBerry, you can just play videos directly on your BlackBerry 9900 device without taking up too much storage space.Just like Bilibili on other platforms, you can watch online videos.

Technically, HTTP media streaming is used to push media to BlackBerry for playback.

I would like to thank Socialsisteryi for collecting the Bilibili API. Here is his repository: https://socialsisteryi.github.io/bilibili-API-collect/

🛠️ Termux Environment Setup Steps
Please follow these steps to set up Termux on your Android phone to deploy the script.

Step 1: Install the core runtime environment

First, update the Termux package list and install Node.js.

# 1. Update package list

pkg update -y

# 2. Install Node.js (including npm)

pkg install nodejs -y

Step 2: Install video processing tools

The script relies on ffmpeg for video transcoding and yt-dlp to obtain Bilibili video streams.

# 1. Install Python (yt-dlp dependency) and FFmpeg

pkg install python ffmpeg -y

# 2. Install yt-dlp (recommended)

pip install yt-dlp

You can create a new folder to store the script files, such as "bb-video-server".

Place the server files: Upload your latest script file (e.g., server-0.4.0.js) to this bb-video-server directory.

(If you have network access on Termux, you can use wget or curl to download it, or use termux-setup-storage and then copy it via a file manager.)

Install Node.js dependencies: 
This script code primarily depends on the express framework.

npm install express

Step 4: Run the server

Once everything is ready, use Node.js to start your server script.

node server-0.4.0.js

Step 5: Access on your Blackberry phone

After the server starts, you will see a message similar to the following in Termux (this is the output of the server-0.4.0.js script):

=======================================================
  BBB-VideoStreamer v0.4.0
  服务器正在运行!
  请在黑莓浏览器中访问: http://192.168.x.x:3000
=======================================================

To check your IP address: Please note the IP address displayed in the output (e.g., 192.168.x.x). This address is your phone's address on the local area network.

BlackBerry Access: On your BlackBerry phone (or any device that needs to play videos), enter the full address and port number in your browser to access the site.

For example: http://[your mobile phone IP address]:3000

Note: Both devices must be connected to the same Wi-Fi network to access each other. If your Android phone uses a firewall or VPN, you may need to adjust the settings to allow external devices to access port 3000.

⚠️ Regarding Authentication and WBI Signatures

As mentioned before, to reliably obtain Bilibili video streams, especially anime (PGC) and high-definition videos, you may need to implement complex WBI signatures in your code or provide a Bilibili account cookie (SESSDATA). If you encounter download or playback failures (such as error 412 or -1), it is usually due to a lack of valid authentication information.



Small note: Of the three "B"s in the name, the first two stand for BlackBerry, and the third one stands for Bilibili.

For learning and testing purposes only. Illegal/abusive use is prohibited.
