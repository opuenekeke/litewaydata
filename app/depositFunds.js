/**
 * depositFunds.js - COMPLETE FIXED VERSION with Proper Flow
 */

const axios = require('axios');
const crypto = require('crypto');

/* =====================================================
   ENV VARIABLES & CONFIG
===================================================== */
const {
  BILLSTACK_API_KEY,
  BILLSTACK_BASE_URL = 'https://api.billstack.co',
  BILLSTACK_WEBHOOK_SECRET,
  NODE_ENV
} = process.env;

const CONFIG = {
  BILLSTACK_API_KEY: BILLSTACK_API_KEY || '',
  BILLSTACK_BASE_URL: BILLSTACK_BASE_URL,
  BILLSTACK_WEBHOOK_SECRET: BILLSTACK_WEBHOOK_SECRET || '',
  TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000,
  BILLSTACK_ENABLED: BILLSTACK_API_KEY ? true : false,
  
  SUPPORTED_BANKS: ['9PSB', 'SAFEHAVEN', 'PROVIDUS', 'BANKLY', 'PALMPAY'],
  DEFAULT_BANK: 'PALMPAY'
};

if (!CONFIG.BILLSTACK_API_KEY) {
  console.error('❌ CRITICAL: Billstack API key missing');
  if (NODE_ENV === 'production') {
    throw new Error('Billstack API key required');
  }
}

