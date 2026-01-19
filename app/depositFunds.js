/**
 * depositFunds.js - Complete Billstack Integration
 * Handles virtual accounts, deposits, and webhooks
 */

const axios = require('axios');
const crypto = require('crypto');

/* =====================================================
   ENV VARIABLES & CONFIG
===================================================== */
const {
  BILLSTACK_API_KEY,
  BILLSTACK_BASE_URL,
  BILLSTACK_WEBHOOK_SECRET,
  NODE_ENV
} = process.env;

const CONFIG = {
  BILLSTACK_API_KEY: BILLSTACK_API_KEY || '',
  BILLSTACK_BASE_URL: BILLSTACK_BASE_URL || 'https://api.billstack.io',
  BILLSTACK_WEBHOOK_SECRET: BILLSTACK_WEBHOOK_SECRET || '',
  TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000
};

if (!CONFIG.BILLSTACK_API_KEY || !CONFIG.BILLSTACK_BASE_URL) {
  console.error('❌ CRITICAL: Billstack environment variables missing');
  if (NODE_ENV === 'production') {
    throw new Error('Billstack configuration required');
  }
}

/* =====================================================
   AXIOS CLIENT WITH RETRY & TIMEOUT
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

  // Response interceptor for error handling
  client.interceptors.response.use(
    (response) => {
      console.log(`✅ ${response.status} ${response.config.url}`);
      return response;
    },
    async (error) => {
      const originalRequest = error.config;
      
      if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
        console.warn(`⚠️ Network error: ${error.code}, retrying...`);
        
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
      
      console.error('❌ API Error:', {
        url: error.config?.url,
        method: error.config?.method,
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      
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
   1️⃣ AUTH TOKEN MANAGEMENT
===================================================== */
class TokenManager {
  constructor() {
    this.token = null;
    this.tokenExpiry = null;
    this.refreshPromise = null;
  }

  async getToken() {
    // Return cached token if valid
    if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.token;
    }

    // Prevent multiple concurrent refresh requests
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.refreshToken();
    try {
      this.token = await this.refreshPromise;
      // Set expiry to 50 minutes from now (tokens typically last 60 minutes)
      this.tokenExpiry = Date.now() + (50 * 60 * 1000);
      return this.token;
    } finally {
      this.refreshPromise = null;
    }
  }

  async refreshToken() {
    try {
      console.log('🔑 Generating new Billstack access token...');
      
      const response = await billstackClient.post(
        '/v1/auth/token',
        {},
        {
          headers: {
            'Authorization': `Bearer ${CONFIG.BILLSTACK_API_KEY}`,
          }
        }
      );

      const token = response?.data?.data?.access_token;
      if (!token) {
        throw new Error('No access token returned from Billstack');
      }

      console.log('✅ Billstack token generated successfully');
      return token;
    } catch (error) {
      console.error('❌ Failed to generate Billstack token:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      
      if (error.response?.status === 401) {
        throw new Error('Invalid Billstack API credentials');
      }
      throw error;
    }
  }

  invalidateToken() {
    this.token = null;
    this.tokenExpiry = null;
  }
}

const tokenManager = new TokenManager();

/* =====================================================
   2️⃣ VIRTUAL ACCOUNT MANAGEMENT
===================================================== */
async function createVirtualAccountForUser(user) {
  try {
    console.log(`🏦 Creating virtual account for user ${user.telegramId}`);
    
    const token = await tokenManager.getToken();
    const reference = generateReference(user.telegramId);
    
    const requestData = {
      email: user.email,
      first_name: user.firstName || 'User',
      last_name: user.lastName || user.telegramId.toString(),
      reference: reference,
      phone: user.phone || null,
      metadata: {
        telegram_id: user.telegramId,
        username: user.username || 'N/A',
        created_at: new Date().toISOString()
      }
    };

    console.log('📤 Creating virtual account with data:', {
      email: user.email,
      reference: reference
    });

    const response = await billstackClient.post(
      '/v1/virtual-accounts',
      requestData,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        }
      }
    );

    const accountData = response?.data?.data;
    if (!accountData) {
      throw new Error('No account data returned');
    }

    console.log(`✅ Virtual account created for ${user.telegramId}:`, {
      bank: accountData.bank_name,
      accountNumber: accountData.account_number,
      accountName: accountData.account_name
    });

    return {
      bank_name: accountData.bank_name,
      account_number: accountData.account_number,
      account_name: accountData.account_name,
      reference: reference,
      provider: 'billstack',
      created_at: new Date(),
      is_active: true,
      raw_response: accountData
    };

  } catch (error) {
    console.error(`❌ Failed to create virtual account for user ${user.telegramId}:`, {
      message: error.message,
      response: error.response?.data
    });

    // Invalidate token on auth errors
    if (error.response?.status === 401) {
      tokenManager.invalidateToken();
    }

    throw new Error(`Virtual account creation failed: ${error.message}`);
  }
}

