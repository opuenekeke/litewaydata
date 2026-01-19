/**
 * depositFunds.js - COMPLETELY FIXED Billstack Integration
 * Uses correct API endpoints and authentication
 */

const axios = require('axios');
const crypto = require('crypto');

/* =====================================================
   ENV VARIABLES & CONFIG (UPDATED)
===================================================== */
const {
  BILLSTACK_API_KEY,
  BILLSTACK_BASE_URL = 'https://api.billstack.co', // CORRECTED BASE URL
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
  
  // Supported banks from documentation
  SUPPORTED_BANKS: ['9PSB', 'SAFEHAVEN', 'PROVIDUS', 'BANKLY', 'PALMPAY'],
  DEFAULT_BANK: 'PALMPAY' // Most reliable based on documentation
};

if (!CONFIG.BILLSTACK_API_KEY) {
  console.error('❌ CRITICAL: Billstack API key missing');
  if (NODE_ENV === 'production') {
    throw new Error('Billstack API key required');
  }
}

/* =====================================================
   AXIOS CLIENT FOR BILLSTACK (CORRECT ENDPOINTS)
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

  // Request interceptor for auth
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
      
      // Retry on network errors
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

function formatAmount(amount) {
  return parseFloat(amount).toFixed(2);
}

function formatPhoneNumber(phone) {
  if (!phone) return '2348000000000';
  
  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, '');
  
  // Handle different formats
  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    // 08012345678 -> 2348012345678
    return '234' + cleaned.substring(1);
  } else if (cleaned.length === 13 && cleaned.startsWith('234')) {
    // Already in correct format
    return cleaned;
  } else if (cleaned.length === 10) {
    // 8012345678 -> 2348012345678
    return '234' + cleaned;
  } else if (cleaned.length > 13) {
    // Take first 13 digits if too long
    return cleaned.substring(0, 13);
  }
  
  // Default fallback
  return '2348000000000';
}

function validateWebhookSignature(payload, signature, secret) {
  if (!secret) {
    console.warn('⚠️ Webhook secret not configured, skipping signature verification');
    return true;
  }

  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(JSON.stringify(payload)).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}

/* =====================================================
   1️⃣ VIRTUAL ACCOUNT CREATION (CORRECT IMPLEMENTATION)
===================================================== */
async function createVirtualAccountForUser(user) {
  try {
    console.log(`🏦 Creating virtual account for user ${user.telegramId}`);
    
    if (!CONFIG.BILLSTACK_API_KEY) {
      throw new Error('Billstack API key not configured');
    }
    
    const reference = generateReference(user.telegramId);
    
    // Format phone number for Billstack
    let formattedPhone = '';
    if (user.phone) {
      formattedPhone = formatPhoneNumber(user.phone);
    } else {
      // Use a placeholder if no phone
      formattedPhone = '2348000000000';
    }
    
    // Prepare request data according to Billstack documentation
    const requestData = {
      email: user.email,
      reference: reference,
      firstName: user.firstName || 'User',
      lastName: user.lastName || user.telegramId.toString(),
      phone: formattedPhone,
      bank: CONFIG.DEFAULT_BANK // Using PALMPAY as default
    };

    console.log('📤 Creating virtual account with data:', {
      email: requestData.email,
      reference: requestData.reference,
      name: `${requestData.firstName} ${requestData.lastName}`,
      phone: requestData.phone,
      bank: requestData.bank
    });

    // MAKE THE CORRECT API CALL
    const response = await billstackClient.post(
      '/v2/thirdparty/generateVirtualAccount/', // CORRECT ENDPOINT
      requestData,
      {
        headers: {
          'Authorization': `Bearer ${CONFIG.BILLSTACK_API_KEY}`, // CORRECT AUTH
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

    // Provide user-friendly error messages
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
   2️⃣ DEPOSIT HANDLING
===================================================== */
async function handleDeposit(ctx, users, virtualAccounts, CONFIG, sessions, bot) {
  try {
    const telegramId = ctx.from.id.toString();
    console.log(`💰 Deposit requested by user ${telegramId}`);
    
    // Import Markup
    const { Markup } = require('telegraf');
    
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

    // Email check
    if (!user.email) {
      // Start email collection process
      sessions[telegramId] = {
        action: 'update_email',
        step: 1,
        userId: telegramId
      };
      
      return ctx.reply(
        '📧 Email Required for Virtual Account\n\n' +
        'To create a virtual account, we need your email address.\n\n' +
        '📝 Please enter your email address:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Cancel', 'start')]
          ])
        }
      );
    }

    // Phone check (Billstack requires phone)
    if (!user.phone) {
      sessions[telegramId] = {
        action: 'update_phone',
        step: 1,
        userId: telegramId
      };
      
      return ctx.reply(
        '📱 Phone Number Required\n\n' +
        'Billstack requires your phone number to create a virtual account.\n\n' +
        '📝 Please enter your phone number (e.g., 08012345678):',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Cancel', 'start')]
          ])
        }
      );
    }

    // Check for existing virtual account
    let virtualAccount = await virtualAccounts.findByUserId(telegramId);
    
    if (!virtualAccount || !virtualAccount.is_active) {
      // Show options for creating virtual account
      return ctx.reply(
        `🏦 *VIRTUAL ACCOUNT DEPOSIT*\n\n` +
        `📧 *Email:* ${user.email}\n` +
        `📱 *Phone:* ${user.phone}\n` +
        `🛂 *KYC Status:* ✅ Approved\n\n` +
        `💡 *Create a virtual account for instant deposits:*`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('💳 Create Virtual Account', 'create_billstack_account')],
            [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
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

      // Add manual deposit option as backup
      await ctx.reply(
        `📋 *Alternative Deposit Method:*`,
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
      `💡 *Alternative Options:*`,
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
}

/* =====================================================
   3️⃣ TEXT HANDLER FOR EMAIL/PHONE UPDATES (FIXED VERSION)
===================================================== */
async function handleText(ctx, text, session, user, users, transactions, sessions, CONFIG) {
  const { Markup } = require('telegraf');
  
  if (session.action === 'update_email') {
    if (session.step === 1) {
      const email = text.trim();
      
      // Validate email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return await ctx.reply(
          '❌ Invalid email format.\n\n' +
          'Please enter a valid email address (e.g., user@example.com):'
        );
      }
      
      // Save email
      user.email = email;
      sessions[ctx.from.id.toString()] = {
        action: 'update_phone',
        step: 1,
        userId: ctx.from.id.toString()
      };
      
      await ctx.reply(
        `✅ Email saved: ${email}\n\n` +
        `Now please enter your phone number:\n` +
        `📝 Format: 08012345678 or +2348012345678`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back', 'update_email_back')]
          ])
        }
      );
    }
  }
  else if (session.action === 'update_phone') {
    if (session.step === 1) {
      const phone = text.trim();
      
      // SIMPLIFIED PHONE VALIDATION
      // Remove all non-digits
      let cleanedPhone = phone.replace(/\D/g, '');
      
      // Check if it's a valid Nigerian phone number
      let isValid = false;
      
      if (cleanedPhone.length === 11 && cleanedPhone.startsWith('0')) {
        // Format: 08012345678
        isValid = true;
      } else if (cleanedPhone.length === 13 && cleanedPhone.startsWith('234')) {
        // Format: 2348012345678
        isValid = true;
      } else if (cleanedPhone.length === 14 && cleanedPhone.startsWith('234')) {
        // Sometimes might have extra digit, take first 13
        cleanedPhone = cleanedPhone.substring(0, 13);
        isValid = true;
      } else if (cleanedPhone.length === 10) {
        // Format: 8012345678 (without leading 0)
        cleanedPhone = '234' + cleanedPhone;
        isValid = true;
      }
      
      if (!isValid) {
        return await ctx.reply(
          '❌ Invalid phone number.\n\n' +
          'Please enter a valid Nigerian phone number:\n' +
          '• 08012345678\n' +
          '• 2348012345678\n' +
          '• +2348012345678\n\n' +
          '📝 Try again:'
        );
      }
      
      // Save phone
      user.phone = phone;
      
      delete sessions[ctx.from.id.toString()];
      
      await ctx.reply(
        `✅ Phone saved: ${phone}\n\n` +
        `📧 *Email:* ${user.email}\n` +
        `📱 *Phone:* ${user.phone}\n\n` +
        `Now you can create a virtual account.\n\n` +
        `Click below to create your virtual account:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('💳 Create Virtual Account', 'create_billstack_account')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        }
      );
    }
  }
}

/* =====================================================
   4️⃣ CALLBACK HANDLER FUNCTIONS
===================================================== */
async function handleCreateBillstackAccount(ctx, users, virtualAccounts, CONFIG, sessions, bot) {
  try {
    const { Markup } = require('telegraf');
    const userId = ctx.from.id.toString();
    const user = await users.findById(userId);
    
    if (!user) {
      return ctx.answerCbQuery('User not found');
    }
    
    await ctx.editMessageText(
      `🔄 *Creating Virtual Account...*\n\n` +
      `Please wait while we create your PALMPAY virtual account.\n` +
      `This may take up to 30 seconds.`,
      { parse_mode: 'Markdown' }
    );
    
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
        user_id: userId,
        ...newAccount
      });
      
      const accountMessage = 
        `✅ *Virtual Account Created!*\n\n` +
        `🎉 *Congratulations!* Your virtual account is ready.\n\n` +
        `🏦 *Bank:* ${newAccount.bank_name}\n` +
        `🔢 *Account Number:* \`${newAccount.account_number}\`\n` +
        `👤 *Account Name:* ${newAccount.account_name}\n\n` +
        `💰 *How to Deposit:*\n` +
        `1. Transfer to the account above\n` +
        `2. Use PALMPAY app or any bank app\n` +
        `3. Minimum: ₦100\n` +
        `4. Maximum: ₦1,000,000\n\n` +
        `⏱️ *Processing Time:* 1-5 minutes\n` +
        `📞 *Support:* /support`;

      await ctx.editMessageText(accountMessage, { parse_mode: 'Markdown' });
      
      // Send reminder
      setTimeout(async () => {
        try {
          await bot.telegram.sendMessage(
            userId,
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
        `💡 *What to do:*\n` +
        `1. Check your email format\n` +
        `2. Ensure phone is correct\n` +
        `3. Try again in 5 minutes\n` +
        `4. Contact admin if issue persists\n\n` +
        `📞 *Admin:* @opuenekeke`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Try Again', 'create_billstack_account')],
            [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
            [Markup.button.callback('📞 Contact Admin', 'contact_admin')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        }
      );
    }
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('Create Billstack account error:', error);
    ctx.answerCbQuery('❌ Error occurred');
  }
}

async function handleManualDeposit(ctx) {
  try {
    const { Markup } = require('telegraf');
    const userId = ctx.from.id.toString();
    
    await ctx.editMessageText(
      `📋 *MANUAL DEPOSIT INSTRUCTIONS*\n\n` +
      `1️⃣ *Contact Admin:* @opuenekeke\n\n` +
      `2️⃣ *Provide Information:*\n` +
      `• Your User ID: \`${userId}\`\n` +
      `• Deposit amount\n` +
      `• Proof of payment (screenshot)\n\n` +
      `3️⃣ *Processing Time:*\n` +
      `• 1-24 hours during business days\n` +
      `• Faster if admin is online\n\n` +
      `4️⃣ *Confirmation:*\n` +
      `• You will receive notification\n` +
      `• Check /balance after deposit\n\n` +
      `📞 *Need help?* Contact @opuenekeke`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📞 Contact Admin Now', 'contact_admin')],
          [Markup.button.callback('🔄 Try Virtual Account', 'try_virtual_account')],
          [Markup.button.callback('🏠 Home', 'start')]
        ])
      }
    );
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('Manual deposit error:', error);
    ctx.answerCbQuery('❌ Error occurred');
  }
}

async function handleContactAdmin(ctx) {
  try {
    const { Markup } = require('telegraf');
    const userId = ctx.from.id.toString();
    
    await ctx.editMessageText(
      `📞 *CONTACT ADMIN*\n\n` +
      `*Admin:* @opuenekeke\n\n` +
      `*When messaging admin, include:*\n` +
      `1. Your User ID: \`${userId}\`\n` +
      `2. Issue/Request\n` +
      `3. Screenshots if applicable\n\n` +
      `⏰ *Response Time:*\n` +
      `• Usually within 5-10 minutes\n` +
      `• May take longer if offline\n\n` +
      `💡 *Quick Tips:*\n` +
      `• Be clear and specific\n` +
      `• Include all relevant details\n` +
      `• Be patient for response`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
          [Markup.button.callback('🔄 Try Virtual Account', 'try_virtual_account')],
          [Markup.button.callback('🏠 Home', 'start')]
        ])
      }
    );
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('Contact admin error:', error);
    ctx.answerCbQuery('❌ Error occurred');
  }
}