/* =====================================================
   SESSION MANAGER (FIXED)
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

  cleanupOldSessions(maxAge = 30 * 60 * 1000) { // 30 minutes
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

  // Request interceptor
  client.interceptors.request.use(
    (config) => {
      console.log(`📤 ${config.method.toUpperCase()} ${config.url}`);
      return config;
    },
    (error) => {
      console.error('❌ Request interceptor error:', error.message);
      return Promise.reject(error);
    }
  );

  // Response interceptor
  client.interceptors.response.use(
    (response) => {
      console.log(`✅ ${response.status} ${response.config.url}`);
      return response;
    },
    async (error) => {
      const originalRequest = error.config;
      
      console.error('❌ Billstack API Error:', {
        code: error.code,
        message: error.message,
        url: error.config?.url,
        status: error.response?.status,
        data: error.response?.data
      });
      
      const shouldRetry = error.code === 'ECONNRESET' || 
                         error.code === 'ETIMEDOUT' || 
                         error.code === 'ENOTFOUND' ||
                         error.code === 'ECONNREFUSED';
      
      if (shouldRetry && originalRequest) {
        if (!originalRequest._retryCount) {
          originalRequest._retryCount = 0;
        }
        
        if (originalRequest._retryCount < CONFIG.MAX_RETRIES) {
          originalRequest._retryCount++;
          const delay = CONFIG.RETRY_DELAY * originalRequest._retryCount;
          
          console.log(`⏳ Retry ${originalRequest._retryCount}/${CONFIG.MAX_RETRIES} in ${delay}ms`);
          
          await new Promise(resolve => setTimeout(resolve, delay));
          
          return client(originalRequest);
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
  if (!phone) return '2348000000000';
  
  let cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    return '234' + cleaned.substring(1);
  } else if (cleaned.length === 13 && cleaned.startsWith('234')) {
    return cleaned;
  } else if (cleaned.length === 10) {
    return '234' + cleaned;
  } else if (cleaned.length > 13) {
    return cleaned.substring(0, 13);
  }
  
  return '2348000000000';
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
    console.log(`🏦 Creating virtual account for user ${user.telegramId}`);
    
    if (!CONFIG.BILLSTACK_API_KEY) {
      throw new Error('Billstack API key not configured');
    }
    
    const reference = generateReference(user.telegramId);
    const formattedPhone = user.phone ? formatPhoneNumber(user.phone) : '2348000000000';
    
    const requestData = {
      email: user.email,
      reference: reference,
      firstName: user.firstName || 'User',
      lastName: user.lastName || user.telegramId.toString(),
      phone: formattedPhone,
      bank: CONFIG.DEFAULT_BANK
    };

    console.log('📤 Creating virtual account with data:', {
      email: requestData.email,
      reference: requestData.reference,
      name: `${requestData.firstName} ${requestData.lastName}`,
      phone: requestData.phone,
      bank: requestData.bank
    });

    const response = await billstackClient.post(
      '/v2/thirdparty/generateVirtualAccount/',
      requestData,
      {
        headers: {
          'Authorization': `Bearer ${CONFIG.BILLSTACK_API_KEY}`,
        }
      }
    );

    console.log('📥 Billstack response:', JSON.stringify(response.data, null, 2));

    if (!response.data.status) {
      throw new Error(response.data.message || 'Failed to create virtual account');
    }

    const accountData = response.data.data;
    if (!accountData || !accountData.account || accountData.account.length === 0) {
      throw new Error('No account data returned from Billstack');
    }

    const firstAccount = accountData.account[0];
    
    console.log(`✅ Virtual account created for ${user.telegramId}:`, {
      bank: firstAccount.bank_name,
      accountNumber: firstAccount.account_number,
      accountName: firstAccount.account_name,
      reference: reference
    });

    return {
      bank_name: firstAccount.bank_name,
      account_number: firstAccount.account_number,
      account_name: firstAccount.account_name,
      reference: reference,
      provider: 'billstack',
      bank_code: firstAccount.bank_id || CONFIG.DEFAULT_BANK,
      created_at: new Date(firstAccount.created_at || new Date()),
      is_active: true,
      raw_response: accountData
    };

  } catch (error) {
    console.error(`❌ Failed to create virtual account for user ${user.telegramId}:`, {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });

    if (error.response) {
      if (error.response.status === 401) {
        throw new Error('Invalid Billstack API key. Please contact admin.');
      } else if (error.response.status === 400) {
        throw new Error('Invalid request data. Please check your email or phone format.');
      } else if (error.response.status === 500) {
        throw new Error('Billstack service error. Please try again later.');
      }
    }
    
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      throw new Error('Network error connecting to Billstack. Please try again.');
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
    console.log(`💰 Deposit requested by user ${telegramId}`);
    
    // Check if user exists
    const user = await users.findById(telegramId);
    if (!user) {
      return ctx.reply(
        '❌ Account not found. Please start the bot with /start first.'
      );
    }

    // KYC check
    if (user.kycStatus !== 'approved') {
      return ctx.reply(
        '📝 KYC Verification Required\n\n' +
        'To deposit funds, you must complete KYC verification first.\n' +
        'Please use /kyc to start the verification process.'
      );
    }

    // Check if user has email and phone
    const needsEmail = !user.email;
    const needsPhone = !user.phone;
    
    if (needsEmail || needsPhone) {
      // Start collection process
      if (needsEmail) {
        sessionManager.startSession(telegramId, 'collect_email');
        return ctx.reply(
          '📧 *Email Address Required*\n\n' +
          'To create a virtual account, we need your email address.\n\n' +
          '📝 Please enter your email address (e.g., user@example.com):',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🚫 Cancel', 'cancel_deposit')]
            ])
          }
        );
      } else if (needsPhone) {
        // If email exists but phone is missing
        sessionManager.startSession(telegramId, 'collect_phone');
        sessionManager.updateStep(telegramId, 1, { email: user.email });
        
        return ctx.reply(
          `📱 *Phone Number Required*\n\n` +
          `📧 Your email: ${user.email}\n\n` +
          `Billstack requires your phone number to create a virtual account.\n\n` +
          `📝 Please enter your phone number:\n` +
          `• Format: 08012345678 or 2348012345678`,
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

    // Check for existing virtual account
    let virtualAccount = await virtualAccounts.findByUserId(telegramId);
    
    if (!virtualAccount || !virtualAccount.is_active) {
      // Show deposit options
      return ctx.reply(
        `🏦 *VIRTUAL ACCOUNT DEPOSIT*\n\n` +
        `📧 *Email:* ${user.email}\n` +
        `📱 *Phone:* ${user.phone || 'Not set'}\n` +
        `🛂 *KYC Status:* ✅ Approved\n\n` +
        `💡 *Create a virtual account for instant deposits:*`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('💳 Create Virtual Account', 'create_virtual_account')],
            [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
            [Markup.button.callback('🔄 Refresh', 'refresh_deposit')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        }
      );
    } else {
      // Show existing account
      const accountMessage = 
        `💰 *Your Deposit Account*\n\n` +
        `🏦 *Bank:* ${virtualAccount.bank_name}\n` +
        `🔢 *Account Number:* \`${virtualAccount.account_number}\`\n` +
        `👤 *Account Name:* ${virtualAccount.account_name}\n\n` +
        `📍 *Status:* ✅ Active\n` +
        `📅 *Created:* ${new Date(virtualAccount.created_at).toLocaleDateString()}\n\n` +
        `💡 *How to Deposit:*\n` +
        `1. Transfer to account above\n` +
        `2. Funds auto-credit in 1-5 mins\n` +
        `3. Minimum: ₦100\n` +
        `4. Maximum: ₦1,000,000\n\n` +
        `⚠️ *Note:* Use PALMPAY or any bank app`;

      await ctx.reply(accountMessage, { parse_mode: 'Markdown' });

      await ctx.reply(
        `📋 *Need help?*`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
            [Markup.button.callback('🔄 Refresh Account', 'refresh_virtual_account')],
            [Markup.button.callback('❌ Delete Account', 'delete_virtual_account')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        }
      );
    }

  } catch (error) {
    console.error('Deposit command error:', error);
    
    const { Markup } = require('telegraf');
    
    await ctx.reply(
      `❌ *DEPOSIT ERROR*\n\n` +
      `${error.message}\n\n` +
      `💡 *What to do:*\n` +
      `1. Try again later\n` +
      `2. Contact admin for help\n` +
      `3. Use manual deposit option`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Try Again', 'retry_deposit')],
          [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
          [Markup.button.callback('📞 Contact Admin', 'contact_admin')],
          [Markup.button.callback('🏠 Home', 'start')]
        ])
      }
    );
  }
}

/* =====================================================
   3️⃣ TEXT MESSAGE HANDLER (COMPLETE FLOW)
===================================================== */
async function handleDepositText(ctx, text, users, virtualAccounts, bot) {
  try {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    const session = sessionManager.getSession(telegramId);
    
    if (!session) {
      // Not in a deposit session
      return false;
    }
    
    const user = await users.findById(telegramId);
    
    // Handle email collection
    if (session.action === 'collect_email') {
      const email = text.trim();
      
      if (!validateEmail(email)) {
        await ctx.reply(
          '❌ Invalid email format.\n\n' +
          'Please enter a valid email address (e.g., user@example.com):',
          Markup.inlineKeyboard([
            [Markup.button.callback('🚫 Cancel', 'cancel_deposit')]
          ])
        );
        return true;
      }
      
      // Save email to session
      sessionManager.updateStep(telegramId, 2, { email: email });
      
      // Update user in database
      user.email = email;
      await users.update(telegramId, { email: email });
      
      // Move to phone collection
      sessionManager.startSession(telegramId, 'collect_phone');
      
      await ctx.reply(
        `✅ Email saved: ${email}\n\n` +
        `📱 *Now enter your phone number:*\n\n` +
        `📝 Format: 08012345678 or +2348012345678\n\n` +
        `*Note:* This is required for virtual account creation`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('↩️ Back to Email', 'change_email')],
            [Markup.button.callback('🚫 Cancel', 'cancel_deposit')]
          ])
        }
      );
      return true;
    }
    
    // Handle phone collection
    if (session.action === 'collect_phone') {
      const phone = text.trim();
      
      if (!validatePhone(phone)) {
        await ctx.reply(
          '❌ Invalid phone number.\n\n' +
          'Please enter a valid Nigerian phone number:\n' +
          '• 08012345678\n' +
          '• 2348012345678\n' +
          '• +2348012345678\n\n' +
          '📝 Try again:',
          Markup.inlineKeyboard([
            [Markup.button.callback('↩️ Back to Email', 'change_email')],
            [Markup.button.callback('🚫 Cancel', 'cancel_deposit')]
          ])
        );
        return true;
      }
      
      // Save phone to user
      user.phone = phone;
      await users.update(telegramId, { phone: phone });
      
      // Clear session
      sessionManager.clearSession(telegramId);
      
      // Show success and next options
      await ctx.reply(
        `✅ *Registration Complete!*\n\n` +
        `📧 *Email:* ${user.email}\n` +
        `📱 *Phone:* ${user.phone}\n\n` +
        `🎉 Now you can create a virtual account for instant deposits.`,
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
    console.error('Deposit text handler error:', error);
    return false;
  }
}

