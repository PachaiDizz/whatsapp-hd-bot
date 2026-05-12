const http = require('http');
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');

const ACCOUNT_SID = 'AC52a45e18747ad646fcbf4d68ab692f92';
const AUTH_TOKEN = '2ede88d87bba9b92ebf1f1cb86218714';
const FROM_NUMBER = 'whatsapp:+14155238886';
const PORT = process.env.PORT || 10000;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

console.log('🤖 Bot started!\n');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'GET') {
    res.writeHead(200);
    res.end('Bot running');
    return;
  }

  if (req.method === 'POST' && req.url === '/upload') {
    let phone = '';
    let fileName = '';
    const chunks = [];

    const busboy = Busboy({ headers: req.headers });
    
    busboy.on('field', (name, val) => {
      if (name === 'phone') phone = val;
    });

    busboy.on('file', (name, file, info) => {
      fileName = info.filename;
      file.on('data', (data) => chunks.push(data));
      file.on('end', () => {});
    });

    busboy.on('finish', async () => {
      try {
        const videoData = Buffer.concat(chunks);
        console.log(`📤 Received: ${fileName} (${videoData.length} bytes)`);
        console.log(`📤 Phone: ${phone}`);

        // Send text first
        const msg = await client.messages.create({
          from: FROM_NUMBER,
          to: `whatsapp:+${phone}`,
          body: '🎥 HD Video ready! Forward this to your Status.',
        });

        console.log('✅ Message sent! SID:', msg.sid);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'sent', sid: msg.sid }));

      } catch (err) {
        console.error('❌ Error:', err.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', error: err.message }));
      }
    });

    req.pipe(busboy);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
