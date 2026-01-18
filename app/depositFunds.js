// app/depositFunds.js - COMPLETE FIXED VERSION WITH PROPER FLOW
const axios = require('axios');
const crypto = require('crypto');
const { Markup } = require('telegraf');

module.exports = {
  handleDeposit: async (ctx, users, virtualAccounts, CONFIG, sessions) => {
    try {
      const userId = ctx.from.id.toString();
      const user = users[userId] || {
        wallet: 0,
        fullName: null,
        email: null,
        bvn: null,
        bvnVerified: false,
        virtualAccount: null,
        virtualAccountNumber: null,
        virtualAccountBank: null
      };
      
      // Initialize user if not exists
      if (!users[userId]) {
        users[userId] = user;
      }
      
      // Ensure user has full name
      if (!user.fullName) {
        user.fullName = ctx.from.first_name || ctx.from.username || `User ${userId}`;
      }
      
      if (!CONFIG.MONNIFY_ENABLED) {
        return await ctx.reply(
          `💳 *DEPOSIT FUNDS*\n\n` +
          `💰 *Current Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
          `📥 *To Add Funds\\:*\n` +
          `1\\. Contact @opuenekeke\n` +
          `2\\. Send payment proof \\(screenshot\\)\n` +
          `3\\. Include your User ID\\: \`${userId}\`\n` +
          `4\\. Wait for confirmation\n\n` +
          `💵 *Payment Methods\\:*\n` +
          `• Bank Transfer\n` +
          `• USDT \\(TRC20\\)\n` +
          `• Mobile Money\n\n` +
          `⏰ *Processing Time\\:*\n` +
          `Instant to 5 minutes`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      console.log(`📊 Deposit process for user ${userId}:`, {
        hasEmail: !!user.email,
        hasBVN: !!user.bvn,
        bvnVerified: user.bvnVerified,
        emailValid: user.email ? isValidEmail(user.email) : false
      });
      
      // Check if user has valid email
      if (!user.email || !isValidEmail(user.email)) {
        console.log(`📧 User ${userId} needs email update`);
        return await handleEmailUpdate(ctx, users, userId, user, CONFIG, sessions);
      }
      
      // Check if user has BVN
      if (!user.bvn || !user.bvnVerified) {
        console.log(`🆔 User ${userId} needs BVN submission`);
        return await handleBVNSubmission(ctx, users, userId, user, CONFIG, sessions);
      }
      
      let accountDetails = await getVirtualAccountDetails(userId, user, virtualAccounts, CONFIG);
      
      if (!accountDetails) {
        await ctx.reply(
          '🔄 *Creating your virtual account\\.\\.\\.*\n\n' +
          'Please wait while we set up your dedicated bank account\\.',
          { parse_mode: 'MarkdownV2' }
        );
        
        try {
          accountDetails = await createVirtualAccountForUser(userId, user, virtualAccounts, CONFIG);
          
          if (accountDetails) {
            await ctx.reply(
              '✅ *Virtual account created successfully\\!*\n\n' +
              'Your personal bank account has been generated\\.\n' +
              'Send funds to this account and they will reflect automatically\\!',
              { parse_mode: 'MarkdownV2' }
            );
          } else {
            throw new Error('Failed to create virtual account');
          }
        } catch (error) {
          console.error('❌ Virtual account creation error:', error.message);
          console.error('❌ Full error details:', error.response?.data || error);
          
          // Get specific error message
          let errorMessage = 'Failed to create virtual account.';
          if (error.response?.data?.responseMessage) {
            errorMessage = error.response.data.responseMessage;
          } else if (error.message.includes('Invalid BVN')) {
            errorMessage = 'Invalid BVN provided. Please contact admin for assistance.';
          } else if (error.message.includes('email')) {
            errorMessage = 'Invalid email address. Please update your email.';
            // Set session for email update
            sessions[userId] = {
              action: 'update_email',
              step: 1,
              userId: userId
            };
          }
          
          await ctx.reply(
            `❌ *VIRTUAL ACCOUNT CREATION FAILED*\n\n` +
            `📋 *Error\\:* ${escapeMarkdown(errorMessage)}\n\n` +
            `📞 *Please contact admin\\:*\n` +
            `1\\. Send a message to @opuenekeke\n` +
            `2\\. Include your User ID\\: \`${userId}\`\n` +
            `3\\. Mention "Virtual Account Creation Failed"`,
            {
              parse_mode: 'MarkdownV2',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('📧 Update Email', 'update_email')],
                [Markup.button.callback('🏠 Home', 'start')]
              ])
            }
          );
          return;
        }
      }
      
      const instructions = `💰 *DEPOSIT VIA VIRTUAL ACCOUNT*\n\n` +
        `🏦 **Bank Name\\:** ${accountDetails.bankName || 'WEMA BANK'}\n` +
        `🔢 **Account Number\\:** \`${accountDetails.accountNumber}\`\n` +
        `📛 **Account Name\\:** ${accountDetails.accountName}\n` +
        `💳 **Account Type\\:** Savings\n` +
        `🆔 **BVN Verified\\:** ✅ YES\n\n` +
        `📝 **How to Deposit\\:**\n` +
        `1\\. Open your bank app or visit any bank branch\n` +
        `2\\. Transfer to the account details above\n` +
        `3\\. Use your User ID \\(${userId}\\) as narration\n` +
        `4\\. Funds reflect automatically within 1\\-3 minutes\n\n` +
        `⚠️ **Important Notes\\:**\n` +
        `• Only transfer from Nigerian bank accounts\n` +
        `• Minimum deposit\\: ₦100\n` +
        `• Maximum deposit\\: ₦5,000,000 per transaction\n` +
        `• No deposit charges from our side\n` +
        `• Funds reflect automatically via webhook\n` +
        `• Contact support if funds don't reflect within 5 minutes`;
      
      await ctx.reply(
        instructions,
        {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📋 Copy Account Number', `copy_acc_${accountDetails.accountNumber}`)],
            [Markup.button.callback('📧 Update Email', 'update_email')],
            [Markup.button.callback('🔄 Refresh Balance', 'refresh_balance')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        }
      );
      
    } catch (error) {
      console.error('❌ Deposit error:', error);
      await ctx.reply(
        `💳 *DEPOSIT FUNDS*\n\n` +
        `💰 *Current Balance\\:* ${formatCurrency(users[ctx.from.id.toString()]?.wallet || 0)}\n\n` +
        `📥 *To Add Funds\\:*\n` +
        `1\\. Contact @opuenekeke\n` +
        `2\\. Send payment proof \\(screenshot\\)\n` +
        `3\\. Include your User ID\\: \`${ctx.from.id.toString()}\`\n` +
        `4\\. Wait for confirmation`,
        { parse_mode: 'MarkdownV2' }
      );
    }
  },

  getCallbacks: (bot, users, virtualAccounts, CONFIG, sessions) => {
    return {
      'copy_acc_(.+)': async (ctx) => {
        const accountNumber = ctx.match[1];
        await ctx.answerCbQuery(`Account number copied: ${accountNumber}`);
      },
      'refresh_balance': async (ctx) => {
        const userId = ctx.from.id.toString();
        const user = users[userId] || { wallet: 0 };
        
        await ctx.editMessageText(
          `💰 *YOUR WALLET BALANCE*\n\n` +
          `💵 *Available\\:* ${formatCurrency(user.wallet)}\n` +
          `📅 *Last Updated\\:* ${new Date().toLocaleString('en-NG')}\n\n` +
          `💡 *Note\\:* Balance refreshed successfully\\.`,
          {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Refresh Again', 'refresh_balance')],
              [Markup.button.callback('🏠 Home', 'start')]
            ])
          }
        );
        
        ctx.answerCbQuery('✅ Balance refreshed');
      },
      'update_email': async (ctx) => {
        const userId = ctx.from.id.toString();
        const user = users[userId] || {};
        
        sessions[userId] = {
          action: 'update_email',
          step: 1,
          userId: userId
        };
        
        await ctx.editMessageText(
          `📧 *UPDATE EMAIL ADDRESS*\n\n` +
          `📛 *Current Email\\:* ${user.email || 'Not set'}\n\n` +
          `🔒 *Why update email\\?*\n` +
          `• Required for virtual account creation\n` +
          `• Used for transaction notifications\n` +
          `• Required by financial regulations\n\n` +
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
        
        ctx.answerCbQuery();
      }
    };
  },

  handleMonnifyWebhook: (bot, users, transactions, CONFIG, virtualAccounts) => {
    return async (req, res) => {
      try {
        const signature = req.headers['monnify-signature'];
        const payload = req.body;
        
        console.log('📥 Monnify Webhook Received:', {
          eventType: payload.eventType,
          transactionReference: payload.eventData?.transactionReference,
          amount: payload.eventData?.amount,
          status: payload.eventData?.paymentStatus
        });
        
        if (!verifyMonnifyWebhook(payload, signature, CONFIG.MONNIFY_WEBHOOK_SECRET)) {
          console.error('❌ Invalid webhook signature');
          return res.status(401).json({ status: 'error', message: 'Invalid signature' });
        }
        
        if (payload.eventType === 'SUCCESSFUL_TRANSACTION') {
          const transactionData = payload.eventData;
          
          if (transactionData.paymentStatus === 'PAID') {
            const accountReference = transactionData.product?.reference;
            if (!accountReference) {
              console.error('❌ No account reference in transaction data');
              return res.status(400).json({ status: 'error', message: 'No account reference' });
            }
            
            let userId = null;
            for (const [uid, user] of Object.entries(users)) {
              if (user.virtualAccount === accountReference) {
                userId = uid;
                break;
              }
            }
            
            if (!userId) {
              console.error(`❌ User not found for account reference: ${accountReference}`);
              return res.status(404).json({ status: 'error', message: 'User not found' });
            }
            
            const amount = parseFloat(transactionData.amount);
            if (isNaN(amount) || amount <= 0) {
              console.error(`❌ Invalid amount: ${transactionData.amount}`);
              return res.status(400).json({ status: 'error', message: 'Invalid amount' });
            }
            
            users[userId].wallet += amount;
            
            transactions[userId].push({
              type: 'deposit',
              amount: amount,
              date: new Date().toLocaleString(),
              status: 'success',
              source: 'monnify_virtual_account',
              reference: transactionData.transactionReference,
              paymentMethod: transactionData.paymentMethod,
              payerName: transactionData.customer?.name || 'N/A',
              payerEmail: transactionData.customer?.email || 'N/A',
              description: transactionData.description || 'Wallet deposit',
              timestamp: Date.now()
            });
            
            users[userId].dailyDeposit += amount;
            users[userId].lastDeposit = new Date().toLocaleString();
            
            console.log(`✅ Wallet credited: User ${userId}, Amount: ${amount}`);
            
            try {
              await bot.telegram.sendMessage(
                userId,
                `💰 *DEPOSIT RECEIVED\\!*\n\n` +
                `✅ Your deposit has been received and wallet credited\\!\n\n` +
                `💵 *Amount\\:* ${formatCurrency(amount)}\n` +
                `💳 *New Balance\\:* ${formatCurrency(users[userId].wallet)}\n` +
                `🔢 *Reference\\:* ${transactionData.transactionReference}\n` +
                `🏦 *Payment Method\\:* ${transactionData.paymentMethod || 'Bank Transfer'}\n` +
                `📅 *Date\\:* ${new Date().toLocaleString('en-NG')}\n\n` +
                `🎉 You can now use your funds to buy airtime, data, or transfer\\!`,
                { parse_mode: 'MarkdownV2' }
              );
            } catch (telegramError) {
              console.error('❌ Failed to notify user via Telegram:', telegramError.message);
            }
            
            try {
              await bot.telegram.sendMessage(
                CONFIG.ADMIN_ID,
                `💰 *AUTOMATIC DEPOSIT RECEIVED*\n\n` +
                `👤 *User\\:* ${userId}\n` +
                `💵 *Amount\\:* ${formatCurrency(amount)}\n` +
                `🔢 *Reference\\:* ${transactionData.transactionReference}\n` +
                `💳 *New Balance\\:* ${formatCurrency(users[userId].wallet)}\n` +
                `🏦 *Method\\:* Virtual Account\n` +
                `⏰ *Time\\:* ${new Date().toLocaleString('en-NG')}`,
                { parse_mode: 'MarkdownV2' }
              );
            } catch (adminError) {
              console.error('❌ Failed to notify admin:', adminError.message);
            }
          }
        }
        
        res.json({ status: 'success', message: 'Webhook processed successfully' });
        
      } catch (error) {
        console.error('❌ Webhook processing error:', error);
        res.status(500).json({ status: 'error', message: error.message });
      }
    };
  },

  handleText: async (ctx, text, session, user, users, transactions, sessions, CONFIG) => {
    try {
      const userId = ctx.from.id.toString();
      
      // Handle email update
      if (session.action === 'update_email' && session.step === 1) {
        console.log(`📥 Email update received from user ${userId}: ${text}`);
        
        const email = text.trim().toLowerCase();
        
        if (!isValidEmail(email)) {
          return await ctx.reply(
            '❌ *INVALID EMAIL ADDRESS*\n\n' +
            'Please enter a valid email address\\.\n\n' +
            '📝 *Valid Examples\\:*\n' +
            '• john\\_doe@gmail\\.com\n' +
            '• jane\\_smith@yahoo\\.com\n' +
            '• user123@outlook\\.com\n\n' +
            'Please enter your email\\:',
            { parse_mode: 'MarkdownV2' }
          );
        }
        
        // Save email
        user.email = email;
        users[userId] = user;
        
        // Clear session
        delete sessions[userId];
        
        console.log(`✅ Email saved for user ${userId}: ${email}`);
        
        // Check if user needs to submit BVN
        if (!user.bvn || !user.bvnVerified) {
          console.log(`🆔 User ${userId} needs BVN after email update`);
          
          // Set session for BVN collection
          sessions[userId] = {
            action: 'bvn_submission',
            step: 1,
            userId: userId
          };
          
          // Ask for BVN immediately
          await ctx.reply(
            `✅ *EMAIL UPDATED SUCCESSFULLY\\!*\n\n` +
            `📧 *New Email\\:* ${escapeMarkdown(email)}\n\n` +
            `🆔 *BVN VERIFICATION REQUIRED*\n\n` +
            `Now please enter your 11\\-digit BVN\\:\n\n` +
            `💡 *Example\\:* 12345678901`,
            {
              parse_mode: 'MarkdownV2',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ Cancel', 'start')]
              ])
            }
          );
        } else {
          // User already has BVN, show success
          await ctx.reply(
            `✅ *EMAIL UPDATED SUCCESSFULLY\\!*\n\n` +
            `📧 *New Email\\:* ${escapeMarkdown(email)}\n\n` +
            `🆔 *BVN Status\\:* ${user.bvnVerified ? '✅ Verified' : '⏳ Pending'}\n\n` +
            `🎉 You can now proceed to create your virtual account\\.`,
            {
              parse_mode: 'MarkdownV2',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('💳 Create Virtual Account', 'start')],
                [Markup.button.callback('🏠 Home', 'start')]
              ])
            }
          );
        }
      }
      
      // Handle BVN submission
      else if (session.action === 'bvn_submission' && session.step === 1) {
        console.log(`📥 BVN submission received from user ${userId}: ${text}`);
        
        const bvn = text.trim();
        
        // Validate BVN format (11 digits)
        if (!/^\d{11}$/.test(bvn)) {
          return await ctx.reply(
            '❌ *INVALID BVN*\n\n' +
            'BVN must be exactly 11 digits\\.\n\n' +
            '📝 *Example\\:* 12345678901\n\n' +
            'Please enter your 11\\-digit BVN\\:',
            { parse_mode: 'MarkdownV2' }
          );
        }
        
        // Store BVN
        user.bvn = bvn;
        user.bvnVerified = false; // Needs admin verification
        user.bvnSubmittedAt = new Date().toISOString();
        
        // Save user data
        users[userId] = user;
        
        // Clear session
        delete sessions[userId];
        
        // Notify admin for verification
        try {
          await ctx.telegram.sendMessage(
            CONFIG.ADMIN_ID,
            `🆔 *NEW BVN SUBMISSION*\n\n` +
            `👤 *User\\:* ${userId}\n` +
            `📛 *Name\\:* ${user.fullName || 'Not provided'}\n` +
            `📧 *Email\\:* ${user.email || 'Not provided'}\n` +
            `🆔 *BVN\\:* \`${maskBVN(bvn)}\`\n` +
            `⏰ *Submitted\\:* ${new Date().toLocaleString('en-NG')}\n\n` +
            `✅ *To Verify\\:* /verify\\_bvn ${userId}`,
            { parse_mode: 'MarkdownV2' }
          );
        } catch (adminError) {
          console.error('Failed to notify admin:', adminError);
        }
        
        await ctx.reply(
          `✅ *BVN SUBMITTED SUCCESSFULLY\\!*\n\n` +
          `🆔 *BVN\\:* \`${maskBVN(bvn)}\`\n` +
          `📋 *Status\\:* ⏳ Under Review\n\n` +
          `📝 *What happens next\\?*\n` +
          `1\\. Our security team verifies your BVN\n` +
          `2\\. You will be notified once verified\n` +
          `3\\. Virtual account will be created automatically\n` +
          `4\\. You can then deposit funds\n\n` +
          `⏰ *Processing Time\\:*\n` +
          `Usually within 1\\-2 hours\\.\n\n` +
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
      
      // Handle email update before BVN (special case)
      else if (session.action === 'update_email_before_bvn' && session.step === 1) {
        const email = text.trim().toLowerCase();
        
        if (!isValidEmail(email)) {
          return await ctx.reply(
            '❌ *INVALID EMAIL ADDRESS*\n\n' +
            'Please enter a valid email address\\.\n\n' +
            '📝 *Valid Examples\\:*\n' +
            '• john\\_doe@gmail\\.com\n' +
            '• jane\\_smith@yahoo\\.com\n' +
            '• user123@outlook\\.com\n\n' +
            'Please enter your email\\:',
            { parse_mode: 'MarkdownV2' }
          );
        }
        
        user.email = email;
        users[userId] = user;
        
        // Set session for BVN collection
        sessions[userId] = {
          action: 'bvn_submission',
          step: 1,
          userId: userId
        };
        
        // Ask for BVN immediately
        await ctx.reply(
          `✅ *EMAIL UPDATED SUCCESSFULLY\\!*\n\n` +
          `📧 *New Email\\:* ${escapeMarkdown(email)}\n\n` +
          `🆔 *BVN VERIFICATION REQUIRED*\n\n` +
          `Now please enter your 11\\-digit BVN\\:\n\n` +
          `💡 *Example\\:* 12345678901`,
          {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('❌ Cancel', 'start')]
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
  }
};

// Helper functions
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
    
    // Check if user has valid email
    if (!user.email || !isValidEmail(user.email)) {
      sessions[userId] = {
        action: 'update_email_before_bvn',
        step: 1,
        userId: userId
      };
      
      await ctx.reply(
        `📧 *EMAIL REQUIRED BEFORE BVN*\n\n` +
        `🔒 *Why email is required\\?*\n` +
        `• Required for virtual account creation\n` +
        `• Used for transaction notifications\n` +
        `• Required by financial regulations\n\n` +
        `📝 *Please enter your valid email address\\:*\n\n` +
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
      return;
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
      `2\\. Our team verifies it\n` +
      `3\\. Get virtual account instantly\n` +
      `4\\. Start depositing funds\n\n` +
      `⚠️ *Important\\:*\n` +
      `• Your BVN is stored securely\n` +
      `• We never share your BVN\n` +
      `• Only used for account verification\n\n` +
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
    
    console.log(`📝 Session set for BVN submission: ${userId}`);
    
  } catch (error) {
    console.error('❌ BVN submission error:', error);
    await ctx.reply(
      '❌ Error processing BVN submission\\. Please try again\\.',
      { parse_mode: 'MarkdownV2' }
    );
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
      `📧 *EMAIL UPDATE REQUIRED*\n\n` +
      `🔒 *Why update email\\?*\n` +
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
    throw new Error('Failed to get access token');
  } catch (error) {
    console.error('❌ Monnify auth error:', error.message);
    throw error;
  }
}

async function createVirtualAccountForUser(userId, user, virtualAccounts, CONFIG) {
  try {
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
    
    const accountReference = `VTU${userId}${Date.now()}`;
    const accountName = user.fullName || `User ${userId}`;
    const customerName = accountName;
    const customerEmail = user.email;
    const bvn = user.bvn || "";
    
    const payload = {
      accountReference: accountReference,
      accountName: accountName,
      currencyCode: "NGN",
      contractCode: CONFIG.MONNIFY_CONTRACT_CODE,
      customerEmail: customerEmail,
      customerName: customerName,
      getAllAvailableBanks: false,
      preferredBanks: ["035"],
      bvn: bvn
    };
    
    console.log('📤 Creating virtual account with payload:', {
      ...payload,
      bvn: maskBVN(bvn) // Mask BVN in logs
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
    
    if (response.data.requestSuccessful && response.data.responseBody) {
      const accountDetails = response.data.responseBody;
      
      virtualAccounts[userId] = {
        accountReference: accountReference,
        accountNumber: accountDetails.accounts[0].accountNumber,
        accountName: accountDetails.accountName,
        bankName: accountDetails.accounts[0].bankName,
        bankCode: accountDetails.accounts[0].bankCode,
        customerEmail: customerEmail,
        customerName: customerName,
        bvn: maskBVN(bvn),
        bvnVerified: true,
        created: new Date().toISOString(),
        active: true
      };
      
      if (user) {
        user.virtualAccount = accountReference;
        user.virtualAccountNumber = accountDetails.accounts[0].accountNumber;
        user.virtualAccountBank = accountDetails.accounts[0].bankName;
      }
      
      console.log(`✅ Virtual account created for user ${userId}: ${accountDetails.accounts[0].accountNumber}`);
      
      return virtualAccounts[userId];
    }
    throw new Error('Failed to create virtual account');
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
    
    if (virtualAccounts[userId]) {
      return virtualAccounts[userId];
    }
    
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
          customerEmail: accountDetails.customerEmail,
          customerName: accountDetails.customerName,
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

function verifyMonnifyWebhook(payload, signature, webhookSecret) {
  try {
    if (!webhookSecret) {
      console.error('⚠️ Monnify webhook secret not configured');
      return false;
    }
    
    const computedSignature = crypto
      .createHmac('sha512', webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');
    
    return computedSignature === signature;
  } catch (error) {
    console.error('❌ Webhook verification error:', error);
    return false;
  }
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
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

function maskBVN(bvn) {
  if (!bvn || bvn.length !== 11) return 'Invalid BVN';
  return `${bvn.substring(0, 3)}*****${bvn.substring(8)}`;
}