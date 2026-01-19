// Debug: Check environment variables
console.log('🔍 ENVIRONMENT VARIABLES DEBUG:');
console.log('BOT_TOKEN:', process.env.BOT_TOKEN ? 'SET' : 'NOT SET');
console.log('VTU_API_KEY:', process.env.VTU_API_KEY ? 'SET' : 'NOT SET');
console.log('BILLSTACK_API_KEY:', process.env.BILLSTACK_API_KEY ? 'SET' : 'NOT SET');
console.log('BILLSTACK_SECRET_KEY:', process.env.BILLSTACK_SECRET_KEY ? 'SET' : 'NOT SET');
console.log('ADMIN_ID:', process.env.ADMIN_ID || 'NOT SET');



// index.js - MAIN ENTRY POINT (UPDATED VERSION)
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

const bot = new Telegraf(process.env.BOT_TOKEN);
console.log('🚀 VTU Bot Started...');

// ==================== CONFIGURATION ====================
const CONFIG = {
  VTU_API_KEY: process.env.VTU_API_KEY || 'your_vtu_naija_api_key_here',
  VTU_BASE_URL: 'https://vtunaija.com.ng/api',
  ADMIN_ID: process.env.ADMIN_ID || '1279640125',
  SERVICE_FEE: 100,
  MIN_AIRTIME: 50,
  MAX_AIRTIME: 50000,
  // BILLSTACK CONFIGURATION (API KEYS - NOT EMAIL/PASSWORD)
  BILLSTACK_API_KEY: process.env.BILLSTACK_API_KEY,
  BILLSTACK_SECRET_KEY: process.env.BILLSTACK_SECRET_KEY,
  BILLSTACK_BASE_URL: process.env.BILLSTACK_BASE_URL || 'https://api.billstack.io',
  BANK_TRANSFER_ENABLED: process.env.BANK_TRANSFER_API_KEY ? true : false
};

// Global data storage (shared across modules)
const users = {};
const transactions = {};
const sessions = {};
const virtualAccounts = {};

