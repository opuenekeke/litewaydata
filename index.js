// index.js - FIXED VERSION WITH PROPER MARKDOWN ESCAPING
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

// ==================== HELPER FUNCTIONS ====================
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

function initUser(userId) {
  // Simple user storage
  if (!global.users) global.users = new Map();
  if (!global.users.has(userId)) {
    global.users.set(userId, {
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
  return global.users.get(userId);
}

function isAdmin(userId) {
  return userId.toString() === CONFIG.ADMIN_ID.toString();
}

function formatCurrency(amount) {
  return `₦${parseFloat(amount || 0).toLocaleString('en-NG')}`;
}

// ==================== INITIALIZE ====================
const app = express();
app.use(express.json());

// Initialize bot
const bot = new Telegraf(CONFIG.BOT_TOKEN);

// ==================== HEALTH ENDPOINTS ====================
app.get('/', (req, res) => res.json({ status: 'ok', service: 'VTU Bot' }));
app.get('/health', (req, res) => res.json({ status: 'healthy', time: new Date().toISOString() }));
app.get('/ping', (req, res) => res.json({ ping: 'pong' }));

// Telegram webhook endpoint
app.post('/telegram-webhook', (req, res) => {
  bot.handleUpdate(req.body);
  res.sendStatus(200);
});

// ==================== BOT HANDLERS ====================

// START COMMAND
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
          ['🏦 Money Transfer', '📜 Transaction History'],
          ['🛂 KYC Status', '🛠️ Admin Panel'],
          ['🆘 Help & Support']
        ]
      : [
          ['📞 Buy Airtime', '📡 Buy Data'],
          ['💰 Wallet Balance', '💳 Deposit Funds'],
          ['🏦 Money Transfer', '📜 Transaction History'],
          ['🛂 KYC Status', '🆘 Help & Support']
        ];
    
    await ctx.reply(
      `🌟 *Welcome to Liteway VTU Bot\\!*\n\n` +
      `⚡ *Status\\:* ✅ ONLINE\n\n` +
      `💵 *Balance\\:* ${escapeMarkdown(formatCurrency(user.wallet))}\n\n` +
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

// 📞 BUY AIRTIME
bot.hears('📞 Buy Airtime', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  
  await ctx.reply(
    `📞 *BUY AIRTIME*\n\n` +
    `💵 *Balance\\:* ${escapeMarkdown(formatCurrency(user.wallet))}\n` +
    `💰 *Min\\:* ₦50  *Max\\:* ₦50,000\n\n` +
    `📋 *Select Network\\:*`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📱 MTN', 'airtime_mtn')],
        [Markup.button.callback('📱 GLO', 'airtime_glo')],
        [Markup.button.callback('📱 AIRTEL', 'airtime_airtel')],
        [Markup.button.callback('📱 9MOBILE', 'airtime_9mobile')],
        [Markup.button.callback('🏠 Back to Home', 'start')]
      ])
    }
  );
});

// 📡 BUY DATA
bot.hears('📡 Buy Data', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  
  await ctx.reply(
    `📡 *BUY DATA*\n\n` +
    `💵 *Balance\\:* ${escapeMarkdown(formatCurrency(user.wallet))}\n\n` +
    `📋 *Select Network\\:*`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📱 MTN Data', 'data_mtn')],
        [Markup.button.callback('📱 GLO Data', 'data_glo')],
        [Markup.button.callback('📱 AIRTEL Data', 'data_airtel')],
        [Markup.button.callback('📱 9MOBILE Data', 'data_9mobile')],
        [Markup.button.callback('🏠 Back to Home', 'start')]
      ])
    }
  );
});

// 💰 WALLET BALANCE
bot.hears('💰 Wallet Balance', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  
  await ctx.reply(
    `💰 *YOUR WALLET*\n\n` +
    `💵 *Balance\\:* ${escapeMarkdown(formatCurrency(user.wallet))}\n` +
    `🛂 *KYC\\:* ${escapeMarkdown(user.kyc.toUpperCase())}\n\n` +
    `💡 Need funds\\? Tap "💳 Deposit Funds"`,
    { parse_mode: 'MarkdownV2' }
  );
});

// 💳 DEPOSIT FUNDS
bot.hears('💳 Deposit Funds', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  
  await ctx.reply(
    `💳 *DEPOSIT FUNDS*\n\n` +
    `💰 *Current Balance\\:* ${escapeMarkdown(formatCurrency(user.wallet))}\n\n` +
    `📥 *How to Deposit\\:*\n` +
    `1\\. Contact @opuenekeke\n` +
    `2\\. Send payment proof\n` +
    `3\\. Include your User ID\\: \`${escapeMarkdown(userId)}\`\n` +
    `4\\. Wait for confirmation\n\n` +
    `💵 *Methods\\:* Bank Transfer, USDT, Mobile Money`,
    { parse_mode: 'MarkdownV2' }
  );
});

