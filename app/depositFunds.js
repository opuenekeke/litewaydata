/**
 * depositFunds.js - FIXED VERSION with Callback Registration
 */

const axios = require('axios');
const crypto = require('crypto');

/* =====================================================
   ENV VARIABLES & CONFIG
===================================================== */
const {
  BILLSTACK_API_KEY,
  BILLSTACK_SECRET_KEY,
  BILLSTACK_BASE_URL = 'https://api.billstack.co',
  BILLSTACK_WEBHOOK_SECRET,
  NODE_ENV
} = process.env;

const CONFIG = {
  BILLSTACK_TOKEN: BILLSTACK_SECRET_KEY || BILLSTACK_API_KEY || '',
  BILLSTACK_BASE_URL: BILLSTACK_BASE_URL,
  BILLSTACK_WEBHOOK_SECRET: BILLSTACK_WEBHOOK_SECRET || '',
  TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000,
  
  BILLSTACK_ENABLED: (BILLSTACK_SECRET_KEY || BILLSTACK_API_KEY) ? true : false,
  
  SUPPORTED_BANKS: ['9PSB', 'SAFEHAVEN', 'PROVIDUS', 'BANKLY', 'PALMPAY'],
  DEFAULT_BANK: 'PALMPAY',
  
  TEST_MODE: !(BILLSTACK_SECRET_KEY || BILLSTACK_API_KEY) || NODE_ENV === 'development',
  TEST_VIRTUAL_ACCOUNT: {
    bank_name: 'PALMPAY BANK',
    account_number: `TEST${Date.now().toString().slice(-6)}`,
    account_name: 'TEST USER ACCOUNT',
    reference: 'TEST-REF',
    provider: 'test',
    bank_code: 'PALMPAY',
    created_at: new Date(),
    is_active: true
  }
};

console.log('🔧 Billstack Configuration:');
console.log('- Base URL:', CONFIG.BILLSTACK_BASE_URL);
console.log('- Has Token:', !!CONFIG.BILLSTACK_TOKEN);
console.log('- Test Mode:', CONFIG.TEST_MODE);

/* =====================================================
   SESSION MANAGER
===================================================== */
class DepositSessionManager {
  constructor() {
    this.sessions = new Map();
  }

  startSession(userId, action) {
    this.sessions.set(userId, {
      action: action,
      step: 1,
      data: {},
      timestamp: Date.now()
    });
    console.log(`📝 Session started for ${userId}: ${action}`);
  }

  updateStep(userId, step, data = {}) {
    const session = this.sessions.get(userId);
    if (session) {
      session.step = step;
      Object.assign(session.data, data);
    }
  }

  getSession(userId) {
    return this.sessions.get(userId);
  }

  clearSession(userId) {
    this.sessions.delete(userId);
    console.log(`🗑️ Session cleared for ${userId}`);
  }

  cleanupOldSessions(maxAge = 30 * 60 * 1000) {
    const now = Date.now();
    for (const [userId, session] of this.sessions.entries()) {
      if (now - session.timestamp > maxAge) {
        this.sessions.delete(userId);
      }
    }
  }
}

const sessionManager = new DepositSessionManager();

/* =====================================================
   AXIOS CLIENT
===================================================== */
const createBillstackClient = () => {
  const client = axios.create({
    baseURL: CONFIG.BILLSTACK_BASE_URL,
    timeout: CONFIG.TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'VTU-Bot/1.0'
    }
  });

  client.interceptors.request.use(
    (config) => {
      console.log(`📤 ${config.method.toUpperCase()} ${config.url}`);
      
      if (CONFIG.BILLSTACK_TOKEN) {
        config.headers['Authorization'] = `Bearer ${CONFIG.BILLSTACK_TOKEN}`;
      }
      
      return config;
    },
    (error) => {
      console.error('❌ Request interceptor error:', error.message);
      return Promise.reject(error);
    }
  );

  client.interceptors.response.use(
    (response) => {
      console.log(`✅ ${response.status} ${response.config.url}`);
      return response;
    },
    async (error) => {
      console.error('❌ API Error:', error.message);
      
      const shouldRetry = error.code === 'ECONNRESET' || 
                         error.code === 'ETIMEDOUT' || 
                         error.code === 'ENOTFOUND' ||
                         error.code === 'ECONNREFUSED';
      
      if (shouldRetry && error.config) {
        if (!error.config._retryCount) {
          error.config._retryCount = 0;
        }
        
        if (error.config._retryCount < CONFIG.MAX_RETRIES) {
          error.config._retryCount++;
          const delay = CONFIG.RETRY_DELAY * error.config._retryCount;
          
          console.log(`⏳ Retry ${error.config._retryCount}/${CONFIG.MAX_RETRIES} in ${delay}ms`);
          
          await new Promise(resolve => setTimeout(resolve, delay));
          
          return client(error.config);
        }
      }
      
      return Promise.reject(error);
    }
  );

  return client;
};

