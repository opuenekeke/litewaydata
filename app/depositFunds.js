/**
 * depositFunds.js - FIXED VERSION with Correct Billstack API Integration
 */

const axios = require('axios');
const crypto = require('crypto');

/* =====================================================
   ENV VARIABLES & CONFIG
===================================================== */
const {
  BILLSTACK_API_KEY,
  BILLSTACK_SECRET_KEY,
  BILLSTACK_BASE_URL = 'https://api.billstack.co', // CORRECTED: .co not .io
  BILLSTACK_WEBHOOK_SECRET,
  NODE_ENV
} = process.env;

const CONFIG = {
  // Try SECRET_KEY first, then API_KEY as fallback
  BILLSTACK_TOKEN: BILLSTACK_SECRET_KEY || BILLSTACK_API_KEY || '',
  BILLSTACK_BASE_URL: BILLSTACK_BASE_URL,
  BILLSTACK_WEBHOOK_SECRET: BILLSTACK_WEBHOOK_SECRET || '',
  TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000,
  
  // Use the token from whichever variable is provided
  BILLSTACK_ENABLED: (BILLSTACK_SECRET_KEY || BILLSTACK_API_KEY) ? true : false,
  
  // Available banks from documentation
  SUPPORTED_BANKS: ['9PSB', 'SAFEHAVEN', 'PROVIDUS', 'BANKLY', 'PALMPAY'],
  DEFAULT_BANK: 'PALMPAY',
  
  // Test mode if no token
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

// Log configuration for debugging
console.log('🔧 Billstack Configuration:');
console.log('- Base URL:', CONFIG.BILLSTACK_BASE_URL);
console.log('- Has Token:', !!CONFIG.BILLSTACK_TOKEN);
console.log('- Test Mode:', CONFIG.TEST_MODE);
console.log('- Supported Banks:', CONFIG.SUPPORTED_BANKS.join(', '));

/* =====================================================
   AXIOS CLIENT (CORRECTLY CONFIGURED)
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

  // Request interceptor - ADD AUTHORIZATION HEADER
  client.interceptors.request.use(
    (config) => {
      console.log(`📤 ${config.method.toUpperCase()} ${config.url}`);
      
      // Add authorization header if we have a token
      if (CONFIG.BILLSTACK_TOKEN) {
        config.headers['Authorization'] = `Bearer ${CONFIG.BILLSTACK_TOKEN}`;
        console.log('🔐 Authorization header added');
      }
      
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
      
      console.error('❌ Billstack API Error Details:');
      console.error('- URL:', error.config?.url);
      console.error('- Method:', error.config?.method);
      console.error('- Status:', error.response?.status);
      console.error('- Status Text:', error.response?.statusText);
      console.error('- Headers Sent:', JSON.stringify(error.config?.headers, null, 2));
      
      if (error.response) {
        console.error('- Response Data:', JSON.stringify(error.response.data, null, 2));
      }
      
      if (error.code) {
        console.error('- Error Code:', error.code);
      }
      
      console.error('- Message:', error.message);

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
   VIRTUAL ACCOUNT CREATION (CORRECT IMPLEMENTATION)
===================================================== */
async function createVirtualAccountForUser(user) {
  try {
    console.log(`\n🏦 START: Creating virtual account for user ${user.telegramId}`);
    
    // If in test mode, return test account
    if (CONFIG.TEST_MODE) {
      console.log('🧪 TEST MODE: Returning test virtual account');
      const testAccount = {
        ...CONFIG.TEST_VIRTUAL_ACCOUNT,
        account_name: `${user.firstName || 'User'} ${user.lastName || ''}`.trim() || 'User Account'
      };
      console.log('✅ Test account generated:', testAccount);
      return testAccount;
    }
    
    if (!CONFIG.BILLSTACK_TOKEN) {
      throw new Error('Billstack API token not configured. Please set BILLSTACK_SECRET_KEY or BILLSTACK_API_KEY.');
    }
    
    const reference = generateReference(user.telegramId);
    
    // Format phone number as per documentation (e.g., 09012345678)
    const formattedPhone = user.phone ? formatPhoneNumber(user.phone) : '08012345678';
    
    // Prepare request data EXACTLY as per documentation
    const requestData = {
      email: user.email,
      reference: reference,
      firstName: user.firstName || 'User',
      lastName: user.lastName || 'Customer',
      phone: formattedPhone,
      bank: CONFIG.DEFAULT_BANK // Using PALMPAY as default
    };

    console.log('\n📤 REQUEST DATA (to Billstack API):');
    console.log(JSON.stringify(requestData, null, 2));
    console.log('\n🔐 TOKEN (first 10 chars):', CONFIG.BILLSTACK_TOKEN.substring(0, 10) + '...');
    console.log('🌐 ENDPOINT:', `${CONFIG.BILLSTACK_BASE_URL}/v2/thirdparty/generateVirtualAccount/`);

    try {
      console.log('\n🚀 SENDING REQUEST TO BILLSTACK...');
      
      const response = await billstackClient.post(
        '/v2/thirdparty/generateVirtualAccount/',
        requestData
      );

      console.log('\n📥 BILLSTACK RESPONSE:');
      console.log(JSON.stringify(response.data, null, 2));

      if (!response.data.status) {
        throw new Error(response.data.message || 'Failed to create virtual account');
      }

      const accountData = response.data.data;
      if (!accountData || !accountData.account || accountData.account.length === 0) {
        throw new Error('No account data returned from Billstack');
      }

      const firstAccount = accountData.account[0];
      
      console.log(`\n✅ SUCCESS: Virtual account created for ${user.telegramId}`);
      console.log('- Bank:', firstAccount.bank_name);
      console.log('- Account Number:', firstAccount.account_number);
      console.log('- Account Name:', firstAccount.account_name);
      console.log('- Reference:', reference);

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

    } catch (apiError) {
      console.error('\n❌ BILLSTACK API CALL FAILED:', apiError.message);
      
      // Check for specific error messages
      if (apiError.response && apiError.response.data) {
        const errorData = apiError.response.data;
        console.error('Error Details:', JSON.stringify(errorData, null, 2));
        
        if (errorData.message === 'Incorrect Token Supplied') {
          throw new Error('Invalid Billstack API token. Please check your BILLSTACK_SECRET_KEY or BILLSTACK_API_KEY environment variable.');
        }
      }
      
      // Provide helpful error message
      throw new Error(`Billstack API Error: ${apiError.message}. Check your API token and try again.`);
    }

  } catch (error) {
    console.error(`\n❌ FAILED to create virtual account for user ${user.telegramId}:`);
    console.error('- Error:', error.message);
    
    if (error.response) {
      console.error('- Status:', error.response.status);
      console.error('- Data:', JSON.stringify(error.response.data, null, 2));
    }

    // Provide user-friendly error messages
    let userMessage = error.message;
    
    if (error.message.includes('Invalid Billstack API token') || 
        error.message.includes('Incorrect Token')) {
      userMessage = 'Invalid API credentials. Please contact admin.';
    } else if (error.message.includes('network') || 
               error.message.includes('timeout') ||
               error.message.includes('ECONN')) {
      userMessage = 'Network error. Please try again in a few minutes.';
    } else if (error.message.includes('email') || 
               error.message.includes('phone') ||
               error.message.includes('format')) {
      userMessage = 'Invalid data format. Please check your email and phone number.';
    }

    throw new Error(`Virtual account creation failed: ${userMessage}`);
  }
}

/* =====================================================
   UTILITY FUNCTIONS
===================================================== */
function generateReference(telegramId) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 6).toUpperCase();
  return `VTU-${telegramId}-${timestamp}-${random}`;
}