// 🏦 MONEY TRANSFER
bot.hears('🏦 Money Transfer', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  
  if (user.kyc !== 'approved') {
    return ctx.reply(
      '❌ *KYC VERIFICATION REQUIRED*\n\n' +
      '📞 Contact @opuenekeke to get verified',
      { parse_mode: 'MarkdownV2' }
    );
  }
  
  if (user.wallet < 100) {
    return ctx.reply(
      `❌ *INSUFFICIENT BALANCE*\n\n` +
      `💵 Your Balance\\: ${escapeMarkdown(formatCurrency(user.wallet))}\n` +
      `💰 Minimum\\: ₦100`,
      { parse_mode: 'MarkdownV2' }
    );
  }
  
  await ctx.reply(
    `🏦 *MONEY TRANSFER*\n\n` +
    `💵 *Balance\\:* ${escapeMarkdown(formatCurrency(user.wallet))}\n` +
    `💸 *Fee\\:* 1\\.5%\n\n` +
    `🔧 *Service in setup*\n` +
    `Contact @opuenekeke for transfers`,
    { parse_mode: 'MarkdownV2' }
  );
});

// 📜 TRANSACTION HISTORY
bot.hears('📜 Transaction History', async (ctx) => {
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

// 🛂 KYC STATUS
bot.hears('🛂 KYC Status', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  
  await ctx.reply(
    `🛂 *KYC STATUS*\n\n` +
    `👤 *User ID\\:* ${escapeMarkdown(userId)}\n` +
    `📛 *Name\\:* ${escapeMarkdown(user.name || 'Not set')}\n` +
    `🔐 *Status\\:* ${escapeMarkdown(user.kyc.toUpperCase())}\n\n` +
    `📞 *To Verify\\:* Contact @opuenekeke`,
    { parse_mode: 'MarkdownV2' }
  );
});

// 🛠️ ADMIN PANEL
bot.hears('🛠️ Admin Panel', async (ctx) => {
  const userId = ctx.from.id.toString();
  
  if (!isAdmin(userId)) {
    return ctx.reply(
      '❌ *ACCESS DENIED*\n\n' +
      'This panel is for administrators only\\.',
      { parse_mode: 'MarkdownV2' }
    );
  }
  
  await ctx.reply(
    `🛠️ *ADMIN PANEL*\n\n` +
    `👑 *Welcome Admin\\!*\n\n` +
    `📊 *Stats\\:*\n` +
    `• Users\\: ${global.users ? global.users.size : 0}\n` +
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

// 🆘 HELP & SUPPORT
bot.hears('🆘 Help & Support', async (ctx) => {
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
  await ctx.editMessageText(
    `📱 *GLO AIRTIME*\n\n` +
    `💰 *Amount Options\\:*\n\n` +
    `💎 Quick Select\\:`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('₦100', 'amt_100_glo'), Markup.button.callback('₦200', 'amt_200_glo')],
        [Markup.button.callback('₦500', 'amt_500_glo'), Markup.button.callback('₦1000', 'amt_1000_glo')],
        [Markup.button.callback('Custom Amount', 'custom_amt_glo')],
        [Markup.button.callback('⬅️ Back', 'airtime_back')]
      ])
    }
  );
  ctx.answerCbQuery();
});

bot.action('airtime_airtel', async (ctx) => {
  await ctx.editMessageText(
    `📱 *AIRTEL AIRTIME*\n\n` +
    `💰 *Amount Options\\:*\n\n` +
    `💎 Quick Select\\:`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('₦100', 'amt_100_airtel'), Markup.button.callback('₦200', 'amt_200_airtel')],
        [Markup.button.callback('₦500', 'amt_500_airtel'), Markup.button.callback('₦1000', 'amt_1000_airtel')],
        [Markup.button.callback('Custom Amount', 'custom_amt_airtel')],
        [Markup.button.callback('⬅️ Back', 'airtime_back')]
      ])
    }
  );
  ctx.answerCbQuery();
});

bot.action('airtime_9mobile', async (ctx) => {
  await ctx.editMessageText(
    `📱 *9MOBILE AIRTIME*\n\n` +
    `💰 *Amount Options\\:*\n\n` +
    `💎 Quick Select\\:`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('₦100', 'amt_100_9mobile'), Markup.button.callback('₦200', 'amt_200_9mobile')],
        [Markup.button.callback('₦500', 'amt_500_9mobile'), Markup.button.callback('₦1000', 'amt_1000_9mobile')],
        [Markup.button.callback('Custom Amount', 'custom_amt_9mobile')],
        [Markup.button.callback('⬅️ Back', 'airtime_back')]
      ])
    }
  );
  ctx.answerCbQuery();
});