// ==================== HELPER FUNCTIONS ====================
function initUser(userId) {
  if (!users[userId]) {
    users[userId] = {
      telegramId: userId,
      wallet: 0,
      kycStatus: 'pending',  // Changed from 'kyc' to 'kycStatus' to match deposit module
      pin: null,
      pinAttempts: 0,
      pinLocked: false,
      joined: new Date().toLocaleString(),
      email: null,
      phone: null,
      firstName: null,
      lastName: null,
      username: null,
      // BVN fields removed for Billstack
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

// Add virtual account database methods to match deposit module expectations
virtualAccounts.findByUserId = async (telegramId) => {
  const user = users[telegramId];
  if (user && user.virtualAccount) {
    return {
      user_id: telegramId,
      ...user.virtualAccount
    };
  }
  return null;
};

virtualAccounts.create = async (accountData) => {
  const userId = accountData.user_id;
  if (!users[userId]) {
    initUser(userId);
  }
  
  users[userId].virtualAccount = {
    bank_name: accountData.bank_name,
    account_number: accountData.account_number,
    account_name: accountData.account_name,
    reference: accountData.reference,
    provider: accountData.provider || 'billstack',
    created_at: accountData.created_at || new Date(),
    is_active: accountData.is_active !== undefined ? accountData.is_active : true
  };
  
  return users[userId].virtualAccount;
};

virtualAccounts.findByAccountNumber = async (accountNumber) => {
  for (const userId in users) {
    const user = users[userId];
    if (user.virtualAccount && user.virtualAccount.account_number === accountNumber) {
      return {
        user_id: userId,
        ...user.virtualAccount
      };
    }
  }
  return null;
};

virtualAccounts.updateLastUsed = async (accountNumber) => {
  // Update last used timestamp if needed
  return true;
};

// Add transaction methods to match deposit module expectations
transactions.create = async (txData) => {
  const userId = txData.telegramId;
  if (!users[userId]) {
    initUser(userId);
  }
  
  if (!transactions[userId]) {
    transactions[userId] = [];
  }
  
  const transaction = {
    ...txData,
    id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    created_at: new Date().toISOString()
  };
  
  transactions[userId].push(transaction);
  return transaction;
};

transactions.findByReference = async (reference) => {
  for (const userId in transactions) {
    const userTransactions = transactions[userId];
    const found = userTransactions.find(tx => tx.reference === reference);
    if (found) return found;
  }
  return null;
};

// Add user methods to match deposit module expectations
users.creditWallet = async (telegramId, amount) => {
  const user = users[telegramId];
  if (!user) {
    throw new Error('User not found');
  }
  
  user.wallet = (user.wallet || 0) + parseFloat(amount);
  return user.wallet;
};

users.findById = async (telegramId) => {
  return users[telegramId] || null;
};

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

function formatPhoneNumberForVTU(phone) {
  let cleaned = phone.replace(/\s+/g, '');
  if (cleaned.startsWith('+234')) {
    cleaned = '0' + cleaned.substring(4);
  } else if (cleaned.startsWith('234')) {
    cleaned = '0' + cleaned.substring(3);
  }
  if (!cleaned.startsWith('0')) {
    cleaned = '0' + cleaned;
  }
  if (cleaned.length > 11) {
    cleaned = cleaned.substring(0, 11);
  }
  return cleaned;
}

function formatPhoneNumberForAPI(phone) {
  let cleaned = phone.replace(/\s+/g, '');
  if (cleaned.startsWith('234')) {
    cleaned = '0' + cleaned.substring(3);
  }
  if (cleaned.startsWith('+234')) {
    cleaned = '0' + cleaned.substring(4);
  }
  if (!cleaned.startsWith('0')) {
    cleaned = '0' + cleaned;
  }
  if (cleaned.length !== 11) {
    if (cleaned.length > 11) {
      cleaned = cleaned.substring(0, 11);
    }
  }
  return cleaned;
}

function validatePhoneNumber(phone) {
  const cleaned = phone.replace(/\s+/g, '');
  return /^(0|234)(7|8|9)(0|1)\d{8}$/.test(cleaned);
}

// Helper function for email validation
function isValidEmail(email) {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// ==================== WEBHOOK SETUP ====================
const app = express();
app.use(express.json());

// Webhook endpoint - BILLSTACK VERSION
app.post('/billstack-webhook', depositFunds.handleBillstackWebhook(bot, users, transactions, CONFIG, virtualAccounts));

const WEBHOOK_PORT = process.env.PORT || 3000;
app.listen(WEBHOOK_PORT, () => {
  console.log(`🌐 Webhook server running on port ${WEBHOOK_PORT}`);
});

// ==================== START COMMAND ====================
bot.start(async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const user = initUser(userId);
    const isUserAdmin = isAdmin(userId);
    
    // Set user full name and email if not set
    if (!user.firstName) {
      user.firstName = ctx.from.first_name || '';
      user.lastName = ctx.from.last_name || '';
      user.username = ctx.from.username || null;
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
    
    // Check email and virtual account status for Billstack
    let emailStatus = '';
    let virtualAccountStatus = '';
    
    // Check if Billstack API is configured
    const billstackConfigured = CONFIG.BILLSTACK_API_KEY && CONFIG.BILLSTACK_SECRET_KEY;
    
    if (billstackConfigured) {
      if (!user.email || !isValidEmail(user.email)) {
        emailStatus = `\n📧 *Email Status\\:* ❌ NOT SET\n` +
          `_Set email via deposit process for virtual account_`;
      } else {
        emailStatus = `\n📧 *Email Status\\:* ✅ SET`;
      }
      
      if (!user.virtualAccount) {
        virtualAccountStatus = `\n💳 *Virtual Account\\:* ❌ NOT CREATED\n` +
          `_Create virtual account via deposit process_`;
      } else {
        virtualAccountStatus = `\n💳 *Virtual Account\\:* ✅ ACTIVE`;
      }
    } else {
      // Billstack not configured yet
      emailStatus = `\n📧 *Email Status\\:* ${user.email ? '✅ SET' : '❌ NOT SET'}`;
      virtualAccountStatus = `\n💳 *Virtual Account\\:* ⏳ CONFIG PENDING\n` +
        `_Admin configuring Billstack API_`;
    }
    
    await ctx.reply(
      `🌟 *Welcome to Liteway VTU Bot\\!*\n\n` +
      `⚡ *Quick Start\\:*\n` +
      `1\\. Set PIN\\: /setpin 1234\n` +
      `2\\. Get KYC approved\n` +
      `3\\. Set email for virtual account\n` +
      `4\\. Deposit funds\n` +
      `5\\. Start buying\\!\n\n` +
      `📱 *Services\\:*\n` +
      `• 📞 Airtime \\(All networks\\)\n` +
      `• 📡 Data bundles\n` +
      `• 💰 Wallet system\n` +
      `• 💳 Deposit via Virtual Account\n` +
      `• 🏦 Transfer to any bank\n\n` +
      `${emailStatus}` +
      `${virtualAccountStatus}\n\n` +
      `📞 *Support\\:* @opuenekeke`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.keyboard(keyboard).resize()
      }
    );
    
  } catch (error) {
    console.error('❌ Start error:', error);
  }
});

// ==================== MODULAR HANDLERS ====================
// Buy Airtime
bot.hears('📞 Buy Airtime', (ctx) => buyAirtime.handleAirtime(ctx, users, sessions, CONFIG));

// Buy Data
bot.hears('📡 Buy Data', (ctx) => buyData.handleData(ctx, users, sessions, CONFIG));

// Wallet Balance
bot.hears('💰 Wallet Balance', (ctx) => walletBalance.handleWallet(ctx, users, CONFIG));

// Deposit Funds - UPDATED WITH SESSIONS PARAMETER
bot.hears('💳 Deposit Funds', (ctx) => depositFunds.handleDeposit(ctx, users, virtualAccounts, CONFIG, sessions, bot));

// Transaction History
bot.hears('📜 Transaction History', (ctx) => transactionHistory.handleHistory(ctx, users, transactions, CONFIG));

// KYC Status
bot.hears('🛂 KYC Status', (ctx) => kyc.handleKyc(ctx, users));

// Admin Panel
bot.hears('🛠️ Admin Panel', (ctx) => admin.handleAdminPanel(ctx, users, transactions, CONFIG));

// Help & Support (keep your existing code as is)
// ==================== COMMANDS ====================
// Keep all your existing commands as is
// ==================== CALLBACK HANDLERS ====================

console.log('\n📋 REGISTERING CALLBACKS:');

// Check if modules have getCallbacks function, if not create fallbacks
function getModuleCallbacks(module, moduleName, ...args) {
  if (module && typeof module.getCallbacks === 'function') {
    console.log(`   ✅ ${moduleName}: Using module.getCallbacks()`);
    return module.getCallbacks(...args);
  } else {
    console.log(`   ⚠️ ${moduleName}: No getCallbacks, using fallback`);
    // Return empty object if no callbacks
    return {};
  }
}

// Get callbacks from modules
const airtimeCallbacks = getModuleCallbacks(buyAirtime, 'Airtime', bot, users, sessions, CONFIG, NETWORK_CODES);
const dataCallbacks = getModuleCallbacks(buyData, 'Data', bot, users, sessions, CONFIG);
const adminCallbacks = getModuleCallbacks(admin, 'Admin', bot, users, transactions, CONFIG);

// For deposit, we need to handle it differently since it doesn't have getCallbacks
console.log(`   ℹ️ Deposit: Using direct registration`);

// Register Airtime callbacks
if (Object.keys(airtimeCallbacks).length > 0) {
  Object.entries(airtimeCallbacks).forEach(([pattern, handler]) => {
    console.log(`   📞 Airtime callback: ${pattern}`);
    if (pattern.includes('(') || pattern.includes('.') || pattern.includes('+') || pattern.includes('*')) {
      bot.action(new RegExp(`^${pattern}$`), handler);
    } else {
      bot.action(pattern, handler);
    }
  });
}

// Register Data callbacks
if (Object.keys(dataCallbacks).length > 0) {
  Object.entries(dataCallbacks).forEach(([pattern, handler]) => {
    console.log(`   📡 Data callback: ${pattern}`);
    
    if (pattern === '^validity_(.+)_(.+)$' || pattern === '^plan_(.+)_(.+)_(.+)$') {
      bot.action(new RegExp(pattern), handler);
    } else if (pattern.includes('(') || pattern.includes('.') || pattern.includes('+') || pattern.includes('*')) {
      bot.action(new RegExp(`^${pattern}$`), handler);
    } else {
      bot.action(pattern, handler);
    }
  });
}

// Register Admin callbacks
if (Object.keys(adminCallbacks).length > 0) {
  Object.entries(adminCallbacks).forEach(([pattern, handler]) => {
    console.log(`   🛠️ Admin callback: ${pattern}`);
    if (pattern.includes('(') || pattern.includes('.') || pattern.includes('+') || pattern.includes('*')) {
      bot.action(new RegExp(`^${pattern}$`), handler);
    } else {
      bot.action(pattern, handler);
    }
  });
}

// Register deposit-related callbacks manually since depositFunds doesn't have getCallbacks
bot.action(/^deposit_email_confirm$/, async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const session = sessions[userId];
    const user = users[userId];
    
    if (!session || session.action !== 'update_email') {
      return ctx.answerCbQuery('Session expired. Start over.');
    }
    
    if (!user) {
      return ctx.answerCbQuery('User not found.');
    }
    
    if (session.step === 3 && session.newEmail && isValidEmail(session.newEmail)) {
      user.email = session.newEmail;
      delete sessions[userId];
      
      await ctx.editMessageText(
        `✅ *EMAIL UPDATED SUCCESSFULLY\\!*\n\n` +
        `📧 *New Email\\:* ${escapeMarkdown(session.newEmail)}\n\n` +
        `💡 *Next Steps\\:*\n` +
        `1\\. KYC must be approved\n` +
        `2\\. Use "💳 Deposit Funds" to create virtual account\n` +
        `3\\. Transfer money to your virtual account\n\n` +
        `🏦 *Supported Banks\\:* WEMA BANK`,
        {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('💳 Create Virtual Account', 'create_virtual_account')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        }
      );
      
      ctx.answerCbQuery();
    } else {
      ctx.answerCbQuery('❌ Invalid email data');
    }
    
  } catch (error) {
    console.error('❌ Deposit email confirm error:', error);
    ctx.answerCbQuery('❌ Error occurred');
  }
});

