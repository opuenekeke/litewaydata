// index.js - MAIN ENTRY POINT (WEBHOOK VERSION FOR RENDER)
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const crypto = require('crypto');
const express = require('express');

// Import the modular components
const buyAirtime = require('./app/buyAirtime');
const buyData = require('./app/buyData');
const depositFunds = require('./app/depositFunds');
const walletBalance = require('./app/walletBalance');
const transactionHistory = require('./app/transactionHistory');
const admin = require('./app/admin');
const kyc = require('./app/kyc');

// ==================== CONFIGURATION ====================
const CONFIG = {
  VTU_API_KEY: process.env.VTU_API_KEY || 'your_vtu_naija_api_key_here',
  VTU_BASE_URL: 'https://vtunaija.com.ng/api',
  ADMIN_ID: process.env.ADMIN_ID || '1279640125',
  SERVICE_FEE: 100,
  MIN_AIRTIME: 50,
  MAX_AIRTIME: 50000,
  MONNIFY_ENABLED: process.env.MONNIFY_API_KEY ? true : false,
  MONNIFY_API_KEY: process.env.MONNIFY_API_KEY,
  MONNIFY_SECRET_KEY: process.env.MONNIFY_SECRET_KEY,
  MONNIFY_CONTRACT_CODE: process.env.MONNIFY_CONTRACT_CODE,
  MONNIFY_BASE_URL: process.env.MONNIFY_BASE_URL || 'https://sandbox.monnify.com',
  MONNIFY_WEBHOOK_SECRET: process.env.MONNIFY_WEBHOOK_SECRET,
  BANK_TRANSFER_ENABLED: process.env.BANK_TRANSFER_API_KEY ? true : false,
  // Your Render URL
  WEBHOOK_DOMAIN: process.env.RENDER_EXTERNAL_URL || 'https://litewaydata.onrender.com',
  BOT_TOKEN: process.env.BOT_TOKEN
};

// Global data storage
const users = {};
const transactions = {};
const sessions = {};
const virtualAccounts = {};

// Network mapping
const NETWORK_CODES = {
  'MTN': '1',
  'GLO': '2',
  '9MOBILE': '3',
  'AIRTEL': '4'
};

// ==================== INITIALIZE EXPRESS ====================
const app = express();
app.use(express.json());

// Health check endpoints
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    service: 'Liteway VTU Bot',
    timestamp: new Date().toISOString(),
    webhook: CONFIG.WEBHOOK_DOMAIN
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    users: Object.keys(users).length
  });
});

// Test endpoint
app.get('/test', (req, res) => {
  res.status(200).json({ 
    message: 'Bot is working!',
    url: CONFIG.WEBHOOK_DOMAIN,
    time: new Date().toISOString()
  });
});

// ==================== HELPER FUNCTIONS ====================
function initUser(userId) {
  if (!users[userId]) {
    users[userId] = {
      wallet: 0,
      kyc: 'pending',
      pin: null,
      pinAttempts: 0,
      pinLocked: false,
      joined: new Date().toLocaleString(),
      email: null,
      phone: null,
      fullName: null,
      bvn: null,
      bvnVerified: false,
      bvnSubmittedAt: null,
      bvnVerifiedAt: null,
      bvnVerifiedBy: null,
      virtualAccount: null,
      virtualAccountNumber: null,
      virtualAccountBank: null,
      dailyDeposit: 0,
      dailyTransfer: 0,
      lastDeposit: null,
      lastTransfer: null
    };
    transactions[userId] = [];
  }
  return users[userId];
}

function isAdmin(userId) {
  return userId.toString() === CONFIG.ADMIN_ID.toString();
}

function formatCurrency(amount) {
  return `₦${amount.toLocaleString('en-NG')}`;
}

function escapeMarkdown(text) {
  if (typeof text !== 'string') return text;
  const specialChars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
  let escapedText = text;
  specialChars.forEach(char => {
    const regex = new RegExp(`\\${char}`, 'g');
    escapedText = escapedText.replace(regex, `\\${char}`);
  });
  return escapedText;
}

