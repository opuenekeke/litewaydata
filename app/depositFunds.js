/**
 * depositFunds.js
 * Handles wallet deposits via Billstack virtual accounts
 */

const axios = require('axios');

/* =====================================================
   ENV CHECK
===================================================== */
const {
  BILLSTACK_API_KEY,
  BILLSTACK_SECRET_KEY,
  BILLSTACK_BASE_URL,
} = process.env;

if (!BILLSTACK_API_KEY || !BILLSTACK_BASE_URL) {
  console.error('❌ Billstack environment variables missing');
}

/* =====================================================
   AXIOS INSTANCE
===================================================== */
const billstackClient = axios.create({
  baseURL: BILLSTACK_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/* =====================================================
   1️⃣ GENERATE BILLSTACK ACCESS TOKEN
===================================================== */
async function generateBillstackAccessToken() {
  try {
    console.log('🔑 Generating Billstack access token...');

    const response = await billstackClient.post(
      '/v1/auth/token',
      {},
      {
        headers: {
          Authorization: `Bearer ${BILLSTACK_API_KEY}`,
        },
      }
    );

    const token = response?.data?.data?.access_token;

    if (!token) {
      throw new Error('No access token returned from Billstack');
    }

    console.log('✅ Billstack access token generated');
    return token;
  } catch (error) {
    console.error('❌ Billstack auth error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw error;
  }
}

/* =====================================================
   2️⃣ CREATE VIRTUAL ACCOUNT
===================================================== */
async function createBillstackVirtualAccount(user) {
  try {
    console.log(`🔄 Creating Billstack virtual account for user ${user.telegramId}`);

    const token = await generateBillstackAccessToken();

    const response = await billstackClient.post(
      '/v1/virtual-accounts',
      {
        email: user.email,
        first_name: user.firstName || 'User',
        last_name: user.lastName || 'Wallet',
        reference: `TG-${user.telegramId}`,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    console.log('✅ Virtual account created successfully');

    return response.data?.data;
  } catch (error) {
    console.error('❌ Create virtual account failed:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw error;
  }
}

/* =====================================================
   3️⃣ HANDLE DEPOSIT REQUEST (TELEGRAM ENTRY POINT)
===================================================== */
async function handleDeposit(ctx, user) {
  try {
    console.log(`💰 Deposit requested by user ${user.telegramId}:`, {
      hasEmail: !!user.email,
      kycStatus: user.kycStatus,
      hasVirtualAccount: !!user.virtualAccount,
    });

    // 🔐 KYC CHECK
    if (user.kycStatus !== 'approved') {
      return ctx.reply('❌ Please complete KYC before making a deposit.');
    }

    // 📧 EMAIL CHECK
    if (!user.email) {
      return ctx.reply('❌ Please add your email before depositing.');
    }

    // 🏦 CREATE VIRTUAL ACCOUNT IF NOT EXISTS
    if (!user.virtualAccount) {
      const account = await createBillstackVirtualAccount(user);

      // 👉 SAVE TO DATABASE (YOU MUST IMPLEMENT THIS)
      await saveUserVirtualAccount(user.telegramId, account);

      return ctx.reply(
        `✅ Your deposit account is ready!\n\n` +
        `🏦 Bank: ${account.bank_name}\n` +
        `🔢 Account No: ${account.account_number}\n` +
        `👤 Name: ${account.account_name}\n\n` +
        `💡 Transfer to this account to fund your wallet.`
      );
    }

    // IF ACCOUNT ALREADY EXISTS
    return ctx.reply(
      `💰 Your deposit account:\n\n` +
      `🏦 Bank: ${user.virtualAccount.bank_name}\n` +
      `🔢 Account No: ${user.virtualAccount.account_number}\n` +
      `👤 Name: ${user.virtualAccount.account_name}`
    );

  } catch (error) {
    console.error('❌ Deposit handler failed:', error.message);
    return ctx.reply('❌ Unable to process deposit right now. Please try again later.');
  }
}

/* =====================================================
   4️⃣ PLACEHOLDER: SAVE ACCOUNT TO DB
===================================================== */
async function saveUserVirtualAccount(telegramId, account) {
  /**
   * Example fields to save:
   * account.account_number
   * account.bank_name
   * account.account_name
   * account.reference
   */

  console.log(`💾 Saving virtual account for user ${telegramId}`);

  // 🔴 IMPLEMENT YOUR OWN DATABASE LOGIC HERE
  return true;
}

/* =====================================================
   EXPORTS
===================================================== */
module.exports = {
  handleDeposit,
};
