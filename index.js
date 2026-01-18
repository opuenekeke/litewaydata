// index.js - SIMPLE WORKING VERSION
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  ADMIN_ID: process.env.ADMIN_ID || '1279640125'
};

if (!CONFIG.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN missing!');
  process.exit(1);
}

const bot = new Telegraf(CONFIG.BOT_TOKEN);

// Simple data storage
const users = {};

function initUser(userId) {
  if (!users[userId]) {
    users[userId] = {
      wallet: 1000,
      kyc: 'pending',
      name: '',
      joined: new Date().toLocaleString()
    };
  }
  return users[userId];
}

function isAdmin(userId) {
  return userId.toString() === CONFIG.ADMIN_ID.toString();
}

// START COMMAND
bot.start(async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const user = initUser(userId);
    const isAdminUser = isAdmin(userId);
    
    if (!user.name) {
      user.name = ctx.from.first_name || ctx.from.username || `User ${userId}`;
    }
    
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
      `🌟 Welcome to Liteway VTU Bot!\n\n` +
      `✅ Status: ONLINE\n\n` +
      `💰 Balance: ₦${user.wallet.toLocaleString()}\n\n` +
      `📱 Tap any button to start!`,
      Markup.keyboard(keyboard).resize()
    );
    
  } catch (error) {
    console.error('Start error:', error);
  }
});

// SIMPLE BUTTON HANDLERS (NO MARKDOWN ISSUES)
bot.hears('📞 Buy Airtime', async (ctx) => {
  await ctx.reply(
    `📞 BUY AIRTIME\n\n` +
    `Select network:\n\n` +
    `• MTN\n` +
    `• Glo\n` +
    `• Airtel\n` +
    `• 9mobile\n\n` +
    `🔧 Feature in development\n` +
    `Contact @opuenekeke for airtime`,
    Markup.inlineKeyboard([
      [Markup.button.callback('MTN', 'airtime_mtn')],
      [Markup.button.callback('Glo', 'airtime_glo')],
      [Markup.button.callback('Back', 'start')]
    ])
  );
});

bot.hears('📡 Buy Data', async (ctx) => {
  await ctx.reply(
    `📡 BUY DATA\n\n` +
    `Data plans coming soon!\n\n` +
    `Contact @opuenekeke for data bundles`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Back', 'start')]
    ])
  );
});

bot.hears('💰 Wallet Balance', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = initUser(userId);
  await ctx.reply(`💰 YOUR BALANCE\n\n₦${user.wallet.toLocaleString()}`);
});

bot.hears('💳 Deposit Funds', async (ctx) => {
  const userId = ctx.from.id.toString();
  await ctx.reply(
    `💳 DEPOSIT FUNDS\n\n` +
    `To deposit:\n` +
    `1. Contact @opuenekeke\n` +
    `2. Send payment proof\n` +
    `3. Include your ID: ${userId}\n` +
    `4. Wait for confirmation`
  );
});

bot.hears('🛠️ Admin', async (ctx) => {
  const userId = ctx.from.id.toString();
  if (!isAdmin(userId)) {
    return ctx.reply('❌ Admin access only');
  }
  
  await ctx.reply(
    `🛠️ ADMIN PANEL\n\n` +
    `Welcome Admin!\n\n` +
    `Total Users: ${Object.keys(users).length}\n` +
    `Uptime: ${Math.floor(process.uptime() / 60)}min`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Refresh', 'admin_refresh')],
      [Markup.button.callback('Home', 'start')]
    ])
  );
});

bot.hears('🆘 Help', async (ctx) => {
  await ctx.reply(
    `🆘 HELP & SUPPORT\n\n` +
    `📞 Contact: @opuenekeke\n` +
    `⏰ Response: 5-10 minutes`
  );
});

// CALLBACKS
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
    `🌟 Welcome to Liteway VTU Bot!\n\n` +
    `✅ Status: ONLINE\n\n` +
    `💰 Balance: ₦${user.wallet.toLocaleString()}\n\n` +
    `📱 Tap any button to start!`,
    {
      ...Markup.keyboard(keyboard).resize(),
      parse_mode: null // No markdown
    }
  );
  ctx.answerCbQuery();
});

// START BOT
bot.launch().then(() => {
  console.log('✅ Bot started successfully!');
}).catch(err => {
  console.error('❌ Bot failed:', err);
});

// Keep alive
setInterval(() => {
  console.log('✅ Bot alive');
}, 5 * 60 * 1000);