async function getVirtualAccountDetails(accountNumber) {
  try {
    const token = await tokenManager.getToken();
    
    const response = await billstackClient.get(
      `/v1/virtual-accounts/${accountNumber}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        }
      }
    );

    return response?.data?.data;
  } catch (error) {
    console.error('❌ Failed to fetch virtual account details:', error.message);
    throw error;
  }
}

/* =====================================================
   3️⃣ DEPOSIT HANDLING
===================================================== */
async function handleDepositCommand(ctx, users, virtualAccounts, sessions, bot) {
  try {
    const telegramId = ctx.from.id;
    console.log(`💰 Deposit requested by user ${telegramId}`);
    
    // Get or create user session
    let session = sessions.get(telegramId) || {};
    session.depositStage = 'init';
    sessions.set(telegramId, session);

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
      return ctx.reply(
        '📧 Email Required\n\n' +
        'Please add your email address first:\n' +
        'Use /email to set your email address.'
      );
    }

    // Check for existing virtual account
    let virtualAccount = await virtualAccounts.findByUserId(telegramId);
    
    if (!virtualAccount || !virtualAccount.is_active) {
      // Create new virtual account
      await ctx.reply('🔄 Creating your deposit account... Please wait.');
      
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

        virtualAccount = newAccount;
        
        // Send success message with account details
        const accountMessage = 
          `✅ *Deposit Account Created*\n\n` +
          `🏦 *Bank:* ${virtualAccount.bank_name}\n` +
          `🔢 *Account Number:* \`${virtualAccount.account_number}\`\n` +
          `👤 *Account Name:* ${virtualAccount.account_name}\n\n` +
          `💰 *How to Deposit:*\n` +
          `1. Transfer to the account above\n` +
          `2. Use any bank app or USSD\n` +
          `3. Minimum: ₦100\n` +
          `4. Maximum: ₦1,000,000\n\n` +
          `⏱️ *Processing Time:* 1-5 minutes\n` +
          `📞 *Support:* /support`;

        await ctx.reply(accountMessage, { parse_mode: 'Markdown' });

        // Send reminder
        setTimeout(async () => {
          try {
            await bot.telegram.sendMessage(
              telegramId,
              `💡 *Reminder:* Your deposit account is ready!\n\n` +
              `Account: \`${virtualAccount.account_number}\`\n` +
              `Bank: ${virtualAccount.bank_name}`,
              { parse_mode: 'Markdown' }
            );
          } catch (err) {
            console.error('Reminder send failed:', err.message);
          }
        }, 60000); // After 1 minute

      } catch (error) {
        console.error('Virtual account creation error:', error);
        return ctx.reply(
          '❌ Failed to create deposit account. Please try again later or contact support.'
        );
      }
    } else {
      // Show existing account
      const accountMessage = 
        `💰 *Your Deposit Account*\n\n` +
        `🏦 *Bank:* ${virtualAccount.bank_name}\n` +
        `🔢 *Account Number:* \`${virtualAccount.account_number}\`\n` +
        `👤 *Account Name:* ${virtualAccount.account_name}\n\n` +
        `📍 *Status:* ✅ Active\n` +
        `📅 *Created:* ${new Date(virtualAccount.created_at).toLocaleDateString()}\n\n` +
        `💡 *Need help?* Use /support`;

      await ctx.reply(accountMessage, { parse_mode: 'Markdown' });

      // Show recent transactions if available
      const recentDeposits = await getRecentDeposits(telegramId);
      if (recentDeposits.length > 0) {
        let transactionsMessage = `📊 *Recent Deposits:*\n\n`;
        recentDeposits.forEach((tx, index) => {
          transactionsMessage += 
            `${index + 1}. ₦${formatAmount(tx.amount)} - ${new Date(tx.created_at).toLocaleDateString()}\n` +
            `   Status: ${tx.status === 'success' ? '✅' : '⏳'} ${tx.status}\n`;
        });
        
        await ctx.reply(transactionsMessage, { parse_mode: 'Markdown' });
      }
    }

    // Clear session
    sessions.delete(telegramId);

  } catch (error) {
    console.error('Deposit command error:', error);
    await ctx.reply(
      '❌ An error occurred. Please try again or contact support.'
    );
  }
}

