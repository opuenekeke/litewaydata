// index.js - COMPLETE FIXED VERSION WITH ALL FIXES
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

// Debug: Check environment variables
console.log('🔍 ENVIRONMENT VARIABLES DEBUG:');
console.log('BOT_TOKEN:', process.env.BOT_TOKEN ? 'SET' : 'NOT SET');
console.log('VTU_API_KEY:', process.env.VTU_API_KEY ? 'SET' : 'NOT SET');
console.log('BILLSTACK_API_KEY:', process.env.BILLSTACK_API_KEY ? 'SET' : 'NOT SET');
console.log('BILLSTACK_SECRET_KEY:', process.env.BILLSTACK_SECRET_KEY ? 'SET' : 'NOT SET');
console.log('MONNIFY_API_KEY:', process.env.MONNIFY_API_KEY ? 'SET' : 'NOT SET');
console.log('MONNIFY_SECRET_KEY:', process.env.MONNIFY_SECRET_KEY ? 'SET' : 'NOT SET');
console.log('ADMIN_ID:', process.env.ADMIN_ID || 'NOT SET');

// Import the modular components
const buyAirtime = require('./app/buyAirtime');
const buyData = require('./app/buyData');
const depositFunds = require('./app/depositFunds');
const walletBalance = require('./app/walletBalance');
const transactionHistory = require('./app/transactionHistory');
const admin = require('./app/admin');
const kyc = require('./app/kyc');
const sendMoney = require('./app/sendmoney');

// ==================== CONFIGURATION ====================
const CONFIG = {
  VTU_API_KEY: process.env.VTU_API_KEY || 'your_vtu_naija_api_key_here',
  VTU_BASE_URL: 'https://vtunaija.com.ng/api',
  ADMIN_ID: process.env.ADMIN_ID || '1279640125',
  SERVICE_FEE: 100,
  MIN_AIRTIME: 50,
  MAX_AIRTIME: 50000,
  BILLSTACK_API_KEY: process.env.BILLSTACK_API_KEY,
  BILLSTACK_SECRET_KEY: process.env.BILLSTACK_SECRET_KEY,
  BILLSTACK_BASE_URL: process.env.BILLSTACK_BASE_URL || 'https://api.billstack.co',
  MONNIFY_API_KEY: process.env.MONNIFY_API_KEY,
  MONNIFY_SECRET_KEY: process.env.MONNIFY_SECRET_KEY,
  MONNIFY_CONTRACT_CODE: process.env.MONNIFY_CONTRACT_CODE,
  MONNIFY_BASE_URL: process.env.MONNIFY_BASE_URL || 'https://api.monnify.com'
};

// ==================== PERSISTENT STORAGE SETUP ====================
console.log('📁 Initializing persistent storage...');

const dataDir = path.join(__dirname, 'data');
const usersFile = path.join(dataDir, 'users.json');
const transactionsFile = path.join(dataDir, 'transactions.json');
const virtualAccountsFile = path.join(dataDir, 'virtualAccounts.json');
const sessionsFile = path.join(dataDir, 'sessions.json');

async function ensureFile(filePath, defaultData = {}) {
  try {
    await fs.access(filePath);
    console.log(`✅ Found: ${path.basename(filePath)}`);
    return true;
  } catch {
    await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2));
    console.log(`📄 Created: ${path.basename(filePath)}`);
    return false;
  }
}

async function initStorage() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    
    const filesExist = {
      users: await ensureFile(usersFile, {}),
      transactions: await ensureFile(transactionsFile, {}),
      virtualAccounts: await ensureFile(virtualAccountsFile, {}),
      sessions: await ensureFile(sessionsFile, {})
    };
    
    console.log('✅ Persistent storage initialized');
    return filesExist;
  } catch (error) {
    console.error('❌ Storage initialization error:', error);
    return {};
  }
}

// ==================== PERSISTENT DATA LOADERS ====================
async function loadData(filePath, defaultData = {}) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`❌ Error loading ${path.basename(filePath)}:`, error.message);
    return defaultData;
  }
}

async function saveData(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`❌ Error saving ${path.basename(filePath)}:`, error.message);
  }
}

let users = {};
let transactions = {};
let virtualAccountsData = {};
let sessions = {};

