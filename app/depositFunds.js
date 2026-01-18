// app/depositFunds.js - COMPLETE FIXED VERSION
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

function maskBVN(bvn) {
  if (!bvn || bvn.length !== 11) return 'Invalid BVN';
  return `${bvn.substring(0, 3)}*****${bvn.substring(8)}`;
}

async function generateMonnifyAccessToken(CONFIG) {
  try {
    const authString = Buffer.from(`${CONFIG.MONNIFY_API_KEY}:${CONFIG.MONNIFY_SECRET_KEY}`).toString('base64');
    
    const response = await axios.post(
      `${CONFIG.MONNIFY_BASE_URL}/api/v1/auth/login`,
      {},
      {
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    
    if (response.data.requestSuccessful && response.data.responseBody) {
      return response.data.responseBody.accessToken;
    }
    throw new Error('Failed to get access token: ' + (response.data.responseMessage || 'Unknown error'));
  } catch (error) {
    console.error('❌ Monnify auth error:', error.message);
    if (error.response?.data) {
      console.error('❌ API Response:', error.response.data);
    }
    throw error;
  }
}

async function createVirtualAccountForUser(userId, user, virtualAccounts, CONFIG) {
  try {
    console.log(`🔄 Creating virtual account for user ${userId}`);
    
    if (!CONFIG.MONNIFY_ENABLED) {
      throw new Error('Monnify not enabled');
    }
    
    // Check if user has verified BVN
    if (!user.bvn || !user.bvnVerified) {
      throw new Error('BVN not verified');
    }
    
    // Check if user has valid email
    if (!user.email || !isValidEmail(user.email)) {
      throw new Error('Invalid email address');
    }
    
    const accessToken = await generateMonnifyAccessToken(CONFIG);
    
    // Generate unique reference
    const accountReference = `VTU_${userId}_${Date.now()}`;
    const accountName = user.fullName || `User ${userId}`;
    
    const payload = {
      accountReference: accountReference,
      accountName: accountName,
      currencyCode: "NGN",
      contractCode: CONFIG.MONNIFY_CONTRACT_CODE,
      customerEmail: user.email,
      customerName: accountName,
      getAllAvailableBanks: false,
      preferredBanks: ["035"], // WEMA Bank
      bvn: user.bvn
    };
    
    console.log('📤 Creating virtual account with payload:', {
      ...payload,
      bvn: maskBVN(user.bvn)
    });
    
    const response = await axios.post(
      `${CONFIG.MONNIFY_BASE_URL}/api/v2/bank-transfer/reserved-accounts`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    
    console.log('📥 Virtual account response:', response.data);
    
    if (response.data.requestSuccessful && response.data.responseBody) {
      const accountDetails = response.data.responseBody;
      
      // Store virtual account details
      virtualAccounts[userId] = {
        accountReference: accountReference,
        accountNumber: accountDetails.accounts[0].accountNumber,
        accountName: accountDetails.accountName,
        bankName: accountDetails.accounts[0].bankName,
        bankCode: accountDetails.accounts[0].bankCode,
        customerEmail: user.email,
        customerName: accountName,
        bvn: maskBVN(user.bvn),
        bvnVerified: true,
        created: new Date().toISOString(),
        active: true
      };
      
      // Update user record
      user.virtualAccount = accountReference;
      user.virtualAccountNumber = accountDetails.accounts[0].accountNumber;
      user.virtualAccountBank = accountDetails.accounts[0].bankName;
      
      console.log(`✅ Virtual account created for user ${userId}:`, {
        accountNumber: accountDetails.accounts[0].accountNumber,
        bankName: accountDetails.accounts[0].bankName
      });
      
      return virtualAccounts[userId];
    }
    
    throw new Error(response.data.responseMessage || 'Failed to create virtual account');
    
  } catch (error) {
    console.error('❌ Create virtual account error:', error.message);
    if (error.response?.data) {
      console.error('❌ API Response:', error.response.data);
    }
    throw error;
  }
}

async function getVirtualAccountDetails(userId, user, virtualAccounts, CONFIG) {
  try {
    if (!CONFIG.MONNIFY_ENABLED) {
      return null;
    }
    
    // Check memory cache first
    if (virtualAccounts[userId]) {
      return virtualAccounts[userId];
    }
    
    // If user has virtual account reference, fetch from Monnify
    if (user && user.virtualAccount) {
      const accessToken = await generateMonnifyAccessToken(CONFIG);
      
      const response = await axios.get(
        `${CONFIG.MONNIFY_BASE_URL}/api/v2/bank-transfer/reserved-accounts/${user.virtualAccount}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      
      if (response.data.requestSuccessful && response.data.responseBody) {
        const accountDetails = response.data.responseBody;
        virtualAccounts[userId] = {
          accountReference: user.virtualAccount,
          accountNumber: accountDetails.accounts[0].accountNumber,
          accountName: accountDetails.accountName,
          bankName: accountDetails.accounts[0].bankName,
          bankCode: accountDetails.accounts[0].bankCode,
          customerEmail: user.email,
          customerName: user.fullName,
          bvn: user.bvn ? maskBVN(user.bvn) : 'Not provided',
          bvnVerified: user.bvnVerified || false,
          created: accountDetails.createdOn,
          active: true
        };
        return virtualAccounts[userId];
      }
    }
    return null;
  } catch (error) {
    console.error('❌ Get virtual account error:', error.message);
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
      `• Required by financial regulations\n\n` +
      `📛 *Current Email\\:* ${user.email || 'Not set'}\n\n` +
      `📝 *Enter your valid email address\\:*\n\n` +
      `💡 *Examples\\:*\n` +
      `• john\\_doe@gmail\\.com\n` +
      `• jane\\_smith@yahoo\\.com\n` +
      `• user123@outlook\\.com`,
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

async function handleBVNSubmission(ctx, users, userId, user, CONFIG, sessions) {
  try {
    // Check if user has submitted BVN but not verified
    if (user.bvn && !user.bvnVerified) {
      return await ctx.reply(
        `🆔 *BVN VERIFICATION PENDING*\n\n` +
        `✅ *BVN Submitted\\:* \`${maskBVN(user.bvn)}\`\n` +
        `📋 *Status\\:* ⏳ Under Review\n\n` +
        `⏰ *Processing Time\\:*\n` +
        `Your BVN is being verified by our security team\\.\n` +
        `Please wait for admin approval\\.\n\n` +
        `📞 *Need help\\?*\n` +
        `Contact @opuenekeke for assistance\\.`,
        {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📧 Update Email', 'update_email')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        }
      );
    }
    
    // If no BVN, ask for BVN submission
    await ctx.reply(
      `🆔 *BVN VERIFICATION REQUIRED*\n\n` +
      `🔒 *Why BVN\\?*\n` +
      `• Required for virtual account creation\n` +
      `• Ensures account security\n` +
      `• Required by CBN regulations\n` +
      `• Protects against fraud\n\n` +
      `📋 *How it works\\:*\n` +
      `1\\. Submit your 11\\-digit BVN\n` +
      `2\\. Our team verifies it \\(1\\-2 hours\\)\n` +
      `3\\. Get virtual account instantly\n` +
      `4\\. Start depositing funds\n\n` +
      `📝 *Enter your 11\\-digit BVN\\:*\n\n` +
      `💡 *Example\\:* 12345678901`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📧 Update Email', 'update_email')],
          [Markup.button.callback('❌ Cancel', 'start')]
        ])
      }
    );
    
    // Set session for BVN collection
    sessions[userId] = {
      action: 'bvn_submission',
      step: 1,
      userId: userId
    };
    
  } catch (error) {
    console.error('❌ BVN submission error:', error);
    await ctx.reply(
      '❌ Error processing BVN submission\\. Please try again\\.',
      { parse_mode: 'MarkdownV2' }
    );
  }
}

// Main exports
module.exports = {
  // Handle deposit command
  handleDeposit: async (ctx, users, virtualAccounts, CONFIG, sessions) => {
    try {
      const userId = ctx.from.id.toString();
      const user = users[userId] || {
        wallet: 0,
        fullName: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || `User ${userId}`,
        email: null,
        bvn: null,
        bvnVerified: false,
        virtualAccount: null,
        virtualAccountNumber: null,
        virtualAccountBank: null
      };
      
      // Initialize user if not exists
      users[userId] = user;
      
      console.log(`💳 Deposit requested by user ${userId}:`, {
        hasEmail: !!user.email,
        hasBVN: !!user.bvn,
        bvnVerified: user.bvnVerified,
        hasVirtualAccount: !!user.virtualAccount
      });
      
      if (!CONFIG.MONNIFY_ENABLED) {
        return await ctx.reply(
          `💳 *MANUAL DEPOSIT*\n\n` +
          `💰 *Current Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
          `📥 *To Add Funds\\:*\n` +
          `1\\. Contact @opuenekeke\n` +
          `2\\. Send payment proof\n` +
          `3\\. Include your User ID\\: \`${userId}\`\n` +
          `4\\. Wait for manual approval\n\n` +
          `💵 *Payment Methods\\:*\n` +
          `• Bank Transfer\n` +
          `• USDT \\(TRC20\\)\n` +
          `• Mobile Money`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      // Step 1: Check email
      if (!user.email || !isValidEmail(user.email)) {
        console.log(`📧 User ${userId} needs email`);
        return await handleEmailUpdate(ctx, users, userId, user, CONFIG, sessions);
      }
      
      // Step 2: Check BVN
      if (!user.bvn || !user.bvnVerified) {
        console.log(`🆔 User ${userId} needs BVN`);
        return await handleBVNSubmission(ctx, users, userId, user, CONFIG, sessions);
      }
      
      // Step 3: Get or create virtual account
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
          if (error.message.includes('BVN')) {
            errorMessage = 'BVN verification failed. Please contact admin.';
          } else if (error.message.includes('email')) {
            errorMessage = 'Email validation failed. Please update your email.';
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
      
      // Step 4: Show account details
      const instructions = `💰 *YOUR VIRTUAL ACCOUNT*\n\n` +
        `🏦 **Bank Name\\:** ${accountDetails.bankName || 'WEMA BANK'}\n` +
        `🔢 **Account Number\\:** \`${accountDetails.accountNumber}\`\n` +
        `📛 **Account Name\\:** ${accountDetails.accountName}\n` +
        `💳 **Account Type\\:** Savings\n` +
        `🆔 **BVN Verified\\:** ✅ YES\n\n` +
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

  // Handle text messages (email and BVN input)
  handleText: async (ctx, text, session, user, users, transactions, sessions, CONFIG) => {
    try {
      const userId = ctx.from.id.toString();
      const userData = users[userId] || {};
      
      // Handle email update
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
        
        // Ask for BVN next
        sessions[userId] = {
          action: 'bvn_submission',
          step: 1,
          userId: userId
        };
        
        await ctx.reply(
          `✅ *EMAIL SAVED\\!*\n\n` +
          `📧 *Your Email\\:* ${escapeMarkdown(email)}\n\n` +
          `🆔 *NOW ENTER YOUR BVN*\n\n` +
          `Please enter your 11\\-digit BVN\\:\n\n` +
          `💡 *Example\\:* 12345678901`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      // Handle BVN submission
      else if (session.action === 'bvn_submission' && session.step === 1) {
        const bvn = text.trim();
        
        // Validate BVN
        if (!/^\d{11}$/.test(bvn)) {
          return await ctx.reply(
            '❌ *INVALID BVN*\n\n' +
            'BVN must be exactly 11 digits\\.\n\n' +
            '📝 *Example\\:* 12345678901\n\n' +
            'Please enter your 11\\-digit BVN\\:',
            { parse_mode: 'MarkdownV2' }
          );
        }
        
        // Save BVN (not verified yet)
        userData.bvn = bvn;
        userData.bvnVerified = false;
        userData.bvnSubmittedAt = new Date().toISOString();
        users[userId] = userData;
        
        // Clear session
        delete sessions[userId];
        
        // Notify admin for verification
        try {
          await ctx.telegram.sendMessage(
            CONFIG.ADMIN_ID,
            `🆔 *NEW BVN SUBMISSION*\n\n` +
            `👤 *User\\:* ${userId}\n` +
            `📛 *Name\\:* ${userData.fullName || 'Not set'}\n` +
            `📧 *Email\\:* ${userData.email || 'Not set'}\n` +
            `🆔 *BVN\\:* \`${maskBVN(bvn)}\`\n` +
            `⏰ *Submitted\\:* ${new Date().toLocaleString('en-NG')}\n\n` +
            `✅ *To Verify\\:* /verify\\_bvn ${userId}`,
            { parse_mode: 'MarkdownV2' }
          );
        } catch (error) {
          console.error('Failed to notify admin:', error);
        }
        
        await ctx.reply(
          `✅ *BVN SUBMITTED\\!*\n\n` +
          `🆔 *BVN\\:* \`${maskBVN(bvn)}\`\n` +
          `📋 *Status\\:* ⏳ Under Review\n\n` +
          `📝 *Next Steps\\:*\n` +
          `1\\. Our team verifies your BVN \\(1\\-2 hours\\)\n` +
          `2\\. You'll be notified when verified\n` +
          `3\\. Virtual account will be created automatically\n\n` +
          `📞 *Contact @opuenekeke if urgent*`,
          {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('💳 Try Deposit Now', 'start')],
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
        // You can also send it as a message
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

  // Monnify webhook handler - FIXED VERSION
  handleMonnifyWebhook: (bot, users, transactions, CONFIG, virtualAccounts) => {
    return async (req, res) => {
      console.log('📨 Monnify Webhook Received:', {
        eventType: req.body?.eventType,
        timestamp: new Date().toISOString()
      });
      
      try {
        // Get the event data
        const eventData = req.body.eventData;
        const eventType = req.body.eventType;
        
        // For SUCCESSFUL_TRANSACTION
        if (eventType === 'SUCCESSFUL_TRANSACTION' && eventData?.paymentStatus === 'PAID') {
          const accountReference = eventData.product?.reference;
          const amount = parseFloat(eventData.amount);
          const transactionRef = eventData.transactionReference;
          
          console.log('💰 Processing deposit:', {
            accountReference,
            amount,
            transactionRef
          });
          
          if (!accountReference) {
            console.error('❌ No account reference found');
            return res.status(400).json({ 
              status: 'error', 
              message: 'No account reference' 
            });
          }
          
          // Find user by account reference
          // Reference format: VTU_{userId}_{timestamp}
          const referenceParts = accountReference.split('_');
          if (referenceParts.length < 2) {
            console.error('❌ Invalid account reference format:', accountReference);
            return res.status(400).json({ 
              status: 'error', 
              message: 'Invalid reference format' 
            });
          }
          
          const userId = referenceParts[1]; // Get userId from reference
          
          if (!users[userId]) {
            console.error(`❌ User not found: ${userId}`);
            
            // Still return 200 to Monnify so they don't retry
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
            method: 'virtual_account',
            reference: transactionRef,
            status: 'completed',
            date: new Date().toLocaleString(),
            description: 'Monnify virtual account deposit'
          });
          
          // Update user stats
          user.dailyDeposit = (user.dailyDeposit || 0) + amount;
          user.lastDeposit = new Date().toLocaleString();
          
          console.log(`✅ User ${userId} credited with ${amount}. New balance: ${user.wallet}`);
          
          // Notify user
          try {
            await bot.telegram.sendMessage(
              userId,
              `💰 *DEPOSIT RECEIVED\\!*\n\n` +
              `✅ Your deposit has been processed\\!\n\n` +
              `💵 *Amount\\:* ${formatCurrency(amount)}\n` +
              `💳 *New Balance\\:* ${formatCurrency(user.wallet)}\n` +
              `🔢 *Reference\\:* ${transactionRef}\n` +
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
              `💰 *AUTOMATIC DEPOSIT*\n\n` +
              `👤 *User\\:* ${userId}\n` +
              `💵 *Amount\\:* ${formatCurrency(amount)}\n` +
              `🔢 *Reference\\:* ${transactionRef}\n` +
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
          eventType: eventType
        });
        
      } catch (error) {
        console.error('❌ Webhook processing error:', error);
        
        // Always return 200 to Monnify so they don't retry
        return res.status(200).json({ 
          status: 'error', 
          message: 'Processing error',
          error: error.message
        });
      }
    };
  }
};