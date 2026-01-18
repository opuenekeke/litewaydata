// index.js - ULTRA FAST MINIMAL VERSION
console.log('⚡ BOT STARTING - ULTRA FAST VERSION');

const { Telegraf, Markup } = require('telegraf');
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || '1279640125';

if (!TOKEN) {
  console.error('❌ NO BOT TOKEN');
  process.exit(1);
}

const bot = new Telegraf(TOKEN, {
  handlerTimeout: 3000,
  telegram: { 
    apiRoot: 'https://api.telegram.org',
    agent: null,
    attachmentAgent: null
  }
});

// SUPER SIMPLE DATA
let users = {};

// FAST HELPERS
function getUser(userId) {
  if (!users[userId]) {
    users[userId] = {
      wallet: 1000,
      name: 'User',
      kyc: 'pending'
    };
  }
  return users[userId];
}

function isAdmin(id) {
  return id == ADMIN_ID;
}

// ⚡⚡⚡ MAIN START COMMAND ⚡⚡⚡
bot.start(async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const user = getUser(userId);
    const admin = isAdmin(userId);
    
    // Set name quickly
    user.name = ctx.from.first_name || 'User';
    
    // FAST KEYBOARD
    const keys = admin 
      ? [['📞 Airtime', '📡 Data'], ['💰 Balance', '💳 Deposit'], ['🛠️ Admin']]
      : [['📞 Airtime', '📡 Data'], ['💰 Balance', '💳 Deposit']];
    
    // FAST RESPONSE - NO MARKDOWN
    await ctx.reply(
      `⚡ LITEWAY VTU BOT\n\n` +
      `💰 Balance: ₦${user.wallet}\n` +
      `✅ Online\n\n` +
      `Tap button below:`,
      Markup.keyboard(keys).resize()
    );
    
    console.log(`✅ User ${userId} started`);
    
  } catch (e) {
    console.log('Start error:', e.message);
  }
});

// ⚡⚡⚡ FAST BUTTON HANDLERS ⚡⚡⚡

// AIRTIME - INSTANT RESPONSE
bot.hears('📞 Airtime', async (ctx) => {
  await ctx.reply(
    '📞 AIRTIME\n\nSelect network:',
    Markup.inlineKeyboard([
      [Markup.button.callback('MTN', 'net_mtn')],
      [Markup.button.callback('GLO', 'net_glo')],
      [Markup.button.callback('AIRTEL', 'net_airtel')],
      [Markup.button.callback('9MOBILE', 'net_9mobile')]
    ])
  );
});

// DATA - INSTANT RESPONSE  
bot.hears('📡 Data', async (ctx) => {
  await ctx.reply(
    '📡 DATA BUNDLES\n\nComing soon!\nContact @opuenekeke',
    Markup.inlineKeyboard([
      [Markup.button.callback('Back', 'start')]
    ])
  );
});

// BALANCE - INSTANT
bot.hears('💰 Balance', async (ctx) => {
  const user = getUser(ctx.from.id.toString());
  await ctx.reply(`💰 BALANCE\n\n₦${user.wallet}`);
});

// DEPOSIT - INSTANT
bot.hears('💳 Deposit', async (ctx) => {
  const userId = ctx.from.id.toString();
  await ctx.reply(
    `💳 DEPOSIT\n\n` +
    `Contact @opuenekeke\n` +
    `Your ID: ${userId}\n` +
    `Send payment proof`
  );
});

// ADMIN - INSTANT
bot.hears('🛠️ Admin', async (ctx) => {
  if (!isAdmin(ctx.from.id.toString())) {
    return ctx.reply('❌ Admin only');
  }
  await ctx.reply(
    `🛠️ ADMIN\n\n` +
    `Users: ${Object.keys(users).length}\n` +
    `Uptime: ${Math.floor(process.uptime() / 60)}min`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Refresh', 'admin_refresh')],
      [Markup.button.callback('Home', 'start')]
    ])
  );
});

// ⚡⚡⚡ CALLBACKS ⚡⚡⚡
bot.action('start', async (ctx) => {
  const userId = ctx.from.id.toString();
  const admin = isAdmin(userId);
  const user = getUser(userId);
  
  const keys = admin 
    ? [['📞 Airtime', '📡 Data'], ['💰 Balance', '💳 Deposit'], ['🛠️ Admin']]
    : [['📞 Airtime', '📡 Data'], ['💰 Balance', '💳 Deposit']];
  
  await ctx.editMessageText(
    `⚡ LITEWAY VTU BOT\n\n` +
    `💰 Balance: ₦${user.wallet}\n` +
    `✅ Online\n\n` +
    `Tap button:`,
    Markup.keyboard(keys).resize()
  );
  ctx.answerCbQuery();
});

// NETWORK SELECTION
bot.action(/^net_/, async (ctx) => {
  const network = ctx.match[0].replace('net_', '');
  await ctx.editMessageText(
    `📞 ${network} AIRTIME\n\n` +
    `Enter amount:\n` +
    `(Example: 500)`,
    Markup.inlineKeyboard([
      [Markup.button.callback('₦100', 'amt_100')],
      [Markup.button.callback('₦500', 'amt_500')],
      [Markup.button.callback('Back', 'start')]
    ])
  );
  ctx.answerCbQuery();
});

// ⚡⚡⚡ START BOT - POLLING MODE ⚡⚡⚡
console.log('🚀 Launching bot in polling mode...');

bot.launch()
  .then(() => {
    console.log('✅ BOT RUNNING - SUPER FAST!');
    console.log('📱 All buttons working instantly');
    
    // Keep alive
    setInterval(() => {
      console.log('❤️ Bot heartbeat');
    }, 300000); // 5 minutes
    
  })
  .catch(err => {
    console.error('❌ Launch failed:', err.message);
    process.exit(1);
  });

// Simple error handling
bot.catch(() => {});

// Express for Render health check
const express = require('express');
const app = express();
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.json({ bot: 'online' }));
app.listen(process.env.PORT || 3000, () => {
  console.log('🌐 Health check running');
});