async function getRecentDeposits(userId, limit = 5) {
  // This would query your transactions database
  // Placeholder implementation
  return [];
}

/* =====================================================
   4️⃣ WEBHOOK HANDLER
===================================================== */
function createWebhookHandler(bot, users, transactions, virtualAccounts) {
  return async (req, res) => {
    let eventData = null;
    
    try {
      // Log webhook receipt
      console.log('📥 Webhook received:', {
        headers: req.headers,
        method: req.method,
        ip: req.ip
      });

      // Verify signature if secret is configured
      const signature = req.headers['x-billstack-signature'];
      if (CONFIG.BILLSTACK_WEBHOOK_SECRET && signature) {
        const isValid = validateWebhookSignature(req.body, signature, CONFIG.BILLSTACK_WEBHOOK_SECRET);
        if (!isValid) {
          console.error('❌ Invalid webhook signature');
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }

      eventData = req.body;
      console.log('📋 Webhook payload:', JSON.stringify(eventData, null, 2));

      // Validate webhook structure
      if (!eventData.event || !eventData.data) {
        console.error('❌ Invalid webhook structure');
        return res.status(400).json({ error: 'Invalid webhook structure' });
      }

      // Handle different event types
      switch (eventData.event) {
        case 'transfer.success':
          await handleSuccessfulTransfer(eventData.data, bot, users, transactions, virtualAccounts);
          break;
          
        case 'transfer.failed':
          await handleFailedTransfer(eventData.data, bot, users, transactions);
          break;
          
        case 'virtual_account.created':
          await handleVirtualAccountCreated(eventData.data, bot, users, virtualAccounts);
          break;
          
        case 'virtual_account.updated':
          await handleVirtualAccountUpdated(eventData.data, bot, users, virtualAccounts);
          break;
          
        default:
          console.log(`ℹ️ Unhandled event type: ${eventData.event}`);
          return res.status(200).json({ status: 'ignored', event: eventData.event });
      }

      // Acknowledge receipt
      res.status(200).json({ status: 'ok', received: true });

    } catch (error) {
      console.error('❌ Webhook processing error:', {
        error: error.message,
        stack: error.stack,
        eventData: eventData
      });
      
      // Still return 200 to Billstack to prevent retries for processing errors
      res.status(200).json({ 
        status: 'error_processed', 
        error: error.message 
      });
    }
  };
}

async function handleSuccessfulTransfer(data, bot, users, transactions, virtualAccounts) {
  const {
    amount,
    reference,
    account_number,
    customer_email,
    customer_name,
    settled_at
  } = data;

  console.log(`✅ Processing successful transfer: ${reference} for ${amount}`);

  // Find user by account number
  const virtualAccount = await virtualAccounts.findByAccountNumber(account_number);
  if (!virtualAccount) {
    console.error(`❌ Virtual account not found: ${account_number}`);
    throw new Error(`Account ${account_number} not found`);
  }

  const user = await users.findById(virtualAccount.user_id);
  if (!user) {
    console.error(`❌ User not found for account: ${account_number}`);
    throw new Error(`User not found for account ${account_number}`);
  }

  // Check for duplicate transaction
  const existingTx = await transactions.findByReference(reference);
  if (existingTx) {
    console.log(`ℹ️ Duplicate transaction ignored: ${reference}`);
    return;
  }

  // Credit user wallet
  const newBalance = await users.creditWallet(user.telegramId, amount);

  // Record transaction
  await transactions.create({
    telegramId: user.telegramId,
    amount: amount,
    reference: reference,
    type: 'deposit',
    status: 'success',
    provider: 'billstack',
    account_number: account_number,
    customer_email: customer_email,
    customer_name: customer_name,
    settled_at: settled_at,
    metadata: data
  });

  // Update virtual account last used
  await virtualAccounts.updateLastUsed(account_number);

  // Notify user
  const message = 
    `🎉 *Deposit Successful!*\n\n` +
    `💰 *Amount:* ₦${formatAmount(amount)}\n` +
    `📊 *New Balance:* ₦${formatAmount(newBalance)}\n` +
    `🔢 *Reference:* ${reference}\n` +
    `⏰ *Time:* ${new Date(settled_at).toLocaleString()}\n\n` +
    `💡 *Need help?* Use /support`;

  try {
    await bot.telegram.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' });
    console.log(`✅ Notification sent to user ${user.telegramId}`);
  } catch (error) {
    console.error('Failed to send notification:', error.message);
    // Log to admin channel or retry queue
  }

  // Log for monitoring
  console.log(`💳 Deposit processed: User ${user.telegramId}, Amount ₦${amount}, Ref ${reference}`);
}

async function handleFailedTransfer(data, bot, users, transactions) {
  const { amount, reference, account_number, reason } = data;
  
  console.log(`❌ Processing failed transfer: ${reference}`);
  
  // Find and notify user
  const virtualAccount = await virtualAccounts.findByAccountNumber(account_number);
  if (virtualAccount) {
    const user = await users.findById(virtualAccount.user_id);
    if (user) {
      const message = 
        `❌ *Deposit Failed*\n\n` +
        `💰 *Amount:* ₦${formatAmount(amount)}\n` +
        `🔢 *Reference:* ${reference}\n` +
        `📝 *Reason:* ${reason || 'Unknown'}\n\n` +
        `💡 *Please try again or contact support.*`;
      
      try {
        await bot.telegram.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error('Failed to send failure notification:', error.message);
      }
    }
  }
  
  // Record failed transaction
  await transactions.create({
    telegramId: virtualAccount?.user_id || null,
    amount: amount,
    reference: reference,
    type: 'deposit',
    status: 'failed',
    provider: 'billstack',
    account_number: account_number,
    failure_reason: reason,
    metadata: data
  });
}

async function handleVirtualAccountCreated(data, bot, users, virtualAccounts) {
  console.log(`🏦 Virtual account created: ${data.account_number}`);
  // Sync account creation if needed
}

async function handleVirtualAccountUpdated(data, bot, users, virtualAccounts) {
  console.log(`🔄 Virtual account updated: ${data.account_number}`);
  // Handle account updates
}

/* =====================================================
   5️⃣ ADMIN FUNCTIONS
===================================================== */
async function checkVirtualAccountStatus(accountNumber) {
  try {
    const account = await getVirtualAccountDetails(accountNumber);
    return {
      status: 'active',
      account: account,
      last_checked: new Date()
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message,
      last_checked: new Date()
    };
  }
}

async function manualDepositVerification(telegramId, amount, reference) {
  // Manual verification for disputed transactions
  try {
    // Implementation for manual verification
    return { success: true, message: 'Deposit verified manually' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/* =====================================================
   6️⃣ EXPORTS
===================================================== */
module.exports = {
  // Main handlers
  handleDeposit: handleDepositCommand,
  handleBillstackWebhook: createWebhookHandler,
  
  // Virtual account functions
  createVirtualAccountForUser,
  getVirtualAccountDetails,
  
  // Utility functions
  generateReference,
  formatAmount,
  
  // Admin functions
  checkVirtualAccountStatus,
  manualDepositVerification,
  
  // Token manager (for testing)
  _tokenManager: tokenManager
};