const billstackClient = createBillstackClient();

/* =====================================================
   UTILITY FUNCTIONS
===================================================== */
function generateReference(telegramId) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 6).toUpperCase();
  return `VTU-${telegramId}-${timestamp}-${random}`;
}

function formatPhoneNumber(phone) {
  if (!phone) return '08012345678';
  
  let cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    return cleaned;
  } else if (cleaned.length === 13 && cleaned.startsWith('234')) {
    return '0' + cleaned.substring(3);
  } else if (cleaned.length === 10) {
    return '0' + cleaned;
  }
  
  return '08012345678';
}

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validatePhone(phone) {
  const cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    return true;
  } else if (cleaned.length === 13 && cleaned.startsWith('234')) {
    return true;
  } else if (cleaned.length === 10) {
    return true;
  }
  
  return false;
}

/* =====================================================
   1️⃣ VIRTUAL ACCOUNT CREATION
===================================================== */
async function createVirtualAccountForUser(user) {
  try {
    console.log(`\n🏦 Creating virtual account for user ${user.telegramId}`);
    
    if (CONFIG.TEST_MODE) {
      console.log('🧪 TEST MODE: Returning test account');
      return {
        ...CONFIG.TEST_VIRTUAL_ACCOUNT,
        account_name: `${user.firstName || 'User'} ${user.lastName || ''}`.trim() || 'User Account'
      };
    }
    
    if (!CONFIG.BILLSTACK_TOKEN) {
      throw new Error('Billstack API token not configured');
    }
    
    const reference = generateReference(user.telegramId);
    const formattedPhone = user.phone ? formatPhoneNumber(user.phone) : '08012345678';
    
    const requestData = {
      email: user.email,
      reference: reference,
      firstName: user.firstName || 'User',
      lastName: user.lastName || 'Customer',
      phone: formattedPhone,
      bank: CONFIG.DEFAULT_BANK
    };

    console.log('📤 Request data:', requestData);

    const response = await billstackClient.post(
      '/v2/thirdparty/generateVirtualAccount/',
      requestData
    );

    console.log('📥 Response:', response.data);

    if (!response.data.status) {
      throw new Error(response.data.message || 'Failed to create account');
    }

    const accountData = response.data.data;
    if (!accountData || !accountData.account || accountData.account.length === 0) {
      throw new Error('No account data returned');
    }

    const firstAccount = accountData.account[0];
    
    console.log(`✅ Account created successfully`);

    return {
      bank_name: firstAccount.bank_name,
      account_number: firstAccount.account_number,
      account_name: firstAccount.account_name,
      reference: reference,
      provider: 'billstack',
      bank_code: firstAccount.bank_id || CONFIG.DEFAULT_BANK,
      created_at: new Date(firstAccount.created_at || new Date()),
      is_active: true
    };

  } catch (error) {
    console.error(`❌ Failed to create account: ${error.message}`);
    
    if (error.response?.status === 401) {
      throw new Error('Invalid Billstack API token. Please contact admin.');
    }
    
    throw new Error(`Virtual account creation failed: ${error.message}`);
  }
}

