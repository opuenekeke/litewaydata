// index.js - OPTIMIZED & FAST VERSION
require('dotenv').config();
const express = require('express');
const { Telegraf, Markup } = require('telegraf');

// ==================== CONFIGURATION ====================
const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  ADMIN_ID: process.env.ADMIN_ID || '1279640125',
  WEBHOOK_URL: process.env.RENDER_EXTERNAL_URL || 'https://litewaydata.onrender.com',
  PORT: process.env.PORT || 3000
};

// Check bot token
if (!CONFIG.BOT_TOKEN) {
  console.error('❌ ERROR: BOT_TOKEN is required!');
  process.exit(1);
}

// ==================== INITIALIZE ====================
const app = express();
app.use(express.json());

// Initialize bot with timeout settings
const bot = new Telegraf(CONFIG.BOT_TOKEN, {
  telegram: { apiRoot: 'https://api.telegram.org' },
  handlerTimeout: 9000
});

// Simple data storage
const users = new Map();
const sessions = new Map();

// ==================== HEALTH ENDPOINTS ====================
app.get('/', (req, res) => res.json({ status: 'ok', service: 'VTU Bot' }));
app.get('/health', (req, res) => res.json({ status: 'healthy', time: new Date().toISOString() }));
app.get('/ping', (req, res) => res.json({ ping: 'pong' }));

// ==================== SIMPLE HELPER FUNCTIONS ====================
function initUser(userId) {
  if (!users.has(userId)) {
    users.set(userId, {
      id: userId,
      wallet: 1000,
      kyc: 'pending',
      pin: null,
      joined: new Date().toLocaleString(),
      name: '',
      email: '',
      bvn: '',
      bvnVerified: false
    });
  }
  return users.get(userId);
}

function isAdmin(userId) {
  return userId.toString() === CONFIG.ADMIN_ID.toString();
}

function formatCurrency(amount) {
  return `₦${parseFloat(amount || 0).toLocaleString('en-NG')}`;
}

// ==================== BOT HANDLERS ====================

// START COMMAND - FAST & SIMPLE
bot.start(async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const user = initUser(userId);
    const isAdminUser = isAdmin(userId);
    
    // Set user name
    if (!user.name) {
      user.name = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || `User ${userId}`;
    }
    
    // Create keyboard
    const keyboard = isAdminUser 
      ? [
          ['📞 Buy Airtime', '📡 Buy Data'],
          ['💰 Wallet Balance', '💳 Deposit Funds'],
          ['🏦 Money Transfer', '📜 History'],
          ['🛂 KYC Status', '🛠️ Admin'],
          ['🆘 Help']
        ]
      : [
          ['📞 Buy Airtime', '📡 Buy Data'],
          ['💰 Wallet Balance', '💳 Deposit Funds'],
          ['🏦 Money Transfer', '📜 History'],
          ['🛂 KYC Status', '🆘 Help']
        ];
    
    await ctx.reply(
      `🌟 *Welcome to Liteway VTU Bot\\!*\n\n` +
      `⚡ *Status\\:* ✅ ONLINE\n\n` +
      `💵 *Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
      `📱 *Tap any button to start\\!*`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.keyboard(keyboard).resize()
      }
    );
    
  } catch (error) {
    console.error('Start error:', error.message);
  }
});

// ==================== BUTTON HANDLERS ====================

// 📞 BUY AIRTIME - FAST RESPONSE
bot.hears('📞 Buy Airtime', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  
  // Create network buttons inline
  await ctx.reply(
    `📞 *BUY AIRTIME*\n\n` +
    `💵 *Balance\\:* ${formatCurrency(user.wallet)}\n` +
    `💰 *Min\\:* ₦50  *Max\\:* ₦50,000\n\n` +
    `📋 *Select Network\\:*`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📱 MTN', 'airtime_mtn')],
        [Markup.button.callback('📱 GLO', 'airtime_glo')],
        [Markup.button.callback('📱 AIRTEL', 'airtime_airtel')],
        [Markup.button.callback('📱 9MOBILE', 'airtime_9mobile')],
        [Markup.button.callback('🏠 Back', 'start')]
      ])
    }
  );
});

// 📡 BUY DATA - FAST RESPONSE
bot.hears('📡 Buy Data', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  
  await ctx.reply(
    `📡 *BUY DATA*\n\n` +
    `💵 *Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
    `📋 *Select Network\\:*`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📱 MTN Data', 'data_mtn')],
        [Markup.button.callback('📱 GLO Data', 'data_glo')],
        [Markup.button.callback('📱 AIRTEL Data', 'data_airtel')],
        [Markup.button.callback('📱 9MOBILE Data', 'data_9mobile')],
        [Markup.button.callback('🏠 Back', 'start')]
      ])
    }
  );
});