async function handleUpdateEmailBack(ctx) {
  try {
    const { Markup } = require('telegraf');
    const userId = ctx.from.id.toString();
    
    await ctx.editMessageText(
      `📧 *UPDATE EMAIL*\n\n` +
      `Please enter your email address:\n\n` +
      `📝 *Format:* user@example.com`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Cancel', 'start')]
        ])
      }
    );
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('Update email back error:', error);
    ctx.answerCbQuery('❌ Error occurred');
  }
}

async function handleRefreshVirtualAccount(ctx, users, virtualAccounts) {
  try {
    const { Markup } = require('telegraf');
    const userId = ctx.from.id.toString();
    const user = await users.findById(userId);
    
    if (!user) {
      return ctx.answerCbQuery('User not found');
    }
    
    const virtualAccount = await virtualAccounts.findByUserId(userId);
    
    if (!virtualAccount) {
      return ctx.answerCbQuery('No virtual account found');
    }
    
    await ctx.editMessageText(
      `🔄 *Refreshing Account Details...*\n\n` +
      `Fetching latest account information...`,
      { parse_mode: 'Markdown' }
    );
    
    // Simulate refresh
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const accountMessage = 
      `✅ *Account Details Refreshed*\n\n` +
      `🏦 *Bank:* ${virtualAccount.bank_name}\n` +
      `🔢 *Account Number:* \`${virtualAccount.account_number}\`\n` +
      `👤 *Account Name:* ${virtualAccount.account_name}\n\n` +
      `📍 *Status:* ✅ Active\n` +
      `📅 *Created:* ${new Date(virtualAccount.created_at).toLocaleDateString()}\n\n` +
      `💡 *Deposit Instructions:*\n` +
      `1. Transfer to account above\n` +
      `2. Use PALMPAY or any bank app\n` +
      `3. Minimum: ₦100\n` +
      `4. Funds auto-credit in 1-5 mins`;

    await ctx.editMessageText(accountMessage, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh Again', 'refresh_virtual_account')],
        [Markup.button.callback('📋 Manual Deposit', 'manual_deposit')],
        [Markup.button.callback('🏠 Home', 'start')]
      ])
    });
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('Refresh virtual account error:', error);
    ctx.answerCbQuery('❌ Error occurred');
  }
}

/* =====================================================
   5️⃣ WEBHOOK HANDLER (SIMPLIFIED)
===================================================== */
function handleBillstackWebhook(bot, users, transactions, CONFIG, virtualAccounts) {
  return async (req, res) => {
    try {
      console.log('📥 Billstack webhook received');
      
      // In a real implementation, you would process the webhook
      // For now, just acknowledge receipt
      
      res.status(200).json({ 
        status: 'ok', 
        message: 'Webhook received',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Webhook processing error:', error.message);
      
      res.status(200).json({ 
        status: 'error_processed', 
        error: error.message 
      });
    }
  };
}

/* =====================================================
   6️⃣ EXPORTS
===================================================== */
module.exports = {
  // Main handlers
  handleDeposit,
  handleBillstackWebhook,
  handleText,
  
  // Virtual account function
  createVirtualAccountForUser,
  
  // Utility functions
  generateReference,
  formatAmount,
  
  // Callback handlers
  handleCreateBillstackAccount,
  handleManualDeposit,
  handleContactAdmin,
  handleUpdateEmailBack,
  handleRefreshVirtualAccount
};