/* =====================================================
   4️⃣ CALLBACK QUERY HANDLERS
===================================================== */
async function handleCreateVirtualAccount(ctx, users, virtualAccounts, bot) {
  try {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    
    await ctx.editMessageText(
      `🔄 *Creating Virtual Account...*\n\n` +
      `⏳ Please wait while we create your virtual account...\n` +
      `This may take up to 30 seconds.`,
      { parse_mode: 'Markdown' }
    );
    
    const user = await users.findById(telegramId);
    
    if (!user) {
      await ctx.editMessageText(
        '❌ User not found. Please restart the bot with /start.',
        Markup.inlineKeyboard([
          [Markup.button.callback('🏠 Home', 'start')]
        ])
      );
      return;
    }
    
    // Verify required fields
    if (!user.email || !user.phone) {
      sessionManager.startSession(telegramId, 'collect_email');
      await ctx.editMessageText(
        `❌ Missing Information\n\n` +
        `We need both email and phone to create your account.\n\n` +
        `📝 Please enter your email address first:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🚫 Cancel', 'cancel_deposit')]
          ])
        }
      );
      return;
    }
    
    try {
      const newAccount = await createVirtualAccountForUser({
        telegramId: user.telegramId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        phone: user.phone
      });

      // Save to database
      await virtualAccounts.create({
        user_id: telegramId,
        ...newAccount
      });
      
      const accountMessage = 
        `✅ *Virtual Account Created Successfully!*\n\n` +
        `🎉 Your virtual account is ready for deposits.\n\n` +
        `🏦 *Bank:* ${newAccount.bank_name}\n` +
        `🔢 *Account Number:* \`${newAccount.account_number}\`\n` +
        `👤 *Account Name:* ${newAccount.account_name}\n\n` +
        `💰 *How to Deposit:*\n` +
        `1. Transfer to the account above\n` +
        `2. Use PALMPAY app or any bank app\n` +
        `3. Minimum: ₦100\n` +
        `4. Maximum: ₦1,000,000\n\n` +
        `⏱️ *Processing Time:* 1-5 minutes\n` +
        `📞 *Support:* Contact admin if issues`;

      await ctx.editMessageText(accountMessage, { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('💳 View Account', 'view_virtual_account')],
          [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
          [Markup.button.callback('🏠 Home', 'start')]
        ])
      });
      
      // Send reminder in 1 minute
      setTimeout(async () => {
        try {
          await bot.telegram.sendMessage(
            telegramId,
            `💡 *Reminder:* Your virtual account is ready!\n\n` +
            `Bank: ${newAccount.bank_name}\n` +
            `Account: \`${newAccount.account_number}\`\n` +
            `Name: ${newAccount.account_name}\n\n` +
            `You can deposit anytime.`,
            { parse_mode: 'Markdown' }
          );
        } catch (err) {
          console.error('Reminder send failed:', err.message);
        }
      }, 60000);
      
    } catch (error) {
      console.error('Virtual account creation error:', error);
      
      await ctx.editMessageText(
        `❌ *Virtual Account Creation Failed*\n\n` +
        `${error.message}\n\n` +
        `💡 *What to do:*\n` +
        `1. Check your email and phone format\n` +
        `2. Try again in 5 minutes\n` +
        `3. Use manual deposit option\n` +
        `4. Contact admin if issue persists`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Try Again', 'create_virtual_account')],
            [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
            [Markup.button.callback('📞 Contact Admin', 'contact_admin')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        }
      );
    }
    
    await ctx.answerCbQuery();
    
  } catch (error) {
    console.error('Create virtual account handler error:', error);
    await ctx.answerCbQuery('❌ Error occurred');
  }
}