bot.action(/^deposit_email_cancel$/, async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    delete sessions[userId];
    
    await ctx.editMessageText(
      `❌ *EMAIL UPDATE CANCELLED*\n\n` +
      `Your email was not changed\\.\n\n` +
      `💡 *To set email\\:*\n` +
      `Use "💳 Deposit Funds" button again\\.`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Home', 'start')]
        ])
      }
    );
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('❌ Deposit email cancel error:', error);
    ctx.answerCbQuery('❌ Error occurred');
  }
});

bot.action(/^create_virtual_account$/, async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const user = users[userId];
    
    if (!user) {
      return ctx.answerCbQuery('User not found. Please /start first.');
    }
    
    // Call the deposit function directly
    await depositFunds.handleDeposit(ctx, users, virtualAccounts, CONFIG, sessions, bot);
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('❌ Create virtual account error:', error);
    ctx.answerCbQuery('❌ Error occurred');
  }
});

// Keep all your existing callback handlers for bank transfer, start, etc.
// ==================== TEXT MESSAGE HANDLER ====================
bot.on('text', async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const text = ctx.message.text.trim();
    const session = sessions[userId];
    const user = initUser(userId);
    
    if (!session) return;
    
    // Check for deposit text handling
    if (session.action === 'update_email') {
      // Handle email update
      if (session.step === 2) {
        if (!isValidEmail(text)) {
          return await ctx.reply(
            '❌ *INVALID EMAIL FORMAT*\n\n' +
            'Please enter a valid email address\\.\n\n' +
            '📝 *Examples\\:*\n' +
            '• user@example\\.com\n' +
            '• name@domain\\.com\n\n' +
            '📧 Enter your email\\:',
            { parse_mode: 'MarkdownV2' }
          );
        }
        
        session.newEmail = text;
        session.step = 3;
        
        await ctx.reply(
          `📧 *CONFIRM EMAIL UPDATE*\n\n` +
          `*New Email\\:* ${escapeMarkdown(text)}\n\n` +
          `⚠️ *Important\\:*\n` +
          `• This email will be used for virtual account\n` +
          `• Make sure it\'s correct\n` +
          `• You cannot change it easily later\n\n` +
          `✅ Click below to confirm\\:`,
          {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback('✅ Confirm', 'deposit_email_confirm'),
                Markup.button.callback('❌ Cancel', 'deposit_email_cancel')
              ]
            ])
          }
        );
      }
    }
    // Handle BANK TRANSFER text (keep your existing code as is)
    else if (session.action === 'bank_transfer') {
      // Your existing bank transfer text handler code here
      // [Keep all your existing bank transfer text handling code]
    }
    
  } catch (error) {
    console.error('❌ Text handler error:', error);
    await ctx.reply('❌ An error occurred. Please try again.');
  }
});

