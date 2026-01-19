// app/depositFunds.js - BILLSTACK.IO VIRTUAL ACCOUNTS (NO BVN REQUIRED)
const axios = require('axios');
const crypto = require('crypto');
const { Markup } = require('telegraf');

// Helper functions
function formatCurrency(amount) {
  if (!amount) return '₦0';
  return `₦${parseFloat(amount).toLocaleString('en-NG')}`;
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

function isValidEmail(email) {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Billstack.io API Functions
async function generateBillstackAccessToken() {
  try {
    console.log('🔑 Generating Billstack access token...');
    
    // Get credentials directly from environment
    const apiKey = process.env.BILLSTACK_API_KEY;
    const secretKey = process.env.BILLSTACK_SECRET_KEY;
    const baseUrl = process.env.BILLSTACK_BASE_URL || 'https://api.billstack.io';
    
    if (!apiKey || !secretKey) {
      console.error('❌ Billstack API credentials missing from environment');
      throw new Error('Billstack API credentials not configured in environment');
    }
    
    // Billstack uses Basic Auth with API key:secret
    const authString = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
    
    const response = await axios.post(
      `${baseUrl}/v1/auth/token`,
      {},
      {
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    
    if (response.data.success && response.data.data?.access_token) {
      return {
        token: response.data.data.access_token,
        baseUrl: baseUrl
      };
    }
    throw new Error('Failed to get Billstack access token');
  } catch (error) {
    console.error('❌ Billstack auth error:', error.message);
    if (error.response?.data) {
      console.error('❌ API Response:', error.response.data);
    }
    throw error;
  }
}

async function createVirtualAccountForUser(userId, user, virtualAccounts) {
  try {
    console.log(`🔄 Creating Billstack virtual account for user ${userId}`);
    
    // Get credentials and token
    const { token, baseUrl } = await generateBillstackAccessToken();
    
    // Check if user has valid email
    if (!user.email || !isValidEmail(user.email)) {
      console.error(`❌ User ${userId} has invalid email:`, user.email);
      throw new Error('Valid email required for virtual account');
    }
    
    // Check KYC status (required)
    if (user.kyc !== 'approved') {
      throw new Error('KYC approval required for virtual account');
    }
    
    // Generate unique reference
    const accountReference = `VTU_${userId}_${Date.now()}`;
    const accountName = user.fullName || `User ${userId}`;
    
    // Billstack virtual account payload
    const payload = {
      customer_name: accountName,
      customer_email: user.email,
      customer_phone: user.phone || `+234${userId.substring(0, 10)}`,
      account_reference: accountReference,
      currency: 'NGN',
      bank_name: 'WEMA BANK',
      bank_code: '035'
    };
    
    console.log('📤 Creating Billstack virtual account...');
    
    const response = await axios.post(
      `${baseUrl}/v1/virtual-accounts`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    
    console.log('📥 Billstack response received:', response.data.success ? 'SUCCESS' : 'FAILED');
    
    if (response.data.success && response.data.data) {
      const accountDetails = response.data.data;
      
      // Store virtual account details
      virtualAccounts[userId] = {
        accountReference: accountReference,
        accountNumber: accountDetails.account_number,
        accountName: accountDetails.account_name,
        bankName: accountDetails.bank_name || 'WEMA BANK',
        bankCode: accountDetails.bank_code || '035',
        customerEmail: user.email,
        customerName: accountName,
        created: new Date().toISOString(),
        active: true,
        provider: 'billstack'
      };
      
      // Update user record
      user.virtualAccount = accountReference;
      user.virtualAccountNumber = accountDetails.account_number;
      user.virtualAccountBank = accountDetails.bank_name || 'WEMA BANK';
      
      console.log(`✅ Billstack virtual account created for user ${userId}`);
      
      return virtualAccounts[userId];
    }
    
    throw new Error(response.data.message || 'Failed to create virtual account');
    
  } catch (error) {
    console.error('❌ Create Billstack virtual account error:', error.message);
    if (error.response?.data) {
      console.error('❌ API Response:', error.response.data);
    }
    throw error;
  }
}

async function getVirtualAccountDetails(userId, user, virtualAccounts) {
  try {
    // Check memory cache first
    if (virtualAccounts[userId]) {
      return virtualAccounts[userId];
    }
    
    // If user has virtual account reference, fetch from Billstack
    if (user && user.virtualAccount) {
      try {
        const { token, baseUrl } = await generateBillstackAccessToken();
        
        const response = await axios.get(
          `${baseUrl}/v1/virtual-accounts/${user.virtualAccount}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          }
        );
        
        if (response.data.success && response.data.data) {
          const accountDetails = response.data.data;
          virtualAccounts[userId] = {
            accountReference: user.virtualAccount,
            accountNumber: accountDetails.account_number,
            accountName: accountDetails.account_name,
            bankName: accountDetails.bank_name || 'WEMA BANK',
            bankCode: accountDetails.bank_code || '035',
            customerEmail: user.email,
            customerName: user.fullName,
            created: accountDetails.created_at,
            active: accountDetails.status === 'active',
            provider: 'billstack'
          };
          return virtualAccounts[userId];
        }
      } catch (error) {
        console.error('❌ Get Billstack virtual account error:', error.message);
      }
    }
    return null;
  } catch (error) {
    console.error('❌ Get Billstack virtual account error:', error.message);
    return null;
  }
}

async function handleEmailUpdate(ctx, users, userId, user, CONFIG, sessions) {
  try {
    sessions[userId] = {
      action: 'update_email',
      step: 1,
      userId: userId
    };
    
    await ctx.reply(
      `📧 *EMAIL REQUIRED*\n\n` +
      `🔒 *Why email is required\\?*\n` +
      `• Required for virtual account creation\n` +
      `• Used for transaction notifications\n` +
      `• Better security\n\n` +
      `📛 *Current Email\\:* ${user.email || 'Not set'}\n\n` +
      `📝 *Enter your valid email address\\:*\n\n` +
      `💡 *Examples\\:*\n` +
      `• john\\_doe@gmail\\.com\n` +
      `• jane\\_smith@yahoo\\.com`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Cancel', 'start')]
        ])
      }
    );
    
  } catch (error) {
    console.error('❌ Email update error:', error);
    await ctx.reply(
      '❌ Error processing email update\\. Please try again\\.',
      { parse_mode: 'MarkdownV2' }
    );
  }
}

// Main deposit handler
module.exports = {
  handleDeposit: async (ctx, users, virtualAccounts, CONFIG, sessions) => {
    try {
      const userId = ctx.from.id.toString();
      const user = users[userId] || {
        wallet: 0,
        fullName: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || `User ${userId}`,
        email: null,
        phone: null,
        kyc: 'pending',
        virtualAccount: null,
        virtualAccountNumber: null,
        virtualAccountBank: null
      };
      
      // Initialize user if not exists
      users[userId] = user;
      
      // Check if user has email from previous sessions
      if (!user.email && users[userId] && users[userId].email) {
        user.email = users[userId].email;
      }
      
      // Debug: Check environment variables
      console.log(`💳 Deposit requested by user ${userId}`);
      console.log('🔍 ENVIRONMENT CHECK:');
      console.log('- BILLSTACK_API_KEY:', process.env.BILLSTACK_API_KEY ? 'SET' : 'NOT SET');
      console.log('- BILLSTACK_SECRET_KEY:', process.env.BILLSTACK_SECRET_KEY ? 'SET' : 'NOT SET');
      console.log('- User Email:', user.email);
      console.log('- KYC Status:', user.kyc);
      console.log('- Has Virtual Account:', !!user.virtualAccount);
      
      // Check if Billstack is configured - DIRECT ENVIRONMENT CHECK
      const apiKey = process.env.BILLSTACK_API_KEY;
      const secretKey = process.env.BILLSTACK_SECRET_KEY;
      const billstackConfigured = apiKey && secretKey;
      
      if (!billstackConfigured) {
        console.log('⚠️ Billstack API credentials not found in environment');
        
        // Ask for email if not set
        if (!user.email || !isValidEmail(user.email)) {
          return await handleEmailUpdate(ctx, users, userId, user, CONFIG, sessions);
        }
        
        // Show configuration message
        return await ctx.reply(
          `🔧 *BILLSTACK SETUP REQUIRED*\n\n` +
          `📧 *Your Email\\:* ✅ ${escapeMarkdown(user.email)}\n` +
          `🛂 *KYC Status\\:* ✅ ${user.kyc.toUpperCase()}\n\n` +
          `⚠️ *Admin needs to configure Billstack API in Render*\n\n` +
          `📋 *Required Environment Variables:*\n` +
          `• BILLSTACK_API_KEY\n` +
          `• BILLSTACK_SECRET_KEY\n\n` +
          `📞 *Contact @opuenekeke to complete setup*\n` +
          `🆔 *Your User ID\\:* \`${userId}\``,
          {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📧 Update Email', 'update_email')],
              [Markup.button.callback('🏠 Home', 'start')]
            ])
          }
        );
      }
      
      // Check KYC status
      if (user.kyc !== 'approved') {
        return await ctx.reply(
          `❌ *KYC VERIFICATION REQUIRED*\n\n` +
          `📋 *Your KYC Status\\:* ${user.kyc.toUpperCase()}\n\n` +
          `🛂 *To Get Verified\\:*\n` +
          `1\\. Contact @opuenekeke\n` +
          `2\\. Provide your User ID\\: \`${userId}\`\n` +
          `3\\. Wait for admin approval\n\n` +
          `⏰ *Processing Time\\:* 1\\-2 hours`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      // Check email
      if (!user.email || !isValidEmail(user.email)) {
        return await handleEmailUpdate(ctx, users, userId, user, CONFIG, sessions);
      }
      
      // Get or create virtual account
      let accountDetails = await getVirtualAccountDetails(userId, user, virtualAccounts);
      
      if (!accountDetails) {
        // Create new virtual account
        try {
          await ctx.reply(
            '🔄 *Creating your virtual account\\.\\.\\.*\n\n' +
            'Please wait while we generate your dedicated bank account\\.\n' +
            'This may take a few seconds\\.',
            { parse_mode: 'MarkdownV2' }
          );
          
          accountDetails = await createVirtualAccountForUser(userId, user, virtualAccounts);
          
          if (!accountDetails) {
            throw new Error('Failed to create virtual account');
          }
          
        } catch (error) {
          console.error('❌ Virtual account creation failed:', error);
          
          let errorMessage = 'Failed to create virtual account. Please try again later.';
          if (error.message.includes('email')) {
            errorMessage = 'Invalid email address. Please update your email.';
          } else if (error.message.includes('KYC')) {
            errorMessage = 'KYC verification required. Contact admin.';
          } else if (error.message.includes('credentials') || error.message.includes('authentication')) {
            errorMessage = 'Billstack API authentication failed. Check API keys.';
          }
          
          return await ctx.reply(
            `❌ *VIRTUAL ACCOUNT CREATION FAILED*\n\n` +
            `📋 *Error\\:* ${escapeMarkdown(errorMessage)}\n\n` +
            `📞 *Please contact @opuenekeke for assistance*\n` +
            `Include your User ID\\: \`${userId}\``,
            {
              parse_mode: 'MarkdownV2',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('📧 Update Email', 'update_email')],
                [Markup.button.callback('🏠 Home', 'start')]
              ])
            }
          );
        }
      }
      
      // Show account details
      const instructions = `💰 *YOUR VIRTUAL ACCOUNT*\n\n` +
        `🏦 **Bank Name\\:** ${accountDetails.bankName || 'WEMA BANK'}\n` +
        `🔢 **Account Number\\:** \`${accountDetails.accountNumber}\`\n` +
        `📛 **Account Name\\:** ${accountDetails.accountName}\n` +
        `💳 **Account Type\\:** Savings\n` +
        `✅ **KYC Verified\\:** YES\n\n` +
        `📝 **How to Deposit\\:**\n` +
        `1\\. Open your bank app or visit any bank branch\n` +
        `2\\. Transfer to the account above\n` +
        `3\\. Use "VTU Deposit" as narration\n` +
        `4\\. Funds reflect automatically within 1\\-3 minutes\n\n` +
        `⚠️ **Important Notes\\:**\n` +
        `• Only transfer from Nigerian bank accounts\n` +
        `• Minimum deposit\\: ₦100\n` +
        `• Funds reflect automatically\n` +
        `• Contact support if funds don't reflect within 5 minutes`;
      
      await ctx.reply(
        instructions,
        {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📋 Copy Account Number', `copy_${accountDetails.accountNumber}`)],
            [Markup.button.callback('💰 Check Balance', 'check_balance')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        }
      );
      
    } catch (error) {
      console.error('❌ Deposit handler error:', error);
      await ctx.reply(
        '❌ An error occurred while processing deposit\\. Please try again\\.',
        { parse_mode: 'MarkdownV2' }
      );
    }
  },

  handleText: async (ctx, text, session, user, users, transactions, sessions, CONFIG) => {
    try {
      const userId = ctx.from.id.toString();
      const userData = users[userId] || {};
      
      // Handle email update only
      if (session.action === 'update_email' && session.step === 1) {
        const email = text.trim().toLowerCase();
        
        if (!isValidEmail(email)) {
          return await ctx.reply(
            '❌ *INVALID EMAIL ADDRESS*\n\n' +
            'Please enter a valid email address\\.\n\n' +
            '📝 *Examples\\:*\n' +
            '• john\\_doe@gmail\\.com\n' +
            '• jane\\_smith@yahoo\\.com\n\n' +
            'Please try again\\:',
            { parse_mode: 'MarkdownV2' }
          );
        }
        
        // Save email
        userData.email = email;
        users[userId] = userData;
        
        // Clear session
        delete sessions[userId];
        
        console.log(`✅ Email saved for user ${userId}: ${email}`);
        
        await ctx.reply(
          `✅ *EMAIL SAVED\\!*\n\n` +
          `📧 *Your Email\\:* ${escapeMarkdown(email)}\n\n` +
          `🎉 Email saved successfully\\!\n` +
          `You can now create your virtual account when Billstack is configured\\.`,
          {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('💳 Try Deposit Again', 'start')],
              [Markup.button.callback('🏠 Home', 'start')]
            ])
          }
        );
      }
      
    } catch (error) {
      console.error('❌ Text handler error:', error);
      await ctx.reply(
        '❌ An error occurred\\. Please try again\\.',
        { parse_mode: 'MarkdownV2' }
      );
    }
  },

  getCallbacks: (bot, users, virtualAccounts, CONFIG, sessions) => {
    return {
      'copy_(.+)': async (ctx) => {
        const accountNumber = ctx.match[1];
        await ctx.answerCbQuery(`Account number copied: ${accountNumber}`);
        await ctx.reply(`📋 *Account Number*\n\`${accountNumber}\``, { 
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('💰 Check Balance', 'check_balance')]
          ])
        });
      },
      'check_balance': async (ctx) => {
        const userId = ctx.from.id.toString();
        const user = users[userId] || { wallet: 0 };
        
        await ctx.reply(
          `💰 *YOUR WALLET*\n\n` +
          `💵 *Balance\\:* ${formatCurrency(user.wallet)}\n` +
          `📅 *Last Updated\\:* ${new Date().toLocaleString('en-NG')}\n\n` +
          `💡 Tap "💳 Deposit Funds" to add money`,
          { parse_mode: 'MarkdownV2' }
        );
        
        ctx.answerCbQuery('✅ Balance checked');
      },
      'update_email': async (ctx) => {
        const userId = ctx.from.id.toString();
        
        sessions[userId] = {
          action: 'update_email',
          step: 1,
          userId: userId
        };
        
        await ctx.editMessageText(
          `📧 *UPDATE EMAIL*\n\n` +
          `Please enter your email address\\:\n\n` +
          `💡 *Examples\\:*\n` +
          `• john\\_doe@gmail\\.com\n` +
          `• jane\\_smith@yahoo\\.com`,
          {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('❌ Cancel', 'start')]
            ])
          }
        );
        
        ctx.answerCbQuery();
      }
    };
  },

  handleBillstackWebhook: (bot, users, transactions, CONFIG, virtualAccounts) => {
    return async (req, res) => {
      console.log('📨 Billstack Webhook Received');
      
      try {
        const payload = req.body;
        const event = payload.event;
        
        // Handle deposit event
        if (event === 'virtual_account.deposit' || event === 'transaction.success') {
          const data = payload.data || payload;
          const amount = parseFloat(data.amount || 0);
          const accountNumber = data.account_number;
          const reference = data.reference || data.transaction_reference;
          const customerEmail = data.customer_email;
          
          if (!amount || amount <= 0) {
            return res.status(400).json({ status: 'error', message: 'Invalid amount' });
          }
          
          // Find user by account number or email
          let userId = null;
          
          // Find by account number
          for (const [uid, va] of Object.entries(virtualAccounts)) {
            if (va.accountNumber === accountNumber) {
              userId = uid;
              break;
            }
          }
          
          // Find by email
          if (!userId && customerEmail) {
            for (const [uid, user] of Object.entries(users)) {
              if (user.email === customerEmail) {
                userId = uid;
                break;
              }
            }
          }
          
          if (!userId || !users[userId]) {
            return res.status(200).json({ status: 'error', message: 'User not found' });
          }
          
          // Credit user's wallet
          const user = users[userId];
          user.wallet += amount;
          
          // Record transaction
          if (!transactions[userId]) {
            transactions[userId] = [];
          }
          
          transactions[userId].push({
            type: 'deposit',
            amount: amount,
            method: 'billstack_virtual_account',
            reference: reference,
            status: 'completed',
            date: new Date().toLocaleString(),
            customerEmail: customerEmail,
            description: 'Billstack virtual account deposit'
          });
          
          console.log(`✅ User ${userId} credited ${amount}`);
          
          // Notify user
          try {
            await bot.telegram.sendMessage(
              userId,
              `💰 *DEPOSIT RECEIVED\\!*\n\n` +
              `✅ Your deposit has been processed\\!\n\n` +
              `💵 *Amount\\:* ${formatCurrency(amount)}\n` +
              `💳 *New Balance\\:* ${formatCurrency(user.wallet)}\n` +
              `🔢 *Reference\\:* ${reference || 'N/A'}\n` +
              `📅 *Date\\:* ${new Date().toLocaleString('en-NG')}`,
              { parse_mode: 'MarkdownV2' }
            );
          } catch (telegramError) {
            console.error('Failed to notify user:', telegramError.message);
          }
          
          return res.status(200).json({ 
            status: 'success', 
            message: 'Deposit processed successfully'
          );
        }
        
        return res.status(200).json({ status: 'received' });
        
      } catch (error) {
        console.error('❌ Billstack webhook error:', error);
        return res.status(200).json({ status: 'error', message: error.message });
      }
    };
  },

  handleMonnifyWebhook: function(bot, users, transactions, CONFIG, virtualAccounts) {
    return this.handleBillstackWebhook(bot, users, transactions, CONFIG, virtualAccounts);
  }
};