async function initializeData() {
  try {
    users = await loadData(usersFile, {});
    transactions = await loadData(transactionsFile, {});
    virtualAccountsData = await loadData(virtualAccountsFile, {});
    sessions = await loadData(sessionsFile, {});
    console.log('✅ All data loaded successfully');
  } catch (error) {
    console.error('❌ Error initializing data:', error);
  }
}

// ==================== CORE FUNCTIONS ====================
async function initUser(userId) {
  if (!users[userId]) {
    const isAdminUser = userId.toString() === CONFIG.ADMIN_ID.toString();
    
    users[userId] = {
      telegramId: userId,
      wallet: 0,
      kycStatus: isAdminUser ? 'approved' : 'pending',
      pin: null,
      pinAttempts: 0,
      pinLocked: false,
      joined: new Date().toLocaleString(),
      email: null,
      phone: null,
      firstName: null,
      lastName: null,
      username: null,
      virtualAccount: null,
      virtualAccountNumber: null,
      virtualAccountBank: null,
      dailyDeposit: 0,
      dailyTransfer: 0,
      lastDeposit: null,
      lastTransfer: null,
      kycSubmittedDate: null,
      kycApprovedDate: isAdminUser ? new Date().toISOString() : null,
      kycRejectedDate: null,
      kycRejectionReason: null,
      // Add KYC fields
      kycSubmitted: false,
      kycDocument: null,
      kycDocumentType: null,
      kycDocumentNumber: null
    };
    
    if (!transactions[userId]) {
      transactions[userId] = [];
    }
    
    await saveData(usersFile, users);
    await saveData(transactionsFile, transactions);
  }
  return users[userId];
}

// ==================== USER METHODS ====================
const userMethods = {
  creditWallet: async (telegramId, amount) => {
    const user = users[telegramId];
    if (!user) throw new Error('User not found');
    
    user.wallet = (user.wallet || 0) + parseFloat(amount);
    await saveData(usersFile, users);
    return user.wallet;
  },

  findById: async (telegramId) => {
    return users[telegramId] || null;
  },

  update: async (telegramId, updateData) => {
    const user = users[telegramId];
    if (!user) await initUser(telegramId);
    
    Object.assign(users[telegramId], updateData);
    await saveData(usersFile, users);
    return users[telegramId];
  },

  getKycStatus: async (telegramId) => {
    const user = users[telegramId];
    if (!user) await initUser(telegramId);
    return users[telegramId]?.kycStatus || 'pending';
  },

  checkKyc: async (telegramId) => {
    const user = users[telegramId];
    if (!user) {
      await initUser(telegramId);
      return false;
    }
    return user.kycStatus === 'approved';
  },

  approveKyc: async (telegramId, adminId) => {
    const user = users[telegramId];
    if (!user) throw new Error('User not found');
    
    user.kycStatus = 'approved';
    user.kycApprovedDate = new Date().toISOString();
    await saveData(usersFile, users);
    return user;
  },

  rejectKyc: async (telegramId, reason) => {
    const user = users[telegramId];
    if (!user) throw new Error('User not found');
    
    user.kycStatus = 'rejected';
    user.kycRejectedDate = new Date().toISOString();
    user.kycRejectionReason = reason;
    await saveData(usersFile, users);
    return user;
  },

  submitKyc: async (telegramId, kycData) => {
    const user = users[telegramId];
    if (!user) throw new Error('User not found');
    
    user.kycStatus = 'submitted';
    user.kycSubmitted = true;
    user.kycSubmittedDate = new Date().toISOString();
    user.kycDocument = kycData.document;
    user.kycDocumentType = kycData.documentType;
    user.kycDocumentNumber = kycData.documentNumber;
    
    if (kycData.firstName) user.firstName = kycData.firstName;
    if (kycData.lastName) user.lastName = kycData.lastName;
    if (kycData.email) user.email = kycData.email;
    if (kycData.phone) user.phone = kycData.phone;
    
    await saveData(usersFile, users);
    return user;
  }
};

