/**
 * depositFunds.js
 * Billstack deposits + webhook handler
 */

const axios = require('axios');

/* =====================================================
   ENV VARIABLES
===================================================== */
const {
  BILLSTACK_API_KEY,
  BILLSTACK_BASE_URL,
} = process.env;

if (!BILLSTACK_API_KEY || !BILLSTACK_BASE_URL) {
  console.error('❌ Billstack environment variables missing');
}

/* =====================================================
   AXIOS CLIENT
===================================================== */
const billstackClient = axios.create({
  baseURL: BILLSTACK_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/* =====================================================
   1️⃣ AUTH TOKEN
===================================================== */
async function generateBillstackAccessToken() {
  try {
    console.log('🔑 Generating Billstack access token...');

    const res = await billstackClient.post(
      '/v1/auth/token',
      {},
      {
        headers: {
          Authorization: `Bearer ${BILLSTACK_API_KEY}`,
        },
      }
    );

    const token = res?.data?.data?.access_token;
    if (!token) throw new Error('No token returned');

    console.log('✅ Billstack token generated');
    return token;
  } catch (err) {
    console.error('❌ Billstack auth failed:', err.response?.data || err.message);
    throw err;
  }
}

/* =====================================================
   2️⃣ CREATE VIRTUAL ACCOUNT
===================================================== */
async function createVirtualAccount(user) {
  const token = await generateBillstackAccessToken();

  const res = await billstackClient.post(
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

  return res.data?.data;
}

/* =====================================================
   3️⃣ TELEGRAM DEPOSIT HANDLER
===================================================== */
async function handleDeposit(ctx, user) {
  try {
    if (user.kycStatus !== 'approved') {
      return ctx.reply('❌ Complete KYC to deposit.');
    }

    if (!user.email) {
      return ctx.reply('❌ Add your email first.');
    }

    if (!user.virtualAccount) {
      const account = await createVirtualAccount(user);

      await saveUserVirtualAccount(user.telegramId, account);

      return ctx.reply(
        `✅ Deposit account created\n\n` +
        `🏦 Bank: ${account.bank_name}\n` +
        `🔢 Account: ${account.account_number}\n` +
        `👤 Name: ${account.account_name}`
      );
    }

    return ctx.reply(
      `💰 Your deposit account\n\n` +
      `🏦 Bank: ${user.virtualAccount.bank_name}\n` +
      `🔢 Account: ${user.virtualAccount.account_number}\n` +
      `👤 Name: ${user.virtualAccount.account_name}`
    );

  } catch (err) {
    console.error('❌ Deposit error:', err.message);
    ctx.reply('❌ Deposit failed. Try again later.');
  }
}

/* =====================================================
   4️⃣ BILLSTACK WEBHOOK HANDLER
===================================================== */
function handleBillstackWebhook(bot, users, transactions, CONFIG, virtualAccounts) {
  return async (req, res) => {
    try {
      const payload = req.body;
      console.log('📥 Billstack webhook received:', payload);

      if (payload.event !== 'transfer.success') {
        return res.status(200).send('Ignored');
      }

      const {
        amount,
        reference,
        account_number,
      } = payload.data;

      const user = await users.findByVirtualAccount(account_number);
      if (!user) return res.status(404).send('User not found');

      await users.creditWallet(user.telegramId, amount);

      await transactions.create({
        telegramId: user.telegramId,
        amount,
        reference,
        type: 'deposit',
        status: 'success',
      });

      await bot.telegram.sendMessage(
        user.telegramId,
        `✅ Wallet credited\n\n💰 Amount: ₦${amount}`
      );

      res.status(200).send('OK');
    } catch (err) {
      console.error('❌ Webhook error:', err.message);
      res.status(500).send('Error');
    }
  };
}

/* =====================================================
   PLACEHOLDER DB SAVE
===================================================== */
async function saveUserVirtualAccount(telegramId, account) {
  console.log(`💾 Saving virtual account for ${telegramId}`);
  return true;
}

/* =====================================================
   EXPORTS
===================================================== */
module.exports = {
  handleDeposit,
  handleBillstackWebhook,
};