function isValidEmail(email) {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// ==================== SETUP BOT ====================
console.log('🤖 Initializing Telegram Bot...');

// Check if bot token is available
if (!CONFIG.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is not set in environment variables!');
  console.error('Please set BOT_TOKEN in Render environment variables');
  process.exit(1);
}

const bot = new Telegraf(CONFIG.BOT_TOKEN);

// ==================== BOT COMMANDS ====================
bot.start(async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const user = initUser(userId);
    const isUserAdmin = isAdmin(userId);
    
    if (!user.fullName) {
      user.fullName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || `User ${userId}`;
    }
    
    let keyboard;
    
    if (isUserAdmin) {
      keyboard = [
        ['📞 Buy Airtime', '📡 Buy Data'],
        ['💰 Wallet Balance', '💳 Deposit Funds'],
        ['🏦 Money Transfer', '📜 Transaction History'],
        ['🛂 KYC Status', '🛠️ Admin Panel'],
        ['🆘 Help & Support']
      ];
    } else {
      keyboard = [
        ['📞 Buy Airtime', '📡 Buy Data'],
        ['💰 Wallet Balance', '💳 Deposit Funds'],
        ['🏦 Money Transfer', '📜 Transaction History'],
        ['🛂 KYC Status', '🆘 Help & Support']
      ];
    }
    
    let bvnStatus = '';
    let emailStatus = '';
    
    if (CONFIG.MONNIFY_ENABLED) {
      if (!user.email || !isValidEmail(user.email)) {
        emailStatus = `\n📧 *Email Status\\:* ❌ NOT SET\n` +
          `_Set email via deposit process for virtual account_`;
      } else {
        emailStatus = `\n📧 *Email Status\\:* ✅ SET`;
      }
      
      if (!user.bvn) {
        bvnStatus = `\n🆔 *BVN Status\\:* ❌ NOT SUBMITTED\n` +
          `_Submit BVN via deposit process to get virtual account_`;
      } else if (!user.bvnVerified) {
        bvnStatus = `\n🆔 *BVN Status\\:* ⏳ UNDER REVIEW\n` +
          `_Your BVN is being verified by our security team_`;
      } else {
        bvnStatus = `\n🆔 *BVN Status\\:* ✅ VERIFIED`;
      }
    }
    
    await ctx.reply(
      `🌟 *Welcome to Liteway VTU Bot\\!*\n\n` +
      `⚡ *Quick Start\\:*\n` +
      `1\\. Set PIN\\: /setpin 1234\n` +
      `2\\. Get KYC approved\n` +
      `3\\. Set email & submit BVN\n` +
      `4\\. Deposit funds\n` +
      `5\\. Start buying\\!\n\n` +
      `📱 *Services\\:*\n` +
      `• 📞 Airtime \\(All networks\\)\n` +
      `• 📡 Data bundles\n` +
      `• 💰 Wallet system\n` +
      `• 💳 Deposit via Virtual Account\n` +
      `• 🏦 Transfer to any bank\n\n` +
      `${emailStatus}` +
      `${bvnStatus}\n\n` +
      `📞 *Support\\:* @opuenekeke`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.keyboard(keyboard).resize()
      }
    );
    
    console.log(`👤 User ${userId} started the bot`);
    
  } catch (error) {
    console.error('❌ Start error:', error);
  }
});

// Add other command handlers (simplified for example)
bot.command('balance', async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const user = initUser(userId);
    
    await ctx.reply(
      `💰 *YOUR BALANCE*\n\n` +
      `💵 *Available\\:* ${formatCurrency(user.wallet)}\n` +
      `🛂 *KYC Status\\:* ${user.kyc.toUpperCase()}\n\n` +
      `💡 Need more funds\\? Use "💳 Deposit Funds" button`,
      { parse_mode: 'MarkdownV2' }
    );
    
  } catch (error) {
    console.error('❌ Balance error:', error);
  }
});

bot.command('setpin', async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const user = initUser(userId);
    const args = ctx.message.text.split(' ');
    
    if (args.length !== 2) {
      return await ctx.reply('❌ Usage\\: /setpin \\[4 digits\\]\nExample\\: /setpin 1234', { parse_mode: 'MarkdownV2' });
    }
    
    const pin = args[1];
    
    if (!/^\d{4}$/.test(pin)) {
      return await ctx.reply('❌ PIN must be exactly 4 digits\\.', { parse_mode: 'MarkdownV2' });
    }
    
    user.pin = pin;
    user.pinAttempts = 0;
    user.pinLocked = false;
    
    await ctx.reply('✅ PIN set successfully\\! Use this PIN to confirm transactions\\.', { parse_mode: 'MarkdownV2' });
    
  } catch (error) {
    console.error('❌ Setpin error:', error);
  }
});

bot.command('status', async (ctx) => {
  try {
    await ctx.reply(
      `🤖 *BOT STATUS*\n\n` +
      `⚡ *Status\\:* ✅ ONLINE\n` +
      `🌐 *Server\\:* ${CONFIG.WEBHOOK_DOMAIN}\n` +
      `⏰ *Uptime\\:* ${Math.floor(process.uptime() / 60)} minutes\n` +
      `👥 *Active Users\\:* ${Object.keys(users).length}\n\n` +
      `🔧 *Services Available\\:*\n` +
      `• 📞 Airtime Purchase\n` +
      `• 📡 Data Bundles\n` +
      `• 💰 Wallet System\n` +
      `• 💳 Virtual Account Deposits\n` +
      `• 🏦 Bank Transfers\n\n` +
      `📞 *Support\\:* @opuenekeke`,
      { parse_mode: 'MarkdownV2' }
    );
    
  } catch (error) {
    console.error('❌ Status command error:', error);
  }
});