// ==================== VIRTUAL ACCOUNTS ====================
const virtualAccounts = {
  findByUserId: async (telegramId) => {
    const user = users[telegramId];
    if (user && user.virtualAccount) {
      return {
        user_id: telegramId,
        ...user.virtualAccount
      };
    }
    return null;
  },

  create: async (accountData) => {
    const userId = accountData.user_id;
    if (!users[userId]) await initUser(userId);
    
    users[userId].virtualAccount = {
      bank_name: accountData.bank_name,
      account_number: accountData.account_number,
      account_name: accountData.account_name,
      reference: accountData.reference,
      provider: accountData.provider || 'billstack',
      created_at: accountData.created_at || new Date(),
      is_active: accountData.is_active !== undefined ? accountData.is_active : true
    };
    
    users[userId].virtualAccountNumber = accountData.account_number;
    users[userId].virtualAccountBank = accountData.bank_name;
    virtualAccountsData[userId] = users[userId].virtualAccount;
    
    await saveData(usersFile, users);
    await saveData(virtualAccountsFile, virtualAccountsData);
    
    return users[userId].virtualAccount;
  },

  findByAccountNumber: async (accountNumber) => {
    for (const userId in virtualAccountsData) {
      const account = virtualAccountsData[userId];
      if (account.account_number === accountNumber) {
        return {
          user_id: userId,
          ...account
        };
      }
    }
    return null;
  }
};

// ==================== TRANSACTION METHODS ====================
const transactionMethods = {
  create: async (txData) => {
    const userId = txData.user_id || txData.telegramId;
    if (!users[userId]) await initUser(userId);
    
    if (!transactions[userId]) {
      transactions[userId] = [];
    }
    
    const transaction = {
      ...txData,
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      created_at: new Date().toISOString()
    };
    
    transactions[userId].push(transaction);
    await saveData(transactionsFile, transactions);
    return transaction;
  },

  findByReference: async (reference) => {
    for (const userId in transactions) {
      const userTransactions = transactions[userId];
      const found = userTransactions.find(tx => tx.reference === reference);
      if (found) return found;
    }
    return null;
  }
};

// ==================== SESSION MANAGER ====================
const sessionManager = {
  getSession: (userId) => sessions[userId] || null,
  
  setSession: async (userId, sessionData) => {
    sessions[userId] = sessionData;
    await saveData(sessionsFile, sessions);
  },
  
  clearSession: async (userId) => {
    delete sessions[userId];
    await saveData(sessionsFile, sessions);
  },
  
  updateSession: async (userId, updates) => {
    if (sessions[userId]) {
      Object.assign(sessions[userId], updates);
      await saveData(sessionsFile, sessions);
    }
  }
};

// ==================== HELPER FUNCTIONS ====================
function setupAutoSave() {
  setInterval(async () => {
    await saveData(usersFile, users);
    await saveData(transactionsFile, transactions);
    await saveData(virtualAccountsFile, virtualAccountsData);
    await saveData(sessionsFile, sessions);
    console.log('💾 Auto-saved all data');
  }, 30000);
}

const NETWORK_CODES = {
  'MTN': '1',
  'GLO': '2',
  '9MOBILE': '3',
  'AIRTEL': '4'
};

const AVAILABLE_NETWORKS = ['MTN', 'Glo', 'AIRTEL', '9MOBILE'];

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
  if (cleaned.startsWith('+234')) cleaned = '0' + cleaned.substring(4);
  else if (cleaned.startsWith('234')) cleaned = '0' + cleaned.substring(3);
  if (!cleaned.startsWith('0')) cleaned = '0' + cleaned;
  if (cleaned.length > 11) cleaned = cleaned.substring(0, 11);
  return cleaned;
}

function validatePhoneNumber(phone) {
  const cleaned = phone.replace(/\s+/g, '');
  return /^(0|234)(7|8|9)(0|1)\d{8}$/.test(cleaned);
}

