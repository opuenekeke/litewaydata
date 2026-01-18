// app/walletBalance.js
module.exports = {
  handleWallet: async (ctx, users, CONFIG) => {
    try {
      const userId = ctx.from.id.toString();
      const user = users[userId] || {
        wallet: 0,
        kyc: 'pending',
        pin: null
      };
      
      await ctx.reply(
        `💰 *WALLET BALANCE*\n\n` +
        `💵 *Available\\:* ${formatCurrency(user.wallet)}\n` +
        `🛂 *KYC Status\\:* ${user.kyc.toUpperCase()}\n` +
        `🔐 *PIN\\:* ${user.pin ? '✅ SET' : '❌ NOT SET'}\n\n` +
        `💡 *Quick Actions\\:*\n` +
        `• Set PIN\\: /setpin 1234\n` +
        `• Add funds\\: Use 💳 Deposit Funds\n` +
        `• Transfer\\: Use 💸 Transfer Funds`,
        { parse_mode: 'MarkdownV2' }
      );
      
    } catch (error) {
      console.error('❌ Wallet error:', error);
    }
  }
};

function formatCurrency(amount) {
  return `₦${amount.toLocaleString('en-NG')}`;
}