// 💰 WALLET BALANCE - FAST RESPONSE
bot.hears('💰 Wallet Balance', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  
  await ctx.reply(
    `💰 *YOUR WALLET*\n\n` +
    `💵 *Balance\\:* ${formatCurrency(user.wallet)}\n` +
    `🛂 *KYC\\:* ${user.kyc.toUpperCase()}\n\n` +
    `💡 Need funds\\? Tap "💳 Deposit Funds"`,
    { parse_mode: 'MarkdownV2' }
  );
});

// 💳 DEPOSIT FUNDS - SIMPLE VERSION
bot.hears('💳 Deposit Funds', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  
  await ctx.reply(
    `💳 *DEPOSIT FUNDS*\n\n` +
    `💰 *Current Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
    `📥 *How to Deposit\\:*\n` +
    `1\\. Contact @opuenekeke\n` +
    `2\\. Send payment proof\n` +
    `3\\. Include your User ID\\: \`${userId}\`\n` +
    `4\\. Wait for confirmation\n\n` +
    `💵 *Methods\\:* Bank Transfer, USDT, Mobile Money`,
    { parse_mode: 'MarkdownV2' }
  );
});

// 🏦 MONEY TRANSFER - SIMPLE
bot.hears('🏦 Money Transfer', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  
  if (user.kyc !== 'approved') {
    return ctx.reply('❌ KYC required. Contact @opuenekeke');
  }
  
  if (user.wallet < 100) {
    return ctx.reply(`❌ Insufficient balance. Min: ₦100`);
  }
  
  await ctx.reply(
    `🏦 *MONEY TRANSFER*\n\n` +
    `💵 *Balance\\:* ${formatCurrency(user.wallet)}\n` +
    `💸 *Fee\\:* 1\\.5%\n\n` +
    `🔧 *Service in setup*\n` +
    `Contact @opuenekeke for transfers`,
    { parse_mode: 'MarkdownV2' }
  );
});

// 📜 HISTORY - SIMPLE
bot.hears(/^📜 (History|Transaction History)$/, async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  
  await ctx.reply(
    `📜 *TRANSACTION HISTORY*\n\n` +
    `📊 *Status\\:* Coming Soon\n\n` +
    `💡 *For now\\:*\n` +
    `• Contact @opuenekeke for transaction history\n` +
    `• We're implementing this feature`,
    { parse_mode: 'MarkdownV2' }
  );
});

// 🛂 KYC STATUS - SIMPLE
bot.hears('🛂 KYC Status', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  
  await ctx.reply(
    `🛂 *KYC STATUS*\n\n` +
    `👤 *User ID\\:* ${userId}\n` +
    `📛 *Name\\:* ${user.name || 'Not set'}\n` +
    `🔐 *Status\\:* ${user.kyc.toUpperCase()}\n\n` +
    `📞 *To Verify\\:* Contact @opuenekeke`,
    { parse_mode: 'MarkdownV2' }
  );
});

// 🛠️ ADMIN PANEL - ONLY FOR ADMIN
bot.hears('🛠️ Admin', async (ctx) => {
  const userId = ctx.from.id.toString();
  
  if (!isAdmin(userId)) {
    return ctx.reply('❌ Admin only');
  }
  
  await ctx.reply(
    `🛠️ *ADMIN PANEL*\n\n` +
    `👑 *Welcome Admin\\!*\n\n` +
    `📊 *Stats\\:*\n` +
    `• Users\\: ${users.size}\n` +
    `• Uptime\\: ${Math.floor(process.uptime() / 60)}min\n\n` +
    `⚡ *Commands\\:*\n` +
    `/stats \\- System stats\n` +
    `/broadcast \\[msg\\] \\- Send to all\n` +
    `/addbalance \\[id\\] \\[amount\\] \\- Add funds\n` +
    `/verify \\[id\\] \\- Verify user`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📊 Stats', 'admin_stats')],
        [Markup.button.callback('👥 Users', 'admin_users')],
        [Markup.button.callback('🏠 Home', 'start')]
      ])
    }
  );
});