// Add button handlers
bot.hears('💰 Wallet Balance', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  
  await ctx.reply(
    `💰 *YOUR WALLET*\n\n` +
    `💵 *Balance\\:* ${formatCurrency(user.wallet)}\n` +
    `🛂 *KYC\\:* ${user.kyc.toUpperCase()}\n\n` +
    `💡 Use /balance anytime to check`,
    { parse_mode: 'MarkdownV2' }
  );
});

bot.hears('🆘 Help & Support', async (ctx) => {
  await ctx.reply(
    `🆘 *HELP & SUPPORT*\n\n` +
    `📱 *Main Commands\\:*\n` +
    `/start \\- Restart bot\n` +
    `/setpin 1234 \\- Set PIN\n` +
    `/balance \\- Check balance\n` +
    `/status \\- Bot status\n\n` +
    `⚡ *Quick Contact\\:*\n` +
    `@opuenekeke\n\n` +
    `🌐 *Server\\:* ${CONFIG.WEBHOOK_DOMAIN}`,
    { parse_mode: 'MarkdownV2' }
  );
});

// Add error handling
bot.catch((err, ctx) => {
  console.error(`❌ Bot error for ${ctx.updateType}:`, err);
});

// ==================== WEBHOOK ENDPOINTS ====================
// Monnify webhook
app.post('/monnify-webhook', (req, res) => {
  console.log('📨 Monnify webhook received:', req.body);
  // Add your Monnify webhook logic here
  res.status(200).json({ status: 'received' });
});

// Telegram webhook endpoint (for webhook mode)
const telegramWebhookPath = `/telegram-webhook-${CONFIG.BOT_TOKEN.split(':')[0]}`;
app.post(telegramWebhookPath, (req, res) => {
  console.log('📨 Telegram webhook received');
  bot.handleUpdate(req.body);
  res.status(200).send('OK');
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;

async function setupWebhook() {
  try {
    const webhookUrl = `${CONFIG.WEBHOOK_DOMAIN}${telegramWebhookPath}`;
    console.log(`🔗 Setting up webhook: ${webhookUrl}`);
    
    // Delete any existing webhook first
    await axios.post(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/deleteWebhook`);
    
    // Set new webhook
    const response = await axios.post(
      `https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/setWebhook`,
      {
        url: webhookUrl,
        max_connections: 40,
        allowed_updates: ["message", "callback_query"]
      }
    );
    
    console.log('✅ Webhook setup response:', response.data);
    
    // Start webhook mode
    bot.startWebhook(telegramWebhookPath, null, PORT, '0.0.0.0');
    console.log(`🚀 Bot running in webhook mode`);
    
  } catch (error) {
    console.error('❌ Webhook setup failed:', error.message);
    console.log('⚠️ Falling back to polling mode');
    
    // Fallback to polling if webhook fails
    bot.launch().then(() => {
      console.log('🚀 Bot running in polling mode (temporary)');
    });
  }
}

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🌐 Server running on port ${PORT}`);
  console.log(`🌍 Accessible at: ${CONFIG.WEBHOOK_DOMAIN}`);
  console.log(`🤖 Bot Token: ${CONFIG.BOT_TOKEN ? '✅ Set' : '❌ Missing'}`);
  console.log(`👑 Admin ID: ${CONFIG.ADMIN_ID}`);
  
  // Setup webhook
  await setupWebhook();
  
  // Test the server
  console.log('\n✅ SERVER STARTED SUCCESSFULLY!');
  console.log('📋 Quick Test URLs:');
  console.log(`• Health Check: ${CONFIG.WEBHOOK_DOMAIN}/health`);
  console.log(`• Test Page: ${CONFIG.WEBHOOK_DOMAIN}/test`);
  console.log(`• Telegram Webhook: ${CONFIG.WEBHOOK_DOMAIN}${telegramWebhookPath}`);
  console.log(`• Monnify Webhook: ${CONFIG.WEBHOOK_DOMAIN}/monnify-webhook`);
  
  // Keep-alive function for Render free tier
  setInterval(async () => {
    try {
      await axios.get(CONFIG.WEBHOOK_DOMAIN);
      console.log('✅ Keep-alive ping successful');
    } catch (error) {
      console.log('⚠️ Keep-alive ping failed:', error.message);
    }
  }, 5 * 60 * 1000); // Every 5 minutes
});

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('\n🛑 SIGINT received, shutting down...');
  bot.stop();
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received, shutting down...');
  bot.stop();
  process.exit(0);
});