/* =====================================================
   2️⃣ MAIN DEPOSIT COMMAND
===================================================== */
async function handleDeposit(ctx, users, virtualAccounts) {
  try {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    console.log(`💰 Deposit requested by ${telegramId}`);
    
    const user = await users.findById(telegramId);
    if (!user) {
      return ctx.reply('❌ Account not found. Please /start first.');
    }

    if (user.kycStatus !== 'approved') {
      return ctx.reply('📝 KYC Verification Required\n\nPlease use /kyc to verify.');
    }

    const needsEmail = !user.email;
    const needsPhone = !user.phone;
    
    if (needsEmail || needsPhone) {
      if (needsEmail) {
        sessionManager.startSession(telegramId, 'collect_email');
        return ctx.reply(
          '📧 *Email Required*\n\nPlease enter your email address:',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🚫 Cancel', 'cancel_deposit')]
            ])
          }
        );
      } else if (needsPhone) {
        sessionManager.startSession(telegramId, 'collect_phone');
        return ctx.reply(
          `📱 *Phone Required*\n\nYour email: ${user.email}\n\nPlease enter your phone number:`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📧 Change Email', 'change_email')],
              [Markup.button.callback('🚫 Cancel', 'cancel_deposit')]
            ])
          }
        );
      }
    }

    const virtualAccount = await virtualAccounts.findByUserId(telegramId);
    
    if (!virtualAccount || !virtualAccount.is_active) {
      return ctx.reply(
        `🏦 *DEPOSIT FUNDS*\n\n` +
        `📧 Email: ${user.email}\n` +
        `📱 Phone: ${user.phone}\n` +
        `🛂 KYC: ✅ Approved\n\n` +
        `💡 Choose deposit method:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('💳 Create Virtual Account', 'create_virtual_account')],
            [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        }
      );
    } else {
      await ctx.reply(
        `💰 *Your Account*\n\n` +
        `🏦 Bank: ${virtualAccount.bank_name}\n` +
        `🔢 Account: \`${virtualAccount.account_number}\`\n` +
        `👤 Name: ${virtualAccount.account_name}\n\n` +
        `💡 Transfer to this account to deposit funds.`,
        { parse_mode: 'Markdown' }
      );
    }

  } catch (error) {
    console.error('Deposit command error:', error);
    await ctx.reply(`❌ Error: ${error.message}`);
  }
}

/* =====================================================
   3️⃣ TEXT MESSAGE HANDLER
===================================================== */
async function handleDepositText(ctx, text, users, virtualAccounts) {
  try {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    const session = sessionManager.getSession(telegramId);
    
    if (!session) return false;
    
    const user = await users.findById(telegramId);
    if (!user) return false;
    
    if (session.action === 'collect_email') {
      const email = text.trim();
      
      if (!validateEmail(email)) {
        await ctx.reply('❌ Invalid email. Please enter a valid email:');
        return true;
      }
      
      user.email = email;
      await users.update(telegramId, { email: email });
      
      sessionManager.startSession(telegramId, 'collect_phone');
      
      await ctx.reply(
        `✅ Email saved: ${email}\n\n` +
        `📱 Now enter your phone number:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('↩️ Back', 'change_email')],
            [Markup.button.callback('🚫 Cancel', 'cancel_deposit')]
          ])
        }
      );
      return true;
    }
    
    if (session.action === 'collect_phone') {
      const phone = text.trim();
      
      if (!validatePhone(phone)) {
        await ctx.reply('❌ Invalid phone. Please enter a valid Nigerian number:');
        return true;
      }
      
      user.phone = phone;
      await users.update(telegramId, { phone: phone });
      
      sessionManager.clearSession(telegramId);
      
      await ctx.reply(
        `✅ *Registration Complete!*\n\n` +
        `📧 Email: ${user.email}\n` +
        `📱 Phone: ${user.phone}\n\n` +
        `Now create your virtual account:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('💳 Create Virtual Account', 'create_virtual_account')],
            [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        }
      );
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.error('Text handler error:', error);
    return false;
  }
}