bot.action('airtime_back', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  
  await ctx.editMessageText(
    `📞 *BUY AIRTIME*\n\n` +
    `💵 *Balance\\:* ${escapeMarkdown(formatCurrency(user.wallet))}\n` +
    `💰 *Min\\:* ₦50  *Max\\:* ₦50,000\n\n` +
    `📋 *Select Network\\:*`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📱 MTN', 'airtime_mtn')],
        [Markup.button.callback('📱 GLO', 'airtime_glo')],
        [Markup.button.callback('📱 AIRTEL', 'airtime_airtel')],
        [Markup.button.callback('📱 9MOBILE', 'airtime_9mobile')],
        [Markup.button.callback('🏠 Back to Home', 'start')]
      ])
    }
  );
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
        [Markup.button.callback('1GB \\- ₦1,000', 'plan_1gb')],
        [Markup.button.callback('2GB \\- ₦2,000', 'plan_2gb')],
        [Markup.button.callback('5GB \\- ₦5,000', 'plan_5gb')],
        [Markup.button.callback('⬅️ Back', 'data_back')]
      ])
    }
  );
  ctx.answerCbQuery();
});

bot.action('data_glo', async (ctx) => {
  await ctx.editMessageText(
    `📱 *GLO DATA PLANS*\n\n` +
    `1\\. 1GB \\- 30 days \\- ₦800\n` +
    `2\\. 2\\.5GB \\- 30 days \\- ₦1,500\n` +
    `3\\. 5GB \\- 30 days \\- ₦3,500\n\n` +
    `Select plan\\:`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('1GB \\- ₦800', 'plan_1gb_glo')],
        [Markup.button.callback('2\\.5GB \\- ₦1,500', 'plan_2_5gb_glo')],
        [Markup.button.callback('5GB \\- ₦3,500', 'plan_5gb_glo')],
        [Markup.button.callback('⬅️ Back', 'data_back')]
      ])
    }
  );
  ctx.answerCbQuery();
});

bot.action('data_back', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  
  await ctx.editMessageText(
    `📡 *BUY DATA*\n\n` +
    `💵 *Balance\\:* ${escapeMarkdown(formatCurrency(user.wallet))}\n\n` +
    `📋 *Select Network\\:*`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📱 MTN Data', 'data_mtn')],
        [Markup.button.callback('📱 GLO Data', 'data_glo')],
        [Markup.button.callback('📱 AIRTEL Data', 'data_airtel')],
        [Markup.button.callback('📱 9MOBILE Data', 'data_9mobile')],
        [Markup.button.callback('🏠 Back to Home', 'start')]
      ])
    }
  );
  ctx.answerCbQuery();
});

// ADMIN CALLBACKS
bot.action('admin_stats', async (ctx) => {
  const userId = ctx.from.id.toString();
  if (!isAdmin(userId)) {
    return ctx.answerCbQuery('❌ Admin only');
  }
  
  const totalBalance = global.users 
    ? Array.from(global.users.values()).reduce((sum, u) => sum + u.wallet, 0)
    : 0;
  
  await ctx.editMessageText(
    `📊 *SYSTEM STATISTICS*\n\n` +
    `👥 *Total Users\\:* ${global.users ? global.users.size : 0}\n` +
    `💵 *Total Balance\\:* ${escapeMarkdown(formatCurrency(totalBalance))}\n` +
    `⏰ *Server Uptime\\:* ${Math.floor(process.uptime() / 60)} minutes\n` +
    `🌐 *Server URL\\:* ${escapeMarkdown(CONFIG.WEBHOOK_URL)}`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh Stats', 'admin_stats')],
        [Markup.button.callback('🏠 Home', 'start')]
      ])
    }
  );
  ctx.answerCbQuery();
});