async function handleManualDeposit(ctx) {
  try {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    
    await ctx.editMessageText(
      `📋 *MANUAL DEPOSIT INSTRUCTIONS*\n\n` +
      `1️⃣ *Contact Admin:* @opuenekeke\n\n` +
      `2️⃣ *Send this information:*\n` +
      `• User ID: \`${telegramId}\`\n` +
      `• Deposit amount\n` +
      `• Payment proof (screenshot)\n\n` +
      `3️⃣ *Processing Time:*\n` +
      `• 1-24 hours on business days\n` +
      `• Faster response if admin is online\n\n` +
      `4️⃣ *Confirmation:*\n` +
      `• You'll receive a notification\n` +
      `• Check /balance after deposit\n\n` +
      `📞 *Need help?* Contact @opuenekeke`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📞 Contact Admin', 'contact_admin_direct')],
          [Markup.button.callback('💳 Try Virtual Account', 'create_virtual_account')],
          [Markup.button.callback('🔄 Refresh', 'refresh_deposit')],
          [Markup.button.callback('🏠 Home', 'start')]
        ])
      }
    );
    
    await ctx.answerCbQuery();
    
  } catch (error) {
    console.error('Manual deposit handler error:', error);
    await ctx.answerCbQuery('❌ Error occurred');
  }
}