/* =====================================================
   4️⃣ CALLBACK QUERY HANDLERS
===================================================== */
async function handleCreateVirtualAccount(ctx, users, virtualAccounts, bot) {
  console.log('🟢 CALLBACK TRIGGERED: create_virtual_account');
  
  try {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    
    console.log(`👤 User ${telegramId} clicked create_virtual_account`);
    
    // First answer the callback query to remove loading state
    await ctx.answerCbQuery('⏳ Creating account...');
    
    // Edit the message to show processing
    try {
      await ctx.editMessageText(
        `🔄 *Creating Virtual Account...*\n\n` +
        `⏳ Please wait...`,
        { parse_mode: 'Markdown' }
      );
    } catch (editError) {
      // If edit fails, send a new message
      await ctx.reply(
        `🔄 *Creating Virtual Account...*\n\n` +
        `⏳ Please wait...`,
        { parse_mode: 'Markdown' }
      );
    }
    
    const user = await users.findById(telegramId);
    if (!user) {
      await ctx.reply('❌ User not found. Please /start first.');
      return;
    }
    
    console.log('📋 User data:', {
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName
    });
    
    if (!user.email || !user.phone) {
      await ctx.reply(
        `❌ Missing information.\n\n` +
        `Email: ${user.email ? '✅' : '❌'}\n` +
        `Phone: ${user.phone ? '✅' : '❌'}\n\n` +
        `Please use /deposit again to set both.`
      );
      return;
    }
    
    try {
      console.log('🚀 Starting virtual account creation...');
      const newAccount = await createVirtualAccountForUser({
        telegramId: user.telegramId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        phone: user.phone
      });

      console.log('✅ Account created, saving to database...');
      await virtualAccounts.create({
        user_id: telegramId,
        ...newAccount
      });
      
      let message = `✅ *Virtual Account Created!*\n\n`;
      
      if (newAccount.provider === 'test') {
        message += `🧪 *TEST MODE*\n`;
        message += `This is a test account.\n\n`;
      }
      
      message += `🏦 *Bank:* ${newAccount.bank_name}\n`;
      message += `🔢 *Account Number:* \`${newAccount.account_number}\`\n`;
      message += `👤 *Account Name:* ${newAccount.account_name}\n\n`;
      
      if (newAccount.provider !== 'test') {
        message += `💰 *How to Deposit:*\n`;
        message += `1. Transfer to account above\n`;
        message += `2. Use any bank app\n`;
        message += `3. Minimum: ₦100\n`;
        message += `4. Maximum: ₦1,000,000\n\n`;
        message += `⏱️ *Processing Time:* 1-5 minutes\n`;
      }
      
      message += `📞 *Support:* @opuenekeke`;

      try {
        await ctx.editMessageText(message, { 
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        });
      } catch (editError) {
        await ctx.reply(message, { 
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        });
      }
      
      // Send reminder
      setTimeout(async () => {
        try {
          await bot.telegram.sendMessage(
            telegramId,
            `💡 Reminder: Your virtual account is ready!\n\n` +
            `Bank: ${newAccount.bank_name}\n` +
            `Account: \`${newAccount.account_number}\`\n` +
            `Name: ${newAccount.account_name}`,
            { parse_mode: 'Markdown' }
          );
        } catch (err) {
          console.error('Reminder failed:', err.message);
        }
      }, 60000);
      
    } catch (error) {
      console.error('❌ Account creation error:', error);
      
      const errorMessage = `❌ *Virtual Account Creation Failed*\n\n` +
        `${error.message}\n\n` +
        `💡 *What to do:*\n` +
        `1. Check your email & phone format\n` +
        `2. Try again later\n` +
        `3. Use manual deposit option\n` +
        `4. Contact admin if issue persists`;
      
      try {
        await ctx.editMessageText(errorMessage, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Try Again', 'create_virtual_account')],
            [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
            [Markup.button.callback('📞 Contact Admin', 'contact_admin_direct')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        });
      } catch (editError) {
        await ctx.reply(errorMessage, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Try Again', 'create_virtual_account')],
            [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
            [Markup.button.callback('📞 Contact Admin', 'contact_admin_direct')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Callback handler error:', error);
    await ctx.answerCbQuery('❌ Error occurred');
  }
}

async function handleManualDeposit(ctx) {
  try {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    
    await ctx.answerCbQuery();
    
    await ctx.editMessageText(
      `📋 *MANUAL DEPOSIT*\n\n` +
      `Contact @opuenekeke with:\n` +
      `• User ID: \`${telegramId}\`\n` +
      `• Amount\n` +
      `• Payment proof\n\n` +
      `⏰ Processing: 1-24 hours`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('💳 Try Virtual Account', 'create_virtual_account')],
          [Markup.button.callback('🏠 Home', 'start')]
        ])
      }
    );
    
  } catch (error) {
    console.error('Manual deposit error:', error);
    await ctx.answerCbQuery('❌ Error');
  }
}

async function handleCancelDeposit(ctx) {
  try {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    
    sessionManager.clearSession(telegramId);
    await ctx.answerCbQuery();
    
    await ctx.editMessageText(
      '❌ Deposit cancelled.\n\nUse /deposit to try again.',
      Markup.inlineKeyboard([
        [Markup.button.callback('🏠 Home', 'start')]
      ])
    );
    
  } catch (error) {
    console.error('Cancel error:', error);
    await ctx.answerCbQuery('❌ Error');
  }
}

async function handleChangeEmail(ctx, users) {
  try {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    
    sessionManager.startSession(telegramId, 'collect_email');
    await ctx.answerCbQuery();
    
    await ctx.editMessageText(
      '📧 Please enter your email address:',
      Markup.inlineKeyboard([
        [Markup.button.callback('🚫 Cancel', 'cancel_deposit')]
      ])
    );
    
  } catch (error) {
    console.error('Change email error:', error);
    await ctx.answerCbQuery('❌ Error');
  }
}

async function handleContactAdminDirect(ctx) {
  try {
    const { Markup } = require('telegraf');
    
    await ctx.answerCbQuery();
    
    await ctx.editMessageText(
      '📞 Contact @opuenekeke for assistance.',
      Markup.inlineKeyboard([
        [Markup.button.callback('🏠 Home', 'start')]
      ])
    );
    
  } catch (error) {
    console.error('Contact admin error:', error);
    await ctx.answerCbQuery('❌ Error');
  }
}

/* =====================================================
   5️⃣ SETUP FUNCTION
===================================================== */
function setupDepositHandlers(bot, users, virtualAccounts) {
  console.log('\n📋 SETTING UP DEPOSIT CALLBACK HANDLERS...');
  
  // Register all callback handlers
  bot.action('create_virtual_account', (ctx) => {
    console.log('🟢 create_virtual_account callback triggered');
    return handleCreateVirtualAccount(ctx, users, virtualAccounts, bot);
  });
  
  bot.action('manual_deposit', (ctx) => {
    console.log('🟢 manual_deposit callback triggered');
    return handleManualDeposit(ctx);
  });
  
  bot.action('cancel_deposit', (ctx) => {
    console.log('🟢 cancel_deposit callback triggered');
    return handleCancelDeposit(ctx);
  });
  
  bot.action('change_email', (ctx) => {
    console.log('🟢 change_email callback triggered');
    return handleChangeEmail(ctx, users);
  });
  
  bot.action('contact_admin_direct', (ctx) => {
    console.log('🟢 contact_admin_direct callback triggered');
    return handleContactAdminDirect(ctx);
  });
  
  bot.action('retry_deposit', (ctx) => {
    console.log('🟢 retry_deposit callback triggered');
    return handleDeposit(ctx, users, virtualAccounts);
  });
  
  console.log('✅ Deposit callback handlers registered');
}

/* =====================================================
   6️⃣ EXPORTS
===================================================== */
module.exports = {
  // Main handlers
  handleDeposit,
  handleDepositText,
  
  // Session manager
  sessionManager,
  
  // Virtual account function
  createVirtualAccountForUser,
  
  // Callback handlers (for registration)
  handleCreateVirtualAccount,
  handleManualDeposit,
  handleCancelDeposit,
  handleChangeEmail,
  handleContactAdminDirect,
  
  // Setup function
  setupDepositHandlers,
  
  // Simple webhook handler
  handleBillstackWebhook: () => async (req, res) => {
    console.log('📥 Webhook received');
    res.status(200).json({ status: 'ok' });
  },
  
  // Utility functions
  generateReference,
  validateEmail,
  validatePhone,
  formatPhoneNumber
};