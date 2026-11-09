const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

// 1. Express Server to keep Render active 24/7
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('WhatsApp Gemini Bot is active and running!');
});

app.listen(PORT, () => {
    console.log(`Health check server running on port ${PORT}`);
});

// 2. WhatsApp Bot Logic with Baileys & Gemini API
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('--- SCAN THIS QR CODE WITH WHATSAPP ---');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log('Client logged out. Delete auth_info_baileys and restart.');
            }
        } else if (connection === 'open') {
            console.log('WhatsApp Bot is connected successfully with Gemini!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const messageType = Object.keys(m.message)[0];
        let text = '';
        if (messageType === 'conversation') {
            text = m.message.conversation;
        } else if (messageType === 'extendedTextMessage') {
            text = m.message.extendedTextMessage.text;
        }

        // Bot Trigger: Message must start with "!ai "
        if (text && text.startsWith('!ai ')) {
            const userPrompt = text.replace('!ai ', '').trim();
            const senderID = m.key.remoteJid;

            console.log(`Received prompt: ${userPrompt}`);

            try {
                // Gemini API Request
                const response = await axios.post(
                    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
                    {
                        contents: [
                            {
                                parts: [
                                    { text: userPrompt }
                                ]
                            }
                        ]
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-goog-api-key': process.env.GEMINI_API_KEY
                        }
                    }
                );

                const aiReply = response.data.candidates[0].content.parts[0].text;
                await sock.sendMessage(senderID, { text: aiReply }, { quoted: m });
            } catch (error) {
                console.error('Gemini API Error:', error?.response?.data || error.message);
                await sock.sendMessage(senderID, { text: 'Sorry, AI response error occurred.' }, { quoted: m });
            }
        }
    });
}

connectToWhatsApp();