async function handleCancelDeposit(ctx) {
  try {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    
    sessionManager.clearSession(telegramId);
    
    await ctx.editMessageText(
      `❌ Deposit process cancelled.\n\n` +
      `You can start again with /deposit anytime.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('💰 Try Again', 'retry_deposit')],
          [Markup.button.callback('🏠 Home', 'start')]
        ])
      }
    );
    
    await ctx.answerCbQuery();
    
  } catch (error) {
    console.error('Cancel deposit error:', error);
    await ctx.answerCbQuery('❌ Error occurred');
  }
}

async function handleChangeEmail(ctx, users) {
  try {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    
    sessionManager.startSession(telegramId, 'collect_email');
    
    await ctx.editMessageText(
      `📧 *Update Email Address*\n\n` +
      `Please enter your email address:\n\n` +
      `📝 Format: user@example.com`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🚫 Cancel', 'cancel_deposit')]
        ])
      }
    );
    
    await ctx.answerCbQuery();
    
  } catch (error) {
    console.error('Change email error:', error);
    await ctx.answerCbQuery('❌ Error occurred');
  }
}

async function handleRefreshDeposit(ctx, users, virtualAccounts) {
  try {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    
    await ctx.editMessageText(
      `🔄 Refreshing deposit options...`,
      { parse_mode: 'Markdown' }
    );
    
    const user = await users.findById(telegramId);
    const virtualAccount = await virtualAccounts.findByUserId(telegramId);
    
    if (virtualAccount) {
      const accountMessage = 
        `💰 *Your Virtual Account*\n\n` +
        `🏦 *Bank:* ${virtualAccount.bank_name}\n` +
        `🔢 *Account Number:* \`${virtualAccount.account_number}\`\n` +
        `👤 *Account Name:* ${virtualAccount.account_name}\n\n` +
        `📍 *Status:* ✅ Active\n` +
        `📅 *Last Updated:* ${new Date().toLocaleDateString()}`;

      await ctx.editMessageText(accountMessage, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
          [Markup.button.callback('🔄 Refresh Again', 'refresh_deposit')],
          [Markup.button.callback('🏠 Home', 'start')]
        ])
      });
    } else {
      await ctx.editMessageText(
        `🏦 *VIRTUAL ACCOUNT DEPOSIT*\n\n` +
        `📧 *Email:* ${user.email}\n` +
        `📱 *Phone:* ${user.phone || 'Not set'}\n` +
        `🛂 *KYC Status:* ✅ Approved\n\n` +
        `💡 *Create a virtual account for instant deposits:*`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('💳 Create Virtual Account', 'create_virtual_account')],
            [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
            [Markup.button.callback('🔄 Refresh', 'refresh_deposit')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        }
      );
    }
    
    await ctx.answerCbQuery();
    
  } catch (error) {
    console.error('Refresh deposit error:', error);
    await ctx.answerCbQuery('❌ Error occurred');
  }
}

async function handleContactAdminDirect(ctx) {
  try {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    
    await ctx.editMessageText(
      `📞 *Direct Admin Contact*\n\n` +
      `*Admin Username:* @opuenekeke\n\n` +
      `*When messaging, include:*\n` +
      `1. Your User ID: \`${telegramId}\`\n` +
      `2. Issue description\n` +
      `3. Screenshots if applicable\n\n` +
      `⏰ *Response Time:*\n` +
      `• Usually 5-10 minutes\n` +
      `• May be longer if offline\n\n` +
      `💡 *Tip:* Be clear and patient`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
          [Markup.button.callback('💳 Virtual Account', 'create_virtual_account')],
          [Markup.button.callback('🏠 Home', 'start')]
        ])
      }
    );
    
    await ctx.answerCbQuery();
    
  } catch (error) {
    console.error('Contact admin direct error:', error);
    await ctx.answerCbQuery('❌ Error occurred');
  }
}