function isValidEmail(email) {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// ==================== MAIN ASYNC FUNCTION ====================
async function main() {
  try {
    console.log('🚀 VTU Bot Starting...');
    
    // Initialize storage and data
    await initStorage();
    await initializeData();
    
    // Create bot instance
    const bot = new Telegraf(process.env.BOT_TOKEN);
    
    // Setup auto-save
    setupAutoSave();
    
    // ==================== WEBHOOK SETUP ====================
    const app = express();
    app.use(express.json());
    
    console.log('🔧 Setting up deposit handlers...');
    try {
      const usersForDeposit = {
        ...users,
        ...userMethods
      };
      depositFunds.setupDepositHandlers(bot, usersForDeposit, virtualAccounts);
      console.log('✅ Deposit handlers setup complete');
    } catch (error) {
      console.error('❌ Failed to setup deposit handlers:', error);
    }
    
    app.post('/billstack-webhook', depositFunds.handleBillstackWebhook(bot, users, transactions, virtualAccounts));
    
    const WEBHOOK_PORT = process.env.PORT || 3000;
    app.listen(WEBHOOK_PORT, () => {
      console.log(`🌐 Webhook server running on port ${WEBHOOK_PORT}`);
    });
    
    // ==================== START COMMAND ====================
    bot.start(async (ctx) => {
      try {
        const userId = ctx.from.id.toString();
        const user = await initUser(userId);
        const isUserAdmin = isAdmin(userId);
        
        if (!user.firstName) {
          user.firstName = ctx.from.first_name || '';
          user.lastName = ctx.from.last_name || '';
          user.username = ctx.from.username || null;
          await saveData(usersFile, users);
        }
        
        let keyboard = isUserAdmin ? [
          ['📞 Buy Airtime', '📡 Buy Data'],
          ['💰 Wallet Balance', '💳 Deposit Funds'],
          ['🏦 Money Transfer', '📜 Transaction History'],
          ['🛂 KYC Status', '🛠️ Admin Panel'],
          ['🆘 Help & Support']
        ] : [
          ['📞 Buy Airtime', '📡 Buy Data'],
          ['💰 Wallet Balance', '💳 Deposit Funds'],
          ['🏦 Money Transfer', '📜 Transaction History'],
          ['🛂 KYC Status', '🆘 Help & Support']
        ];
        
        let emailStatus = '';
        let virtualAccountStatus = '';
        const billstackConfigured = CONFIG.BILLSTACK_API_KEY && CONFIG.BILLSTACK_SECRET_KEY;
        
        if (billstackConfigured) {
          if (!user.email || !isValidEmail(user.email)) {
            emailStatus = `\n📧 *Email Status\\:* ❌ NOT SET\n_Set email via deposit process for virtual account_`;
          } else {
            emailStatus = `\n📧 *Email Status\\:* ✅ SET`;
          }
          
          if (!user.virtualAccount) {
            virtualAccountStatus = `\n💳 *Virtual Account\\:* ❌ NOT CREATED\n_Create virtual account via deposit process_`;
          } else {
            virtualAccountStatus = `\n💳 *Virtual Account\\:* ✅ ACTIVE`;
          }
        } else {
          emailStatus = `\n📧 *Email Status\\:* ${user.email ? '✅ SET' : '❌ NOT SET'}`;
          virtualAccountStatus = `\n💳 *Virtual Account\\:* ⏳ CONFIG PENDING\n_Admin configuring Billstack API_`;
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
    
    // ==================== KYC CHECK FUNCTION ====================
    async function checkKYCAndPIN(userId, ctx) {
      const user = users[userId];
      if (!user) {
        await ctx.reply('❌ User not found. Please use /start first.');
        return false;
      }
      
      // Check KYC
      if (user.kycStatus !== 'approved') {
        await ctx.reply(
          '❌ *KYC VERIFICATION REQUIRED*\n\n' +
          '📝 Your account needs verification\\.\n\n' +
          `🛂 *KYC Status\\:* ${user.kycStatus.toUpperCase()}\n` +
          '📞 *Contact admin\\:* @opuenekeke',
          { parse_mode: 'MarkdownV2' }
        );
        return false;
      }
      
      // Check PIN
      if (!user.pin) {
        await ctx.reply(
          '❌ *TRANSACTION PIN NOT SET*\n\n' +
          '🔐 *Set PIN\\:* `/setpin 1234`',
          { parse_mode: 'MarkdownV2' }
        );
        return false;
      }
      
      return true;
    }
    
    // ==================== MODULAR HANDLERS ====================
    bot.hears('📞 Buy Airtime', async (ctx) => {
      try {
        const userId = ctx.from.id.toString();
        await initUser(userId);
        
        if (!await checkKYCAndPIN(userId, ctx)) return;
        
        return buyAirtime.handleAirtime(ctx, users, sessionManager, CONFIG, NETWORK_CODES);
      } catch (error) {
        console.error('❌ Airtime handler error:', error);
        ctx.reply('❌ Error loading airtime purchase. Please try again.');
      }
    });
    
    bot.hears('📡 Buy Data', async (ctx) => {
      try {
        const userId = ctx.from.id.toString();
        await initUser(userId);
        
        if (!await checkKYCAndPIN(userId, ctx)) return;
        
        return buyData.handleData(ctx, users, sessionManager, CONFIG, NETWORK_CODES);
      } catch (error) {
        console.error('❌ Data handler error:', error);
        ctx.reply('❌ Error loading data purchase. Please try again.');
      }
    });
    
    bot.hears('💰 Wallet Balance', (ctx) => walletBalance.handleWallet(ctx, users, CONFIG));
    
    bot.hears('💳 Deposit Funds', async (ctx) => {
      try {
        const userId = ctx.from.id.toString();
        await initUser(userId);
        
        const user = users[userId];
        if (!user) {
          await ctx.reply('❌ User not found. Please use /start first.');
          return;
        }
        
        // Check KYC for deposit
        if (user.kycStatus !== 'approved') {
          await ctx.reply(
            '❌ *KYC VERIFICATION REQUIRED*\n\n' +
            '📝 Your account needs verification for deposit\\.\n\n' +
            `🛂 *KYC Status\\:* ${user.kycStatus.toUpperCase()}\n` +
            '📞 *Contact admin\\:* @opuenekeke',
            { parse_mode: 'MarkdownV2' }
          );
          return;
        }
        
        const usersWithMethods = {
          ...users,
          ...userMethods
        };
        
        return depositFunds.handleDeposit(ctx, usersWithMethods, virtualAccounts);
      } catch (error) {
        console.error('❌ Deposit handler error:', error);
        ctx.reply('❌ Error loading deposit. Please try again.');
      }
    });
    
    bot.hears('🏦 Money Transfer', async (ctx) => {
      try {
        const userId = ctx.from.id.toString();
        await initUser(userId);
        
        if (!await checkKYCAndPIN(userId, ctx)) return;
        
        const usersWithMethods = {
          ...users,
          ...userMethods
        };
        
        return sendMoney.handleSendMoney(ctx, usersWithMethods, transactionMethods);
      } catch (error) {
        console.error('❌ Send money handler error:', error);
        ctx.reply('❌ Error loading money transfer. Please try again.');
      }
    });
    
    bot.hears('📜 Transaction History', (ctx) => transactionHistory.handleHistory(ctx, users, transactions, CONFIG));
    
    bot.hears('🛂 KYC Status', async (ctx) => {
      try {
        const userId = ctx.from.id.toString();
        await initUser(userId);
        
        const user = users[userId];
        if (!user) {
          await ctx.reply('❌ User not found. Please use /start first.');
          return;
        }
        
        let statusEmoji = '⏳';
        if (user.kycStatus === 'approved') statusEmoji = '✅';
        else if (user.kycStatus === 'rejected') statusEmoji = '❌';
        else if (user.kycStatus === 'submitted') statusEmoji = '📋';
        
        let kycInfo = '';
        if (user.kycSubmittedDate) {
          kycInfo += `📅 *Submitted\\:* ${user.kycSubmittedDate}\n`;
        }
        if (user.kycApprovedDate) {
          kycInfo += `✅ *Approved\\:* ${user.kycApprovedDate}\n`;
        }
        if (user.kycRejectedDate) {
          kycInfo += `❌ *Rejected\\:* ${user.kycRejectedDate}\n`;
          if (user.kycRejectionReason) {
            kycInfo += `📝 *Reason\\:* ${escapeMarkdown(user.kycRejectionReason)}\n`;
          }
        }
        
        await ctx.reply(
          `🛂 *KYC STATUS*\n\n` +
          `👤 *User ID\\:* ${userId}\n` +
          `📛 *Name\\:* ${user.firstName || ''} ${user.lastName || ''}\n` +
          `📧 *Email\\:* ${user.email || 'Not set'}\n` +
          `📱 *Phone\\:* ${user.phone || 'Not set'}\n\n` +
          `🛂 *Status\\:* ${statusEmoji} ${user.kycStatus.toUpperCase()}\n\n` +
          `${kycInfo}\n` +
          `📞 *Support\\:* @opuenekeke`,
          { parse_mode: 'MarkdownV2' }
        );
        
      } catch (error) {
        console.error('❌ KYC status error:', error);
        ctx.reply('❌ Error checking KYC status. Please try again.');
      }
    });
    
    bot.hears('🛠️ Admin Panel', (ctx) => admin.handleAdminPanel(ctx, users, transactions, CONFIG));
    
    bot.hears('🆘 Help & Support', async (ctx) => {
      try {
        await ctx.reply(
          `🆘 *HELP & SUPPORT*\n\n` +
          `📱 *Main Commands\\:*\n` +
          `/start \\- Start bot\n` +
          `/setpin \\[1234\\] \\- Set transaction PIN\n` +
          `/balance \\- Check wallet balance\n\n` +
          `💡 *Common Issues\\:*\n\n` +
          `🔐 *PIN Issues\\:*\n` +
          `• Forgot PIN\\: Contact admin\n` +
          `• Wrong PIN\\: 3 attempts allowed\n` +
          `• PIN locked\\: Contact admin to unlock\n\n` +
          `💰 *Wallet Issues\\:*\n` +
          `• Missing deposit\\: Send proof to admin\n` +
          `• Wrong balance\\: Contact admin\n` +
          `• Can't deposit\\: Check email & KYC status\n\n` +
          `📧 *Email Issues\\:*\n` +
          `• Email required for virtual account\n` +
          `• Use valid email address\n` +
          `• Contact admin if stuck\n\n` +
          `🏦 *Virtual Account Issues\\:*\n` +
          `• Funds not reflecting\\: Wait 5 minutes\n` +
          `• Wrong account details\\: Contact support\n` +
          `• Bank not accepting\\: Use WEMA BANK\n\n` +
          `📞 *Transaction Issues\\:*\n` +
          `• Failed purchase\\: Check balance & network\n` +
          `• No airtime/data\\: Wait 5 minutes\n` +
          `• Wrong number\\: Double\\-check before confirm\n\n` +
          `⚡ *Quick Contact\\:*\n` +
          `@opuenekeke\n\n` +
          `⏰ *Response Time\\:*\n` +
          `Within 5\\-10 minutes`,
          { parse_mode: 'MarkdownV2' }
        );
        
      } catch (error) {
        console.error('❌ Help error:', error);
      }
    });
    
    // ==================== COMMANDS ====================
    bot.command('setpin', async (ctx) => {
      try {
        const userId = ctx.from.id.toString();
        const user = await initUser(userId);
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
        
        await saveData(usersFile, users);
        
        await ctx.reply('✅ PIN set successfully\\! Use this PIN to confirm transactions\\.', { parse_mode: 'MarkdownV2' });
        
      } catch (error) {
        console.error('❌ Setpin error:', error);
      }
    });
    
    bot.command('balance', async (ctx) => {
      try {
        const userId = ctx.from.id.toString();
        const user = await initUser(userId);
        
        let emailStatus = '';
        let virtualAccountStatus = '';
        const billstackConfigured = CONFIG.BILLSTACK_API_KEY && CONFIG.BILLSTACK_SECRET_KEY;
        
        if (billstackConfigured) {
          if (!user.email || !isValidEmail(user.email)) {
            emailStatus = `📧 *Email Status\\:* ❌ NOT SET\n`;
          } else {
            emailStatus = `📧 *Email Status\\:* ✅ SET\n`;
          }
          
          if (!user.virtualAccount) {
            virtualAccountStatus = `💳 *Virtual Account\\:* ❌ NOT CREATED\n`;
          } else {
            virtualAccountStatus = `💳 *Virtual Account\\:* ✅ ACTIVE\n`;
          }
        } else {
          emailStatus = `📧 *Email Status\\:* ${user.email ? '✅ SET' : '❌ NOT SET'}\n`;
          virtualAccountStatus = `💳 *Virtual Account\\:* ⏳ CONFIG PENDING\n`;
        }
        
        await ctx.reply(
          `💰 *YOUR BALANCE*\n\n` +
          `💵 *Available\\:* ${formatCurrency(user.wallet)}\n` +
          `🛂 *KYC Status\\:* ${user.kycStatus.toUpperCase()}\n` +
          `${emailStatus}` +
          `${virtualAccountStatus}` +
          `💡 Need more funds\\? Use "💳 Deposit Funds" button`,
          { parse_mode: 'MarkdownV2' }
        );
        
      } catch (error) {
        console.error('❌ Balance error:', error);
      }
    });
    
    // Import admin commands
    try {
      const adminCommands = require('./app/admin').getAdminCommands(bot, users, transactions, CONFIG);
      Object.keys(adminCommands).forEach(command => {
        bot.command(command, adminCommands[command]);
      });
    } catch (error) {
      console.error('❌ Failed to load admin commands:', error);
    }
    
    // ==================== CALLBACK HANDLERS ====================
    console.log('\n📋 REGISTERING CALLBACK HANDLERS...');
    
    const airtimeCallbacks = buyAirtime.getCallbacks ? buyAirtime.getCallbacks(bot, users, sessionManager, CONFIG, NETWORK_CODES) : {};
    const dataCallbacks = buyData.getCallbacks ? buyData.getCallbacks(bot, users, sessionManager, CONFIG) : {};
    const adminCallbacks = admin.getCallbacks ? admin.getCallbacks(bot, users, transactions, CONFIG) : {};
    const kycCallbacks = kyc.getCallbacks ? kyc.getCallbacks(bot, users) : {};
    
    const usersForSendMoney = {
      ...users,
      ...userMethods
    };
    
    const sendMoneyCallbacks = sendMoney.getCallbacks ? sendMoney.getCallbacks(bot, usersForSendMoney, transactionMethods, CONFIG) : {};
    
    console.log('📞 Registering airtime callbacks...');
    Object.entries(airtimeCallbacks).forEach(([pattern, handler]) => {
      if (pattern.includes('(') || pattern.includes('.') || pattern.includes('+') || pattern.includes('*')) {
        bot.action(new RegExp(`^${pattern}$`), handler);
      } else {
        bot.action(pattern, handler);
      }
    });
    
    console.log('📡 Registering data callbacks...');
    Object.entries(dataCallbacks).forEach(([pattern, handler]) => {
      if (pattern.includes('(') || pattern.includes('.') || pattern.includes('+') || pattern.includes('*')) {
        bot.action(new RegExp(`^${pattern}$`), handler);
      } else {
        bot.action(pattern, handler);
      }
    });
    
    console.log('🛠️ Registering admin callbacks...');
    Object.entries(adminCallbacks).forEach(([pattern, handler]) => {
      if (pattern.includes('(') || pattern.includes('.') || pattern.includes('+') || pattern.includes('*')) {
        bot.action(new RegExp(`^${pattern}$`), handler);
      } else {
        bot.action(pattern, handler);
      }
    });
    
    console.log('🛂 Registering KYC callbacks...');
    Object.entries(kycCallbacks).forEach(([pattern, handler]) => {
      if (pattern.includes('(') || pattern.includes('.') || pattern.includes('+') || pattern.includes('*')) {
        bot.action(new RegExp(`^${pattern}$`), handler);
      } else {
        bot.action(pattern, handler);
      }
    });
    
    console.log('🏦 Registering send money callbacks...');
    Object.entries(sendMoneyCallbacks).forEach(([pattern, handler]) => {
      if (pattern.includes('(') || pattern.includes('.') || pattern.includes('+') || pattern.includes('*')) {
        bot.action(new RegExp(`^${pattern}$`), handler);
      } else {
        bot.action(pattern, handler);
      }
    });
    
    // Home callback
    bot.action('start', async (ctx) => {
      try {
        const userId = ctx.from.id.toString();
        const user = await initUser(userId);
        const isUserAdmin = isAdmin(userId);
        
        let keyboard = isUserAdmin ? [
          ['📞 Buy Airtime', '📡 Buy Data'],
          ['💰 Wallet Balance', '💳 Deposit Funds'],
          ['🏦 Money Transfer', '📜 Transaction History'],
          ['🛂 KYC Status', '🛠️ Admin Panel'],
          ['🆘 Help & Support']
        ] : [
          ['📞 Buy Airtime', '📡 Buy Data'],
          ['💰 Wallet Balance', '💳 Deposit Funds'],
          ['🏦 Money Transfer', '📜 Transaction History'],
          ['🛂 KYC Status', '🆘 Help & Support']
        ];
        
        await ctx.editMessageText(
          `🌟 *Welcome to Liteway VTU Bot\\!*\n\n` +
          `🛂 *KYC Status\\:* ${user.kycStatus.toUpperCase()}\n` +
          `💵 *Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
          `📱 *Available Services\\:*\n` +
          `• 📞 Buy Airtime\n` +
          `• 📡 Buy Data\n` +
          `• 💰 Wallet Balance\n` +
          `• 💳 Deposit Funds\n` +
          `• 🏦 Money Transfer\n` +
          `• 📜 Transaction History\n` +
          `• 🛂 KYC Status\n` +
          `${isUserAdmin ? '• 🛠️ Admin Panel\n' : ''}` +
          `• 🆘 Help & Support\n\n` +
          `📞 *Support\\:* @opuenekeke`,
          {
            parse_mode: 'MarkdownV2',
            ...Markup.keyboard(keyboard).resize()
          }
        );
        
        ctx.answerCbQuery();
        
      } catch (error) {
        console.error('❌ Start callback error:', error);
      }
    });
    
    console.log('✅ All callback handlers registered');
    
    // ==================== TEXT MESSAGE HANDLER ====================
    bot.on('text', async (ctx) => {
      try {
        const userId = ctx.from.id.toString();
        const text = ctx.message.text.trim();
        
        await initUser(userId);
        
        const usersWithMethods = {
          ...users,
          ...userMethods
        };
        
        // Handle deposit text
        const depositHandled = await depositFunds.handleDepositText(ctx, text, usersWithMethods, virtualAccounts, bot);
        if (depositHandled) return;
        
        // Handle send money text
        const sendMoneyHandled = await sendMoney.handleText(ctx, text, usersWithMethods, transactionMethods);
        if (sendMoneyHandled) return;
        
        // Handle airtime text
        const userSession = sessionManager.getSession(userId);
        if (userSession && userSession.action === 'airtime') {
          const airtimeTextHandler = require('./app/buyAirtime').handleText;
          if (airtimeTextHandler) {
            await airtimeTextHandler(ctx, text, userSession, users[userId], users, transactions, sessionManager, NETWORK_CODES, CONFIG);
            return;
          }
        }
        
        // Handle data text
        if (userSession && userSession.action === 'data') {
          const dataTextHandler = require('./app/buyData').handleText;
          if (dataTextHandler) {
            await dataTextHandler(ctx, text, userSession, users[userId], users, transactions, sessionManager, NETWORK_CODES, CONFIG);
            return;
          }
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
      console.log('🚀 VTU Bot Launched Successfully!');
      console.log(`👑 Admin ID: ${CONFIG.ADMIN_ID}`);
      console.log(`🔑 VTU API Key: ${CONFIG.VTU_API_KEY ? '✅ SET' : '❌ NOT SET'}`);
      console.log(`🔑 Billstack API Key: ${CONFIG.BILLSTACK_API_KEY ? '✅ SET' : '❌ NOT SET'}`);
      console.log(`🔐 Billstack Secret Key: ${CONFIG.BILLSTACK_SECRET_KEY ? '✅ SET' : '❌ NOT SET'}`);
      console.log(`🔑 Monnify API Key: ${CONFIG.MONNIFY_API_KEY ? '✅ SET' : '❌ NOT SET'}`);
      console.log(`🔐 Monnify Secret Key: ${CONFIG.MONNIFY_SECRET_KEY ? '✅ SET' : '❌ NOT SET'}`);
      console.log(`🌐 Webhook Server: http://localhost:${WEBHOOK_PORT}/billstack-webhook`);
      
      console.log('\n✅ ALL CORE FEATURES:');
      console.log('• 📞 Buy Airtime');
      console.log('• 📡 Buy Data');
      console.log('• 💰 Wallet Balance');
      console.log('• 💳 Deposit Funds');
      console.log('• 🏦 Money Transfer');
      console.log('• 📜 Transaction History');
      console.log('• 🛂 KYC Status (FIXED)');
      console.log('• 🛠️ Admin Panel');
      console.log('• 🆘 Help & Support');
      console.log('\n⚡ BOT IS READY!');
    }).catch(err => {
      console.error('❌ Bot launch failed:', err);
    });
    
  } catch (error) {
    console.error('❌ Main initialization error:', error);
  }
}

// ==================== GRACEFUL SHUTDOWN ====================
process.once('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  console.log('💾 Saving all data before shutdown...');
  await saveData(usersFile, users);
  await saveData(transactionsFile, transactions);
  await saveData(virtualAccountsFile, virtualAccountsData);
  await saveData(sessionsFile, sessions);
  bot.stop('SIGINT');
});

process.once('SIGTERM', async () => {
  console.log('\n🛑 Shutting down...');
  console.log('💾 Saving all data before shutdown...');
  await saveData(usersFile, users);
  await saveData(transactionsFile, transactions);
  await saveData(virtualAccountsFile, virtualAccountsData);
  await saveData(sessionsFile, sessions);
  bot.stop('SIGTERM');
});

// Start the application
main();