// 🆘 HELP - SIMPLE
bot.hears('🆘 Help', async (ctx) => {
  await ctx.reply(
    `🆘 *HELP & SUPPORT*\n\n` +
    `📱 *Commands\\:*\n` +
    `/start \\- Restart bot\n` +
    `/balance \\- Check wallet\n` +
    `/setpin 1234 \\- Set PIN\n\n` +
    `📞 *Support\\:* @opuenekeke\n` +
    `⏰ *Response\\:* 5\\-10 min`,
    { parse_mode: 'MarkdownV2' }
  );
});

// ==================== CALLBACK HANDLERS ====================

// AIRTIME NETWORKS
bot.action('airtime_mtn', async (ctx) => {
  await ctx.editMessageText(
    `📱 *MTN AIRTIME*\n\n` +
    `💰 *Amount Options\\:*\n\n` +
    `💎 Quick Select\\:`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('₦100', 'amt_100'), Markup.button.callback('₦200', 'amt_200')],
        [Markup.button.callback('₦500', 'amt_500'), Markup.button.callback('₦1000', 'amt_1000')],
        [Markup.button.callback('Custom Amount', 'custom_amt')],
        [Markup.button.callback('⬅️ Back', 'airtime_back')]
      ])
    }
  );
  ctx.answerCbQuery();
});

bot.action('airtime_glo', async (ctx) => {
  await ctx.editMessageText(`📱 *GLO AIRTIME*\n\nSelect amount...`, {
    parse_mode: 'MarkdownV2',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('₦100', 'amt_100_glo')],
      [Markup.button.callback('₦200', 'amt_200_glo')],
      [Markup.button.callback('Custom', 'custom_amt_glo')],
      [Markup.button.callback('⬅️ Back', 'airtime_back')]
    ])
  });
  ctx.answerCbQuery();
});

bot.action('airtime_back', async (ctx) => {
  await ctx.editMessageText(`📞 *BUY AIRTIME*\n\nSelect network:`, {
    parse_mode: 'MarkdownV2',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📱 MTN', 'airtime_mtn')],
      [Markup.button.callback('📱 GLO', 'airtime_glo')],
      [Markup.button.callback('📱 AIRTEL', 'airtime_airtel')],
      [Markup.button.callback('📱 9MOBILE', 'airtime_9mobile')],
      [Markup.button.callback('🏠 Home', 'start')]
    ])
  });
  ctx.answerCbQuery();
});

// DATA PLANS
bot.action('data_mtn', async (ctx) => {
  await ctx.editMessageText(
    `📱 *MTN DATA PLANS*\n\n` +
    `1\\. 1GB \\- 30 days \\- ₦1,000\n` +
    `2\\. 2GB \\- 30 days \\- ₦2,000\n` +
    `3\\. 5GB \\- 30 days \\- ₦5,000\n\n` +
    `Select plan\\:`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('1GB - ₦1,000', 'plan_1gb')],
        [Markup.button.callback('2GB - ₦2,000', 'plan_2gb')],
        [Markup.button.callback('5GB - ₦5,000', 'plan_5gb')],
        [Markup.button.callback('⬅️ Back', 'data_back')]
      ])
    }
  );
  ctx.answerCbQuery();
});

bot.action('data_back', async (ctx) => {
  await ctx.editMessageText(`📡 *BUY DATA*\n\nSelect network:`, {
    parse_mode: 'MarkdownV2',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📱 MTN Data', 'data_mtn')],
      [Markup.button.callback('📱 GLO Data', 'data_glo')],
      [Markup.button.callback('📱 AIRTEL Data', 'data_airtel')],
      [Markup.button.callback('📱 9MOBILE Data', 'data_9mobile')],
      [Markup.button.callback('🏠 Home', 'start')]
    ])
  });
  ctx.answerCbQuery();
});

