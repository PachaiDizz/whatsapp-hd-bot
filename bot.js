const http = require('http');
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');

const ACCOUNT_SID = 'AC52a45e18747ad646fcbf4d68ab692f92';
const AUTH_TOKEN = '2ede88d87bba9b92ebf1f1cb86218714';
const FROM_NUMBER = 'whatsapp:+14155238886';
const PORT = process.env.PORT || 10000;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

console.log('🤖 Bot started!\n');

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot running');
    return;
  }

  if (req.method === 'POST' && req.url === '/upload') {
    // Parse multipart form data
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const contentType = req.headers['content-type'];
        const boundary = contentType.split('boundary=')[1];
        
        // Simple multipart parser
        const parts = buffer.toString().split('--' + boundary);
        
        let phone = '';
        let videoData = null;
        let videoName = 'video.mp4';
        
        for (const part of parts) {
          if (part.includes('name="phone"')) {
            const match = part.match(/\r\n\r\n(.+?)\r\n$/s);
            if (match) phone = match[1].trim();
          }
          if (part.includes('name="video"')) {
            const match = part.match(/filename="(.+?)"/);
            if (match) videoName = match[1];
            const dataMatch = part.match(/\r\n\r\n([\s\S]*?)\r\n$/);
            if (dataMatch) videoData = Buffer.from(dataMatch[1].trim(), 'binary');
          }
        }

        if (!phone || !videoData) {
          res.writeHead(400);
          res.end('Missing phone or video');
          return;
        }

        // Save file temporarily
        const tempPath = path.join('/tmp', videoName);
        fs.writeFileSync(tempPath, videoData);

        console.log(`📤 Sending to whatsapp:+${phone}...`);

        // Send via Twilio
        const url = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/download/${videoName}`;
        
        // Since we can't upload directly to a public URL, use a base64 data URL approach
        // Or simply send the file via Twilio's mediaUrl
        
        // For now, just log and confirm
        const msg = await client.messages.create({
          from: FROM_NUMBER,
          to: `whatsapp:+${phone}`,
          body: '🎥 Your HD video is ready!',
        });

        console.log('✅ Message sent! SID:', msg.sid);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'sent', sid: msg.sid }));

      } catch (err) {
        console.error('❌ Error:', err.message);
        res.writeHead(500);
        res.end(err.message);
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

