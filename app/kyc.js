// app/kyc.js
module.exports = {
  handleKyc: async (ctx, users) => {
    try {
      const userId = ctx.from.id.toString();
      const user = users[userId] || {
        kyc: 'pending'
      };
      
      if (user.kyc === 'approved') {
        await ctx.reply(
          `✅ *KYC VERIFIED*\n\n` +
          `🎉 Your account is fully verified\\!\n\n` +
          `🔓 *Verified Features\\:*\n` +
          `• Unlimited transactions\n` +
          `• Higher transaction limits\n` +
          `• Priority support\n` +
          `• Access to all services\n\n` +
          `💡 *Ready to start\\?*\n` +
          `1\\. Deposit funds\n` +
          `2\\. Buy airtime/data\n` +
          `3\\. Transfer funds`,
          { parse_mode: 'MarkdownV2' }
        );
      } else {
        await ctx.reply(
          `🛂 *KYC VERIFICATION*\n\n` +
          `📋 *Status\\:* ⏳ PENDING APPROVAL\n\n` +
          `📝 *To Get Approved\\:*\n` +
          `1\\. Contact @opuenekeke\n` +
          `2\\. Provide your User ID\\: \`${userId}\`\n` +
          `3\\. Wait for admin approval\n\n` +
          `⚠️ *KYC Required For\\:*\n` +
          `• All transactions\n` +
          `• Wallet deposits\n` +
          `• Account security\n\n` +
          `⏰ *Processing Time\\:*\n` +
          `5\\-10 minutes`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      
    } catch (error) {
      console.error('❌ KYC error:', error);
    }
  }
};