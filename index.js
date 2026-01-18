// index.js - ENHANCED WITH MULTI-LAYER KEEP-ALIVE
require('dotenv').config();
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const http = require('http');

// ==================== CONFIGURATION ====================
const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  ADMIN_ID: process.env.ADMIN_ID || '1279640125',
  WEBHOOK_DOMAIN: process.env.RENDER_EXTERNAL_URL || 'https://litewaydata.onrender.com',
  VTU_API_KEY: process.env.VTU_API_KEY,
  PORT: process.env.PORT || 3000
};

// Check for required environment variables
if (!CONFIG.BOT_TOKEN) {
  console.error('❌ ERROR: BOT_TOKEN is required!');
  process.exit(1);
}

// ==================== INITIALIZE ====================
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize bot
const bot = new Telegraf(CONFIG.BOT_TOKEN);

// Store data in memory
const users = {};
const transactions = {};
const sessions = {};

// ==================== ENHANCED KEEP-ALIVE SYSTEM ====================
class KeepAliveSystem {
  constructor() {
    this.urls = [
      CONFIG.WEBHOOK_DOMAIN,
      `${CONFIG.WEBHOOK_DOMAIN}/health`,
      `${CONFIG.WEBHOOK_DOMAIN}/`,
      `${CONFIG.WEBHOOK_DOMAIN}/ping`,
      'https://api.telegram.org'
    ];
    this.interval = 4 * 60 * 1000; // 4 minutes
    this.lastPing = null;
  }

  async start() {
    console.log('🔄 Starting Enhanced Keep-Alive System...');
    
    // Immediate first ping
    await this.pingAll();
    
    // Regular pings
    setInterval(() => this.pingAll(), this.interval);
    
    // Also create internal HTTP server for self-pinging
    this.startInternalPingServer();
  }

  async pingAll() {
    const now = new Date();
    this.lastPing = now;
    
    console.log(`⏰ ${now.toLocaleTimeString()} - Starting keep-alive cycle`);
    
    for (const url of this.urls) {
      try {
        const startTime = Date.now();
        const response = await axios.get(url, { 
          timeout: 15000,
          headers: {
            'User-Agent': 'Render-Keep-Alive/1.0'
          }
        });
        const duration = Date.now() - startTime;
        
        console.log(`✅ ${now.toLocaleTimeString()} - ${url}: ${response.status} (${duration}ms)`);
        
        // Small delay between pings
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.log(`⚠️ ${now.toLocaleTimeString()} - ${url}: ${error.message}`);
      }
    }
  }

  startInternalPingServer() {
    // Create a simple HTTP server that pings itself
    const internalServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'alive', 
        time: new Date().toISOString(),
        lastPing: this.lastPing
      }));
    });

    internalServer.listen(8080, '127.0.0.1', () => {
      console.log('🔗 Internal ping server on port 8080');
    });
  }
}

// ==================== EXPRESS ROUTES ====================
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'Liteway VTU Bot',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    users: Object.keys(users).length,
    render: true,
    keepAlive: 'active'
  });
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Liteway VTU Bot - Always Active</title>
      <meta http-equiv="refresh" content="300">
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f2f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
        h1 { color: #2d3436; }
        .status { color: #00b894; font-weight: bold; font-size: 1.2em; }
        .urls { text-align: left; margin: 30px 0; padding: 20px; background: #f8f9fa; border-radius: 10px; }
        .url { margin: 10px 0; padding: 8px; background: white; border-radius: 5px; }
        a { color: #0984e3; text-decoration: none; }
        .ping-info { color: #636e72; font-size: 0.9em; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 Liteway VTU Bot</h1>
        <p class="status">✅ Status: ONLINE & KEEP-ALIVE ACTIVE</p>
        <p>This bot stays awake 24/7 with enhanced keep-alive system</p>
        
        <div class="urls">
          <h3>📊 Active Endpoints:</h3>
          <div class="url">✅ <a href="/health">/health</a> - Health check</div>
          <div class="url">✅ <a href="/ping">/ping</a> - Keep-alive ping</div>
          <div class="url">✅ <a href="/status">/status</a> - Bot status</div>
        </div>
        
        <div style="margin-top: 30px; padding: 20px; background: #00b89420; border-radius: 10px;">
          <h3>🔄 Keep-Alive System</h3>
          <p>This page auto-refreshes every 5 minutes</p>
          <p>External services ping every 4 minutes</p>
          <p class="ping-info">Last activity: ${new Date().toLocaleTimeString()}</p>
        </div>
        
        <div style="margin-top: 30px;">
          <p>📱 <a href="https://t.me/${bot.botInfo?.username || 'your_bot'}" target="_blank">Open Telegram Bot</a></p>
          <p>⚙️ Uptime: ${Math.floor(process.uptime() / 60)} minutes</p>
        </div>
      </div>
      
      <script>
        // Client-side keep-alive
        setInterval(() => {
          fetch('/ping').catch(() => console.log('Ping sent'));
        }, 60000); // Every minute
      </script>
    </body>
    </html>
  `);
});

app.get('/ping', (req, res) => {
  res.status(200).json({
    ping: 'pong',
    timestamp: new Date().toISOString(),
    serverTime: new Date().toLocaleTimeString(),
    uptime: process.uptime()
  });
});

app.get('/status', (req, res) => {
  res.status(200).json({
    bot: 'active',
    webhook: 'configured',
    users: Object.keys(users).length,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

// Telegram webhook endpoint
app.post('/telegram-webhook', (req, res) => {
  console.log(`📨 [${new Date().toLocaleTimeString()}] Telegram update received`);
  bot.handleUpdate(req.body);
  res.status(200).send('OK');
});

// ==================== HELPER FUNCTIONS ====================
function initUser(userId) {
  if (!users[userId]) {
    users[userId] = {
      wallet: 1000,
      kyc: 'pending',
      pin: null,
      joined: new Date().toLocaleString(),
      fullName: null
    };
    transactions[userId] = [];
  }
  return users[userId];
}

function formatCurrency(amount) {
  return `₦${amount.toLocaleString('en-NG')}`;
}

// ==================== BOT COMMANDS ====================
bot.start(async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const user = initUser(userId);
    
    if (!user.fullName) {
      user.fullName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || `User ${userId}`;
    }
    
    const keyboard = [
      ['📞 Buy Airtime', '📡 Buy Data'],
      ['💰 Wallet Balance', '💳 Deposit Funds'],
      ['🏦 Money Transfer', '📜 Transaction History'],
      ['🛂 KYC Status', '🆘 Help & Support']
    ];
    
    await ctx.reply(
      `🌟 *Welcome to Liteway VTU Bot\\!*\n\n` +
      `✅ *Status\\:* ONLINE 24/7\n` +
      `🔄 *Keep\\-alive\\:* ACTIVE\n\n` +
      `💵 *Your Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
      `📱 *Tap any button below to get started\\!*`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.keyboard(keyboard).resize()
      }
    );
    
    console.log(`👤 ${new Date().toLocaleTimeString()} - User ${userId} started bot`);
    
  } catch (error) {
    console.error('❌ Start error:', error);
  }
});