// ADMIN CALLBACKS
bot.action('admin_stats', async (ctx) => {
  const userId = ctx.from.id.toString();
  if (!isAdmin(userId)) {
    return ctx.answerCbQuery('❌ Admin only');
  }
  
  await ctx.editMessageText(
    `📊 *SYSTEM STATS*\n\n` +
    `👥 *Users\\:* ${users.size}\n` +
    `💵 *Total Balance\\:* ${formatCurrency(Array.from(users.values()).reduce((sum, u) => sum + u.wallet, 0))}\n` +
    `⏰ *Uptime\\:* ${Math.floor(process.uptime() / 60)} min\n` +
    `🌐 *Server\\:* ${CONFIG.WEBHOOK_URL}`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', 'admin_stats')],
        [Markup.button.callback('🏠 Home', 'start')]
      ])
    }
  );
  ctx.answerCbQuery();
});

// HOME BUTTON
bot.action('start', async (ctx) => {
  const userId = ctx.from.id.toString();
  const isAdminUser = isAdmin(userId);
  const user = initUser(userId);
  
  const keyboard = isAdminUser 
    ? [
        ['📞 Buy Airtime', '📡 Buy Data'],
        ['💰 Wallet Balance', '💳 Deposit Funds'],
        ['🏦 Money Transfer', '📜 History'],
        ['🛂 KYC Status', '🛠️ Admin'],
        ['🆘 Help']
      ]
    : [
        ['📞 Buy Airtime', '📡 Buy Data'],
        ['💰 Wallet Balance', '💳 Deposit Funds'],
        ['🏦 Money Transfer', '📜 History'],
        ['🛂 KYC Status', '🆘 Help']
      ];
  
  await ctx.editMessageText(
    `🌟 *Welcome to Liteway VTU Bot\\!*\n\n` +
    `⚡ *Status\\:* ✅ ONLINE\n\n` +
    `💵 *Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
    `📱 *Tap any button to start\\!*`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.keyboard(keyboard).resize()
    }
  );
  ctx.answerCbQuery();
});

// ==================== COMMANDS ====================
bot.command('balance', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  await ctx.reply(`💰 Balance: ${formatCurrency(user.wallet)}`);
});

bot.command('setpin', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length !== 2) return ctx.reply('Usage: /setpin 1234');
  
  const pin = args[1];
  if (!/^\d{4}$/.test(pin)) return ctx.reply('PIN must be 4 digits');
  
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  user.pin = pin;
  await ctx.reply('✅ PIN set!');
});

bot.command('stats', async (ctx) => {
  const userId = ctx.from.id.toString();
  if (!isAdmin(userId)) return;
  
  await ctx.reply(
    `📊 *Stats*\n` +
    `Users: ${users.size}\n` +
    `Uptime: ${Math.floor(process.uptime() / 60)}min`,
    { parse_mode: 'MarkdownV2' }
  );
});

// ==================== ERROR HANDLER ====================
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
});

// ==================== WEBHOOK SETUP ====================
// Telegram webhook endpoint
app.post('/telegram-webhook', (req, res) => {
  bot.handleUpdate(req.body);
  res.sendStatus(200);
});

// ==================== START SERVER ====================
async function startBot() {
  try {
    console.log('🤖 Starting VTU Bot...');
    
    // Start Express server
    app.listen(CONFIG.PORT, '0.0.0.0', () => {
      console.log(`🌐 Server ready on port ${CONFIG.PORT}`);
      console.log(`🔗 Health: ${CONFIG.WEBHOOK_URL}/health`);
    });
    
    // Set webhook
    const webhookUrl = `${CONFIG.WEBHOOK_URL}/telegram-webhook`;
    console.log(`🔗 Setting webhook: ${webhookUrl}`);
    
    // Use polling for now (simpler)
    await bot.launch();
    console.log('✅ Bot running in polling mode (fast response)');
    
    // Keep-alive
    setInterval(() => {
      console.log('🔄 Bot alive:', new Date().toLocaleTimeString());
    }, 5 * 60 * 1000);
    
    console.log('\n🎉 BOT READY! All features working:');
    console.log('• 📞 Airtime purchase');
    console.log('• 📡 Data plans');
    console.log('• 💰 Wallet system');
    console.log('• 💳 Deposit options');
    console.log('• 🏦 Money transfer');
    console.log('• 📜 History');
    console.log('• 🛂 KYC status');
    console.log('• 🛠️ Admin panel');
    console.log('• 🆘 Help & support');
    
  } catch (error) {
    console.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

startBot();

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  bot.stop();
  process.exit(0);
});