async function handleRetryDeposit(ctx) {
  try {
    const { Markup } = require('telegraf');
    
    await ctx.editMessageText(
      `🔄 Restarting deposit process...`,
      { parse_mode: 'Markdown' }
    );
    
    // Simulate a new deposit command
    await ctx.reply(
      `💰 *Deposit Funds*\n\n` +
      `Choose your deposit method:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('💳 Virtual Account', 'create_virtual_account')],
          [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
          [Markup.button.callback('🏠 Home', 'start')]
        ])
      }
    );
    
    await ctx.answerCbQuery();
    
  } catch (error) {
    console.error('Retry deposit error:', error);
    await ctx.answerCbQuery('❌ Error occurred');
  }
}

/* =====================================================
   5️⃣ SETUP FUNCTION FOR BOT
===================================================== */
function setupDepositHandlers(bot, users, virtualAccounts) {
  // Register callback query handlers
  bot.action('create_virtual_account', (ctx) => handleCreateVirtualAccount(ctx, users, virtualAccounts, bot));
  bot.action('manual_deposit', handleManualDeposit);
  bot.action('cancel_deposit', handleCancelDeposit);
  bot.action('change_email', (ctx) => handleChangeEmail(ctx, users));
  bot.action('refresh_deposit', (ctx) => handleRefreshDeposit(ctx, users, virtualAccounts));
  bot.action('contact_admin_direct', handleContactAdminDirect);
  bot.action('retry_deposit', handleRetryDeposit);
  
  // Register text handler middleware
  bot.use(async (ctx, next) => {
    if (ctx.message && ctx.message.text) {
      const handled = await handleDepositText(ctx, ctx.message.text, users, virtualAccounts, bot);
      if (handled) return;
    }
    return next();
  });
  
  // Clean up old sessions every 30 minutes
  setInterval(() => {
    sessionManager.cleanupOldSessions();
  }, 30 * 60 * 1000);
  
  console.log('✅ Deposit handlers setup complete');
}

/* =====================================================
   6️⃣ WEBHOOK HANDLER
===================================================== */
function handleBillstackWebhook(bot, users, transactions, virtualAccounts) {
  return async (req, res) => {
    try {
      console.log('📥 Billstack webhook received:', req.body);
      
      // Validate webhook signature
      if (CONFIG.BILLSTACK_WEBHOOK_SECRET) {
        const signature = req.headers['x-billstack-signature'];
        if (!signature) {
          console.warn('⚠️ No signature in webhook');
          return res.status(400).json({ error: 'Missing signature' });
        }
        
        const hmac = crypto.createHmac('sha256', CONFIG.BILLSTACK_WEBHOOK_SECRET);
        const digest = hmac.update(JSON.stringify(req.body)).digest('hex');
        
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
          console.error('❌ Invalid webhook signature');
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
      
      const webhookData = req.body;
      
      // Process based on webhook type
      if (webhookData.event === 'transaction.success') {
        const transaction = webhookData.data;
        
        // Find user by reference
        const reference = transaction.reference;
        const userId = reference.split('-')[1]; // Extract from VTU-{userId}-timestamp-random
        
        if (userId) {
          const user = await users.findById(userId);
          if (user) {
            // Update user balance
            const amount = parseFloat(transaction.amount);
            const newBalance = (user.balance || 0) + amount;
            await users.update(userId, { balance: newBalance });
            
            // Record transaction
            await transactions.create({
              user_id: userId,
              type: 'deposit',
              amount: amount,
              status: 'completed',
              reference: reference,
              provider: 'billstack',
              description: `Deposit via virtual account`,
              metadata: transaction
            });
            
            // Notify user
            try {
              await bot.telegram.sendMessage(
                userId,
                `💰 *DEPOSIT SUCCESSFUL!*\n\n` +
                `✅ Amount: ₦${amount.toLocaleString()}\n` +
                `📊 New Balance: ₦${newBalance.toLocaleString()}\n` +
                `🔢 Reference: ${reference}\n` +
                `📅 Date: ${new Date().toLocaleString()}\n\n` +
                `💡 Thank you for your deposit!`,
                { parse_mode: 'Markdown' }
              );
            } catch (error) {
              console.error('Failed to notify user:', error.message);
            }
          }
        }
      }
      
      res.status(200).json({ 
        status: 'success', 
        message: 'Webhook processed',
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Webhook processing error:', error);
      
      res.status(200).json({ 
        status: 'error_processed', 
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  };
}

/* =====================================================
   7️⃣ EXPORTS
===================================================== */
module.exports = {
  // Main handlers
  handleDeposit,
  handleBillstackWebhook,
  setupDepositHandlers,
  
  // Session manager
  sessionManager,
  
  // Virtual account function
  createVirtualAccountForUser,
  
  // Utility functions
  generateReference,
  validateEmail,
  validatePhone,
  formatPhoneNumber
};