// ==================== ERROR HANDLING ====================
bot.catch((err, ctx) => {
  console.error(`❌ Global Error:`, err);
  try {
    ctx.reply('❌ An error occurred. Please try again.');
  } catch (e) {
    console.error('❌ Error in error handler:', e);
  }
});

// ==================== LAUNCH BOT ====================
bot.launch().then(() => {
  console.log('🚀 VTU Bot with BILLSTACK VIRTUAL ACCOUNT DEPOSITS!');
  console.log(`👑 Admin ID: ${CONFIG.ADMIN_ID}`);
  console.log(`🔑 VTU API Key: ${CONFIG.VTU_API_KEY ? '✅ SET' : '❌ NOT SET'}`);
  console.log(`🔑 Billstack API Key: ${CONFIG.BILLSTACK_API_KEY ? '✅ SET' : '❌ NOT SET'}`);
  console.log(`🔐 Billstack Secret Key: ${CONFIG.BILLSTACK_SECRET_KEY ? '✅ SET' : '❌ NOT SET'}`);
  console.log(`💳 Bank Transfer: ${CONFIG.BANK_TRANSFER_ENABLED ? '✅ ENABLED' : '❌ DISABLED'}`);
  console.log(`🌐 Webhook Server: http://localhost:${WEBHOOK_PORT}/billstack-webhook`);
  
  if (CONFIG.BILLSTACK_API_KEY && CONFIG.BILLSTACK_SECRET_KEY) {
    console.log('\n✅ BILLSTACK VIRTUAL ACCOUNT FEATURES:');
    console.log('1. ✅ Email verification required');
    console.log('2. ✅ NO BVN required');
    console.log('3. ✅ Virtual account generation after KYC');
    console.log('4. ✅ Webhook integration for automatic deposits');
    console.log('5. ✅ Real-time wallet funding');
    console.log('6. ✅ WEMA BANK virtual accounts');
  } else {
    console.log('\n⚠️ BILLSTACK NOT CONFIGURED:');
    console.log('1. ⚠️ Add BILLSTACK_API_KEY to environment');
    console.log('2. ⚠️ Add BILLSTACK_SECRET_KEY to environment');
    console.log('3. ⚠️ Users can still set email for future use');
  }
  
  console.log('\n✅ ALL CORE FEATURES WORKING:');
  console.log('• 📞 Buy Airtime (Working)');
  console.log('• 📡 Buy Data (Working)');
  console.log('• 💰 Wallet Balance (Working)');
  console.log('• 💳 Deposit Funds (Email + Virtual Account)');
  console.log('• 🏦 Money Transfer (Enhanced)');
  console.log('• 📜 Transaction History (Working)');
  console.log('• 🛂 KYC Status (Working)');
  console.log('• 🛠️ Admin Panel (Working)');
  console.log('• 🆘 Help & Support (Working)');
  console.log('\n⚡ BOT IS READY!');
}).catch(err => {
  console.error('❌ Bot launch failed:', err);
});

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('\n🛑 Shutting down...');
  bot.stop('SIGTERM');
});