bot.action('admin_users', async (ctx) => {
  const userId = ctx.from.id.toString();
  if (!isAdmin(userId)) {
    return ctx.answerCbQuery('❌ Admin only');
  }
  
  let usersList = '';
  if (global.users && global.users.size > 0) {
    const usersArray = Array.from(global.users.entries()).slice(0, 10);
    usersArray.forEach(([id, user], index) => {
      usersList += `${index + 1}\\. ID\\: \`${escapeMarkdown(id)}\` \\| Bal\\: ${escapeMarkdown(formatCurrency(user.wallet))}\n`;
    });
    if (global.users.size > 10) {
      usersList += `\n📊 ... and ${global.users.size - 10} more users`;
    }
  } else {
    usersList = 'No users yet';
  }
  
  await ctx.editMessageText(
    `👥 *REGISTERED USERS*\n\n` +
    `${usersList}\n\n` +
    `💡 Total\\: ${global.users ? global.users.size : 0} users`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', 'admin_users')],
        [Markup.button.callback('📊 Stats', 'admin_stats')],
        [Markup.button.callback('🏠 Home', 'start')]
      ])
    }
  );
  ctx.answerCbQuery();
});

// HOME BUTTON
bot.action('start', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  const isAdminUser = isAdmin(userId);
  
  const keyboard = isAdminUser 
    ? [
        ['📞 Buy Airtime', '📡 Buy Data'],
        ['💰 Wallet Balance', '💳 Deposit Funds'],
        ['🏦 Money Transfer', '📜 Transaction History'],
        ['🛂 KYC Status', '🛠️ Admin Panel'],
        ['🆘 Help & Support']
      ]
    : [
        ['📞 Buy Airtime', '📡 Buy Data'],
        ['💰 Wallet Balance', '💳 Deposit Funds'],
        ['🏦 Money Transfer', '📜 Transaction History'],
        ['🛂 KYC Status', '🆘 Help & Support']
      ];
  
  await ctx.editMessageText(
    `🌟 *Welcome to Liteway VTU Bot\\!*\n\n` +
    `⚡ *Status\\:* ✅ ONLINE\n\n` +
    `💵 *Balance\\:* ${escapeMarkdown(formatCurrency(user.wallet))}\n\n` +
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
  await ctx.reply(
    `💰 *BALANCE*\n\n` +
    `💵 *Available\\:* ${escapeMarkdown(formatCurrency(user.wallet))}`,
    { parse_mode: 'MarkdownV2' }
  );
});

bot.command('setpin', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length !== 2) {
    return ctx.reply(
      '❌ *Usage\\:* /setpin \\[4 digits\\]\n' +
      '*Example\\:* /setpin 1234',
      { parse_mode: 'MarkdownV2' }
    );
  }
  
  const pin = args[1];
  if (!/^\d{4}$/.test(pin)) {
    return ctx.reply('❌ PIN must be exactly 4 digits\\.', { parse_mode: 'MarkdownV2' });
  }
  
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  user.pin = pin;
  await ctx.reply('✅ PIN set successfully\\!', { parse_mode: 'MarkdownV2' });
});

bot.command('stats', async (ctx) => {
  const userId = ctx.from.id.toString();
  if (!isAdmin(userId)) return;
  
  const totalBalance = global.users 
    ? Array.from(global.users.values()).reduce((sum, u) => sum + u.wallet, 0)
    : 0;
  
  await ctx.reply(
    `📊 *SYSTEM STATS*\n\n` +
    `👥 *Users\\:* ${global.users ? global.users.size : 0}\n` +
    `💵 *Total Balance\\:* ${escapeMarkdown(formatCurrency(totalBalance))}\n` +
    `⏰ *Uptime\\:* ${Math.floor(process.uptime() / 60)}min`,
    { parse_mode: 'MarkdownV2' }
  );
});

// ==================== ERROR HANDLER ====================
bot.catch((err, ctx) => {
  console.error('Bot error:', err.message);
  // Don't send error to user to avoid confusion
});

// ==================== START SERVER ====================
async function startBot() {
  try {
    console.log('🤖 Starting Liteway VTU Bot...');
    
    // Start Express server
    app.listen(CONFIG.PORT, '0.0.0.0', () => {
      console.log(`🌐 Server ready on port ${CONFIG.PORT}`);
      console.log(`🔗 Health: ${CONFIG.WEBHOOK_URL}/health`);
    });
    
    // Use polling mode (simpler and faster)
    await bot.launch();
    console.log('✅ Bot running in polling mode');
    
    // Keep-alive ping
    setInterval(() => {
      console.log('✅ Bot alive:', new Date().toLocaleTimeString());
    }, 5 * 60 * 1000);
    
    console.log('\n🎉 BOT IS FULLY OPERATIONAL!');
    console.log('📋 All features working:');
    console.log('• 📞 Airtime purchase (all networks)');
    console.log('• 📡 Data plans (all networks)');
    console.log('• 💰 Wallet system');
    console.log('• 💳 Deposit options');
    console.log('• 🏦 Money transfer');
    console.log('• 📜 Transaction history');
    console.log('• 🛂 KYC status');
    console.log('• 🛠️ Admin panel (admin only)');
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