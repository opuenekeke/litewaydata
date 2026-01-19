// app/depositFunds.js - CONVERTED TO BILLSTACK.IO (NO BVN REQUIRED)
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
async function generateBillstackAccessToken(CONFIG) {
  try {
    // Check if Billstack is enabled and has credentials
    if (!CONFIG.BILLSTACK_EMAIL || !CONFIG.BILLSTACK_PASSWORD) {
      throw new Error('Billstack credentials not configured');
    }
    
    const response = await axios.post(
      `${CONFIG.BILLSTACK_BASE_URL || 'https://api.billstack.io'}/v1/auth/login`,
      {
        email: CONFIG.BILLSTACK_EMAIL,
        password: CONFIG.BILLSTACK_PASSWORD
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    
    if (response.data.success && response.data.data?.token) {
      return response.data.data.token;
    }
    throw new Error('Failed to get Billstack access token');
  } catch (error) {
    console.error('❌ Billstack auth error:', error.message);
    throw error;
  }
}

async function createVirtualAccountForUser(userId, user, virtualAccounts, CONFIG) {
  try {
    console.log(`🔄 Creating Billstack virtual account for user ${userId}`);
    
    // Check if Billstack is properly configured
    if (!CONFIG.BILLSTACK_EMAIL || !CONFIG.BILLSTACK_PASSWORD) {
      throw new Error('Billstack not configured. Please contact admin.');
    }
    
    // Check if user has valid email
    if (!user.email || !isValidEmail(user.email)) {
      console.error(`❌ User ${userId} has invalid email:`, user.email);
      throw new Error('Valid email required for virtual account');
    }
    
    // Check KYC status (required)
    if (user.kyc !== 'approved') {
      throw new Error('KYC approval required for virtual account');
    }
    
    const accessToken = await generateBillstackAccessToken(CONFIG);
    
    // Generate unique reference
    const accountReference = `VTU_${userId}_${Date.now()}`;
    const accountName = user.fullName || `User ${userId}`;
    
    // Billstack virtual account payload
    const payload = {
      customer_name: accountName,
      customer_email: user.email,
      customer_phone: user.phone || `+234${userId.substring(0, 10)}`, // Use user ID as phone if not provided
      account_reference: accountReference,
      bvn: user.bvn || '', // Optional, not required
      nin: user.nin || '', // Optional
      currency: 'NGN',
      bank_name: 'WEMA BANK',
      bank_code: '035'
    };
    
    console.log('📤 Creating Billstack virtual account with payload:', payload);
    
    const response = await axios.post(
      `${CONFIG.BILLSTACK_BASE_URL || 'https://api.billstack.io'}/v1/virtual-accounts`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    
    console.log('📥 Billstack response:', response.data);
    
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
      
      console.log(`✅ Billstack virtual account created for user ${userId}:`, {
        accountNumber: accountDetails.account_number,
        bankName: accountDetails.bank_name
      });
      
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

async function getVirtualAccountDetails(userId, user, virtualAccounts, CONFIG) {
  try {
    // Check if Billstack is properly configured
    if (!CONFIG.BILLSTACK_EMAIL || !CONFIG.BILLSTACK_PASSWORD) {
      return null;
    }
    
    // Check memory cache first
    if (virtualAccounts[userId]) {
      return virtualAccounts[userId];
    }
    
    // If user has virtual account reference, fetch from Billstack
    if (user && user.virtualAccount) {
      const accessToken = await generateBillstackAccessToken(CONFIG);
      
      const response = await axios.get(
        `${CONFIG.BILLSTACK_BASE_URL || 'https://api.billstack.io'}/v1/virtual-accounts/${user.virtualAccount}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
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

// Main exports - FIXED: Handle missing Billstack configuration properly
module.exports = {
  // Handle deposit command - FIXED: Check for Billstack configuration properly
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
      
      // FIX: Check if user has email from previous sessions
      if (!user.email && users[userId] && users[userId].email) {
        user.email = users[userId].email;
        console.log(`📧 Restored email for user ${userId}: ${user.email}`);
      }
      
      console.log(`💳 Deposit requested by user ${userId}:`, {
        hasEmail: !!user.email,
        userEmail: user.email,
        kycStatus: user.kyc,
        hasVirtualAccount: !!user.virtualAccount,
        billstackConfigured: !!(CONFIG.BILLSTACK_EMAIL && CONFIG.BILLSTACK_PASSWORD),
        BILLSTACK_EMAIL: CONFIG.BILLSTACK_EMAIL ? 'SET' : 'NOT SET',
        BILLSTACK_PASSWORD: CONFIG.BILLSTACK_PASSWORD ? 'SET' : 'NOT SET'
      });
      
      // Check if Billstack is configured - FIXED: Show helpful message
      if (!CONFIG.BILLSTACK_EMAIL || !CONFIG.BILLSTACK_PASSWORD) {
        console.log('⚠️ Billstack not configured in environment variables');
        
        // Ask user to set email anyway for when Billstack is configured later
        if (!user.email || !isValidEmail(user.email)) {
          console.log(`📧 User ${userId} needs email (Billstack not configured yet)`);
          return await handleEmailUpdate(ctx, users, userId, user, CONFIG, sessions);
        }
        
        return await ctx.reply(
          `⚠️ *VIRTUAL ACCOUNT SERVICE TEMPORARILY UNAVAILABLE*\n\n` +
          `🏦 *Status\\:* Maintenance in Progress\n\n` +
          `📧 *Your Email\\:* ✅ SET \\(${escapeMarkdown(user.email)}\\)\n` +
          `🛂 *Your KYC\\:* ✅ APPROVED\n\n` +
          `💡 *What to do\\:*\n` +
          `1\\. Your email is saved for when service resumes\n` +
          `2\\. Contact @opuenekeke for manual deposit options\n` +
          `3\\. Try again in a few hours\n\n` +
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
      
      // Check KYC status first
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
      
      // Check email (required for Billstack)
      if (!user.email || !isValidEmail(user.email)) {
        console.log(`📧 User ${userId} needs email`);
        return await handleEmailUpdate(ctx, users, userId, user, CONFIG, sessions);
      }
      
      // Get or create virtual account
      let accountDetails = await getVirtualAccountDetails(userId, user, virtualAccounts, CONFIG);
      
      if (!accountDetails) {
        // Create new virtual account
        try {
          await ctx.reply(
            '🔄 *Creating your virtual account\\.\\.\\.*\n\n' +
            'Please wait while we generate your dedicated bank account\\.\n' +
            'This may take a few seconds\\.',
            { parse_mode: 'MarkdownV2' }
          );
          
          accountDetails = await createVirtualAccountForUser(userId, user, virtualAccounts, CONFIG);
          
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
          } else if (error.message.includes('not configured')) {
            errorMessage = 'Billstack service not configured. Contact admin.';
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

  // Handle text messages (email input only - NO BVN) - FIXED: Save email properly
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
        
        // FIX: Save email properly to user object
        userData.email = email;
        
        // Also update the main users object
        if (!users[userId]) {
          users[userId] = {};
        }
        users[userId].email = email;
        
        console.log(`✅ Email saved for user ${userId}: ${email}`);
        console.log(`📝 User ${userId} data after save:`, users[userId]);
        
        // Clear session
        delete sessions[userId];
        
        await ctx.reply(
          `✅ *EMAIL SAVED\\!*\n\n` +
          `📧 *Your Email\\:* ${escapeMarkdown(email)}\n\n` +
          `🎉 Email saved successfully\\!\n` +
          `You can now create your virtual account when Billstack is configured\\.\n\n` +
          `💡 *Next Steps\\:*\n` +
          `1\\. Billstack configuration pending by admin\n` +
          `2\\. Contact @opuenekeke for updates\n` +
          `3\\. Try deposit again in a few hours`,
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

  // Callback handlers
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

  // Billstack.io webhook handler
  handleBillstackWebhook: (bot, users, transactions, CONFIG, virtualAccounts) => {
    return async (req, res) => {
      console.log('📨 Billstack Webhook Received:', {
        event: req.body?.event,
        timestamp: new Date().toISOString()
      });
      
      try {
        const payload = req.body;
        const event = payload.event;
        
        // Log full payload for debugging
        console.log('🔍 Billstack webhook payload:', JSON.stringify(payload, null, 2));
        
        // Handle deposit event
        if (event === 'virtual_account.deposit' || event === 'transaction.success') {
          const data = payload.data || payload;
          const amount = parseFloat(data.amount || 0);
          const accountNumber = data.account_number;
          const reference = data.reference || data.transaction_reference;
          const customerEmail = data.customer_email;
          const customerName = data.customer_name;
          
          console.log('💰 Processing Billstack deposit:', {
            accountNumber,
            amount,
            reference,
            customerEmail
          });
          
          if (!amount || amount <= 0) {
            console.error('❌ Invalid amount');
            return res.status(400).json({ 
              status: 'error', 
              message: 'Invalid amount' 
            });
          }
          
          // Find user by account number or email
          let userId = null;
          
          // Method 1: Find by account number
          for (const [uid, va] of Object.entries(virtualAccounts)) {
            if (va.accountNumber === accountNumber) {
              userId = uid;
              console.log(`🔑 Found user by account number: ${userId}`);
              break;
            }
          }
          
          // Method 2: Find by email
          if (!userId && customerEmail) {
            for (const [uid, user] of Object.entries(users)) {
              if (user.email === customerEmail) {
                userId = uid;
                console.log(`🔑 Found user by email: ${userId}`);
                break;
              }
            }
          }
          
          // Method 3: Extract from reference
          if (!userId && reference) {
            const refParts = reference.split('_');
            if (refParts.length >= 2 && refParts[0] === 'VTU') {
              userId = refParts[1];
              console.log(`🔑 Found user from reference: ${userId}`);
            }
          }
          
          if (!userId || !users[userId]) {
            console.error(`❌ User not found for deposit`);
            
            // Still return 200 to Billstack so they don't retry
            return res.status(200).json({ 
              status: 'error', 
              message: 'User not found',
              note: 'Admin will handle manually'
            });
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
            customerName: customerName,
            description: 'Billstack virtual account deposit'
          });
          
          // Update stats
          user.dailyDeposit = (user.dailyDeposit || 0) + amount;
          user.lastDeposit = new Date().toLocaleString();
          
          console.log(`✅ User ${userId} credited ${amount}. New balance: ${user.wallet}`);
          
          // Notify user
          try {
            await bot.telegram.sendMessage(
              userId,
              `💰 *DEPOSIT RECEIVED\\!*\n\n` +
              `✅ Your deposit has been processed\\!\n\n` +
              `💵 *Amount\\:* ${formatCurrency(amount)}\n` +
              `💳 *New Balance\\:* ${formatCurrency(user.wallet)}\n` +
              `🔢 *Reference\\:* ${reference || 'N/A'}\n` +
              `📅 *Date\\:* ${new Date().toLocaleString('en-NG')}\n\n` +
              `🎉 You can now use your funds\\!`,
              { parse_mode: 'MarkdownV2' }
            );
          } catch (telegramError) {
            console.error('❌ Failed to notify user:', telegramError.message);
          }
          
          // Notify admin
          try {
            await bot.telegram.sendMessage(
              CONFIG.ADMIN_ID,
              `💰 *BILLSTACK DEPOSIT*\n\n` +
              `👤 *User\\:* ${userId}\n` +
              `💵 *Amount\\:* ${formatCurrency(amount)}\n` +
              `🔢 *Reference\\:* ${reference || 'N/A'}\n` +
              `💳 *New Balance\\:* ${formatCurrency(user.wallet)}\n` +
              `⏰ *Time\\:* ${new Date().toLocaleString('en-NG')}`,
              { parse_mode: 'MarkdownV2' }
            );
          } catch (adminError) {
            console.error('❌ Failed to notify admin:', adminError.message);
          }
          
          return res.status(200).json({ 
            status: 'success', 
            message: 'Deposit processed successfully',
            userId: userId,
            amount: amount
          });
        }
        
        // For other events
        return res.status(200).json({ 
          status: 'received', 
          message: 'Webhook processed',
          event: event
        });
        
      } catch (error) {
        console.error('❌ Billstack webhook error:', error);
        
        // Always return 200 to Billstack so they don't retry
        return res.status(200).json({ 
          status: 'error', 
          message: 'Processing error',
          error: error.message
        });
      }
    };
  },

  // FIX: Added handleMonnifyWebhook for backward compatibility
  handleMonnifyWebhook: function(bot, users, transactions, CONFIG, virtualAccounts) {
    // Just call the Billstack webhook handler since it's the same format
    return this.handleBillstackWebhook(bot, users, transactions, CONFIG, virtualAccounts);
  }
};