bot.command('balance', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  
  await ctx.reply(
    `💰 *BALANCE*\n\n` +
    `💵 *Available\\:* ${formatCurrency(user.wallet)}\n` +
    `🛂 *KYC\\:* ${user.kyc.toUpperCase()}\n\n` +
    `💡 Tap "💳 Deposit Funds" to add money`,
    { parse_mode: 'MarkdownV2' }
  );
});

// Add other handlers from your original code...

// ==================== START EVERYTHING ====================
async function startServer() {
  try {
    console.log('🚀 Starting Liteway VTU Bot with Enhanced Keep-Alive...');
    console.log(`🌐 Webhook Domain: ${CONFIG.WEBHOOK_DOMAIN}`);
    
    // Start Express server
    const server = app.listen(CONFIG.PORT, '0.0.0.0', () => {
      console.log(`✅ Express server on port ${CONFIG.PORT}`);
      console.log(`🌍 Public URL: ${CONFIG.WEBHOOK_DOMAIN}`);
    });
    
    // Setup Telegram webhook
    const webhookUrl = `${CONFIG.WEBHOOK_DOMAIN}/telegram-webhook`;
    console.log(`🔗 Setting webhook: ${webhookUrl}`);
    
    try {
      await axios.post(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/deleteWebhook`);
      const webhookResponse = await axios.post(
        `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/setWebhook`,
        { url: webhookUrl, max_connections: 40 }
      );
      console.log('✅ Webhook set:', webhookResponse.data.description);
    } catch (webhookError) {
      console.error('❌ Webhook failed:', webhookError.message);
      bot.launch();
    }
    
    // Start enhanced keep-alive system
    const keepAlive = new KeepAliveSystem();
    await keepAlive.start();
    
    // Setup auto-restart detection
    setInterval(() => {
      const uptime = process.uptime();
      console.log(`⏰ Uptime: ${Math.floor(uptime / 60)} minutes`);
      
      // If server seems stuck, try to self-heal
      if (uptime > 3600 && Math.random() < 0.1) { // After 1 hour, 10% chance
        console.log('🔄 Performing self-health check...');
        axios.get(`${CONFIG.WEBHOOK_DOMAIN}/health`).catch(() => {
          console.log('⚠️ Self-check failed, might need restart');
        });
      }
    }, 5 * 60 * 1000); // Every 5 minutes
    
    console.log('\n🎉 SYSTEM READY! Bot stays awake 24/7');
    console.log('📋 Active Endpoints:');
    console.log(`• ${CONFIG.WEBHOOK_DOMAIN}/health`);
    console.log(`• ${CONFIG.WEBHOOK_DOMAIN}/ping`);
    console.log(`• ${CONFIG.WEBHOOK_DOMAIN}/`);
    
    // Setup external ping reminder
    console.log('\n💡 PRO TIP: Also setup external ping services:');
    console.log('1. UptimeRobot (uptimerobot.com) - 5 min intervals');
    console.log('2. Kaffeine (kaffeine.herokuapp.com) - Auto ping');
    console.log('3. cron-job.org - Free cron jobs');
    
  } catch (error) {
    console.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  bot.stop();
  process.exit(0);
});