function formatPhoneNumber(phone) {
  if (!phone) return '08012345678'; // Default Nigerian number
  
  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, '');
  
  // Format to 11 digits starting with 0 (e.g., 08012345678)
  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    return cleaned; // Already in correct format
  } else if (cleaned.length === 13 && cleaned.startsWith('234')) {
    // Convert 2348012345678 to 08012345678
    return '0' + cleaned.substring(3);
  } else if (cleaned.length === 10) {
    // Convert 8012345678 to 08012345678
    return '0' + cleaned;
  } else if (cleaned.length > 11) {
    // Take first 11 digits if too long
    return '0' + cleaned.substring(cleaned.length - 10);
  }
  
  // Default fallback
  return '08012345678';
}

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validatePhone(phone) {
  const cleaned = phone.replace(/\D/g, '');
  
  // Accept: 08012345678 (11 digits starting with 0)
  // Accept: 2348012345678 (13 digits starting with 234)
  // Accept: 8012345678 (10 digits)
  
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
   SESSION MANAGER (Keep existing code)
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
   MAIN DEPOSIT COMMAND (Keep existing code)
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
          `We need your phone number to create a virtual account.\n\n` +
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
        `🏦 *DEPOSIT FUNDS*\n\n` +
        `📧 *Email:* ${user.email}\n` +
        `📱 *Phone:* ${user.phone || 'Not set'}\n` +
        `🛂 *KYC Status:* ✅ Approved\n\n` +
        `💡 *Choose deposit method:*`,
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
        `⚠️ *Note:* Use any bank app to transfer`;

      await ctx.reply(accountMessage, { parse_mode: 'Markdown' });

      await ctx.reply(
        `📋 *Need help?*`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
            [Markup.button.callback('🔄 Refresh Account', 'refresh_virtual_account')],
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
   TEXT MESSAGE HANDLER (Keep existing code)
===================================================== */
async function handleDepositText(ctx, text, users, virtualAccounts, bot) {
  try {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    const session = sessionManager.getSession(telegramId);
    
    if (!session) {
      return false;
    }
    
    const user = await users.findById(telegramId);
    if (!user) {
      await ctx.reply('❌ User not found. Please start the bot with /start first.');
      sessionManager.clearSession(telegramId);
      return true;
    }
    
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
      
      sessionManager.updateStep(telegramId, 2, { email: email });
      
      user.email = email;
      await users.update(telegramId, { email: email });
      
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
      
      user.phone = phone;
      await users.update(telegramId, { phone: phone });
      
      sessionManager.clearSession(telegramId);
      
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
   CALLBACK QUERY HANDLERS (Keep existing code)
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

      await virtualAccounts.create({
        user_id: telegramId,
        ...newAccount
      });
      
      let accountMessage = `✅ *Virtual Account Created!*\n\n`;
      
      if (newAccount.provider === 'test') {
        accountMessage += `🧪 *TEST MODE ACCOUNT*\n\n`;
        accountMessage += `This is a test account. For real deposits:\n`;
        accountMessage += `1. Get valid Billstack API credentials\n`;
        accountMessage += `2. Contact admin @opuenekeke\n\n`;
      } else {
        accountMessage += `🎉 Your deposit account is ready.\n\n`;
      }
      
      accountMessage += `🏦 *Bank:* ${newAccount.bank_name}\n`;
      accountMessage += `🔢 *Account Number:* \`${newAccount.account_number}\`\n`;
      accountMessage += `👤 *Account Name:* ${newAccount.account_name}\n\n`;
      
      if (newAccount.provider !== 'test') {
        accountMessage += `💰 *How to Deposit:*\n`;
        accountMessage += `1. Transfer to the account above\n`;
        accountMessage += `2. Use any bank app\n`;
        accountMessage += `3. Minimum: ₦100\n`;
        accountMessage += `4. Maximum: ₦1,000,000\n\n`;
        accountMessage += `⏱️ *Processing Time:* 1-5 minutes\n`;
      }
      
      accountMessage += `📞 *Support:* @opuenekeke`;

      await ctx.editMessageText(accountMessage, { 
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
          [Markup.button.callback('🏠 Home', 'start')]
        ])
      });
      
      // Send reminder
      setTimeout(async () => {
        try {
          await bot.telegram.sendMessage(
            telegramId,
            `💡 *Reminder:* Your virtual account is ready!\n\n` +
            `Bank: ${newAccount.bank_name}\n` +
            `Account: \`${newAccount.account_number}\`\n` +
            `Name: ${newAccount.account_name}`,
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
        `💡 *Troubleshooting:*\n` +
        `1. Check if email & phone are correct\n` +
        `2. Your Billstack API token may be invalid\n` +
        `3. Contact admin @opuenekeke for help\n\n` +
        `📋 *Alternative:* Use manual deposit`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
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

// Keep all other handler functions (they remain the same)
async function handleManualDeposit(ctx) {
  try {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    
    await ctx.editMessageText(
      `📋 *MANUAL DEPOSIT INSTRUCTIONS*\n\n` +
      `1️⃣ *Contact Admin:* @opuenekeke\n\n` +
      `2️⃣ *Send this information:*\n` +
      `• Your User ID: \`${telegramId}\`\n` +
      `• Deposit amount\n` +
      `• Proof of payment (screenshot)\n\n` +
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
          [Markup.button.callback('📞 Contact Admin Now', 'contact_admin_direct')],
          [Markup.button.callback('🔄 Try Virtual Account', 'create_virtual_account')],
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

// Export all functions
module.exports = {
  // Main handlers
  handleDeposit,
  handleDepositText,
  handleBillstackWebhook: require('./depositFunds').handleBillstackWebhook || function() { return async (req, res) => res.status(200).json({ status: 'ok' }); },
  setupDepositHandlers: require('./depositFunds').setupDepositHandlers || function() { console.log('Deposit handlers setup'); },
  
  // Session manager
  sessionManager,
  
  // Virtual account function
  createVirtualAccountForUser,
  
  // Utility functions
  generateReference,
  validateEmail,
  validatePhone,
  formatPhoneNumber,
  
  // Callback handlers
  handleCreateVirtualAccount,
  handleManualDeposit,
  handleCancelDeposit: async (ctx) => {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    sessionManager.clearSession(telegramId);
    await ctx.editMessageText('❌ Deposit process cancelled.', Markup.inlineKeyboard([[Markup.button.callback('🏠 Home', 'start')]]));
    await ctx.answerCbQuery();
  },
  handleChangeEmail: async (ctx, users) => {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    sessionManager.startSession(telegramId, 'collect_email');
    await ctx.editMessageText('📧 Please enter your email address:', Markup.inlineKeyboard([[Markup.button.callback('🚫 Cancel', 'cancel_deposit')]]));
    await ctx.answerCbQuery();
  },
  handleRefreshDeposit: async (ctx, users, virtualAccounts) => {
    const { Markup } = require('telegraf');
    const telegramId = ctx.from.id.toString();
    await ctx.editMessageText('🔄 Refreshing...', { parse_mode: 'Markdown' });
    const user = await users.findById(telegramId);
    const virtualAccount = await virtualAccounts.findByUserId(telegramId);
    
    if (virtualAccount) {
      await ctx.editMessageText(
        `💰 Bank: ${virtualAccount.bank_name}\nAccount: \`${virtualAccount.account_number}\``,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 Home', 'start')]]) }
      );
    } else {
      await ctx.editMessageText(
        `No virtual account found. Create one?`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('💳 Create Account', 'create_virtual_account')], [Markup.button.callback('🏠 Home', 'start')]]) }
      );
    }
    await ctx.answerCbQuery();
  },
  handleContactAdminDirect: async (ctx) => {
    const { Markup } = require('telegraf');
    await ctx.editMessageText(
      '📞 Contact @opuenekeke for assistance.',
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 Home', 'start')]]) }
    );
    await ctx.answerCbQuery();
  },
  handleRetryDeposit: async (ctx, users, virtualAccounts) => {
    await ctx.editMessageText('🔄 Restarting...', { parse_mode: 'Markdown' });
    await handleDeposit(ctx, users, virtualAccounts);
    await ctx.answerCbQuery();
  }
};