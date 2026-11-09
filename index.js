const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const axios = require('axios');
const express = require('express');
const pino = require('pino');
const readline = require('readline');

// Express health-check server to keep Render awake
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('WhatsApp Gemini Bot is running!');
});

app.listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

async function startWhatsAppBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['Ubuntu', 'Chrome', '22.04.4']
  });

  sock.ev.on('creds.update', saveCreds);

  // Pairing code logic with a fresh timer so you have enough time
  if (!sock.authState.creds.registered) {
    const phoneNumber = "923147941846"; 
    
    // 10 seconds ka delay taake server poori tarah ready ho jaye aur aapke paas time ho
    setTimeout(async () => {
      try {
        console.log("\nRequesting fresh pairing code...");
        let code = await sock.requestPairingCode(phoneNumber);
        code = code?.match(/.{1,4}/g)?.join("-") || code;
        console.log(`\n========================================`);
        console.log(`YOUR FRESH WHATSAPP PAIRING CODE: ${code}`);
        console.log(`========================================\n`);
      } catch (err) {
        console.error("Error requesting pairing code:", err);
      }
    }, 10000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
      if (shouldReconnect) {
        startWhatsAppBot();
      }
    } else if (connection === 'open') {
      console.log('Bot successfully connected to WhatsApp!');
    }
  });

  // Handle incoming messages & Gemini AI integration
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;

    if (!textMessage) return;

    console.log(`Received message from ${sender}: ${textMessage}`);

    try {
      const response = await axios.post(GEMINI_URL, {
        contents: [{ parts: [{ text: textMessage }] }]
      });

      const replyText = response.data.candidates[0].content.parts[0].text;

      await sock.sendMessage(sender, { text: replyText });
    } catch (error) {
      console.error('Error communicating with Gemini API:', error);
      await sock.sendMessage(sender, { text: 'Sorry, I encountered an error processing your request.' });
    }
  });
}

startWhatsAppBot();
