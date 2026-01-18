// cash/deposit.js - Monnify Virtual Account System
const axios = require('axios');
const crypto = require('crypto');

class MonnifyDeposit {
  constructor() {
    this.apiKey = process.env.MONNIFY_API_KEY;
    this.secretKey = process.env.MONNIFY_SECRET_KEY;
    this.contractCode = process.env.MONNIFY_CONTRACT_CODE;
    this.baseUrl = process.env.MONNIFY_BASE_URL || 'https://api.monnify.com';
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  // Generate Monnify authentication token
  async authenticate() {
    try {
      console.log('🔐 Authenticating with Monnify...');
      
      const authString = Buffer.from(`${this.apiKey}:${this.secretKey}`).toString('base64');
      
      const response = await axios.post(
        `${this.baseUrl}/api/v1/auth/login`,
        {},
        {
          headers: {
            'Authorization': `Basic ${authString}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (response.data.responseCode === '0' && response.data.responseBody) {
        this.accessToken = response.data.responseBody.accessToken;
        this.tokenExpiry = Date.now() + (response.data.responseBody.expiresIn * 1000);
        console.log('✅ Monnify authentication successful');
        return true;
      }
      
      throw new Error('Monnify authentication failed');
    } catch (error) {
      console.error('❌ Monnify authentication error:', error.response?.data || error.message);
      return false;
    }
  }

  // Check if token is valid
  isTokenValid() {
    return this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry;
  }

  // Ensure we have a valid token
  async ensureAuthenticated() {
    if (!this.isTokenValid()) {
      return await this.authenticate();
    }
    return true;
  }

  // Create virtual account for user
  async createVirtualAccount(userId, userName, userEmail, bvn = null) {
    try {
      console.log(`🏦 Creating Monnify virtual account for user: ${userId}`);
      
      const isAuthenticated = await this.ensureAuthenticated();
      if (!isAuthenticated) {
        throw new Error('Failed to authenticate with Monnify');
      }

      // Generate unique account reference
      const accountReference = `LWB${Date.now()}${userId}`.substring(0, 100);
      const accountName = `${userName} - Liteway VTU`;
      
      const requestBody = {
        accountReference: accountReference,
        accountName: accountName,
        currencyCode: 'NGN',
        contractCode: this.contractCode,
        customerEmail: userEmail,
        customerName: userName,
        getAllAvailableBanks: false,
        preferredBanks: ["035"]  // WEMA Bank for Monnify
      };

      // Add BVN if provided
      if (bvn && /^\d{11}$/.test(bvn)) {
        requestBody.bvn = bvn;
      }

      const response = await axios.post(
        `${this.baseUrl}/api/v2/bank-transfer/reserved-accounts`,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.requestSuccessful && response.data.responseBody) {
        const accountDetails = response.data.responseBody;
        
        console.log('✅ Virtual account created successfully:', {
          userId,
          accountReference,
          accountNumber: accountDetails.accountNumber,
          accountName: accountDetails.accountName
        });

        return {
          success: true,
          accountReference: accountDetails.accountReference,
          accountNumber: accountDetails.accountNumber,
          accountName: accountDetails.accountName,
          bankName: accountDetails.bankName || 'WEMA BANK',
          bankCode: accountDetails.bankCode || '035',
          collectionChannel: 'RESERVED_ACCOUNT',
          reservationReference: accountDetails.reservationReference,
          status: 'ACTIVE',
          createdOn: accountDetails.createdOn || new Date().toISOString(),
          contractCode: this.contractCode
        };
      }

      throw new Error('Failed to create virtual account');
    } catch (error) {
      console.error('❌ Virtual account creation error:', {
        userId,
        error: error.response?.data || error.message
      });
      
      return {
        success: false,
        error: error.response?.data?.responseMessage || error.message || 'Failed to create account'
      };
    }
  }

  // Get virtual account details
  async getVirtualAccount(accountReference) {
    try {
      console.log(`🔍 Getting Monnify account details: ${accountReference}`);
      
      const isAuthenticated = await this.ensureAuthenticated();
      if (!isAuthenticated) {
        throw new Error('Failed to authenticate with Monnify');
      }

      const response = await axios.get(
        `${this.baseUrl}/api/v2/bank-transfer/reserved-accounts/${accountReference}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.requestSuccessful && response.data.responseBody) {
        return {
          success: true,
          account: response.data.responseBody
        };
      }

      throw new Error('Account not found');
    } catch (error) {
      console.error('❌ Get account error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.responseMessage || error.message || 'Account not found'
      };
    }
  }

  // Deactivate virtual account
  async deactivateVirtualAccount(accountReference) {
    try {
      console.log(`🛑 Deactivating Monnify account: ${accountReference}`);
      
      const isAuthenticated = await this.ensureAuthenticated();
      if (!isAuthenticated) {
        throw new Error('Failed to authenticate with Monnify');
      }

      const response = await axios.delete(
        `${this.baseUrl}/api/v2/bank-transfer/reserved-accounts/${accountReference}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.requestSuccessful) {
        console.log('✅ Account deactivated successfully');
        return { success: true };
      }

      throw new Error('Failed to deactivate account');
    } catch (error) {
      console.error('❌ Account deactivation error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.responseMessage || error.message || 'Failed to deactivate'
      };
    }
  }

  // Get account transactions
  async getAccountTransactions(accountReference, page = 0, size = 10) {
    try {
      console.log(`📜 Getting transactions for account: ${accountReference}`);
      
      const isAuthenticated = await this.ensureAuthenticated();
      if (!isAuthenticated) {
        throw new Error('Failed to authenticate with Monnify');
      }

      const response = await axios.get(
        `${this.baseUrl}/api/v2/bank-transfer/reserved-accounts/transactions`,
        {
          params: {
            accountReference: accountReference,
            page: page,
            size: size
          },
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.requestSuccessful && response.data.responseBody) {
        return {
          success: true,
          transactions: response.data.responseBody.content || [],
          totalElements: response.data.responseBody.totalElements || 0,
          totalPages: response.data.responseBody.totalPages || 0
        };
      }

      throw new Error('No transactions found');
    } catch (error) {
      console.error('❌ Get transactions error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.responseMessage || error.message || 'No transactions found',
        transactions: []
      };
    }
  }

  // Verify transaction webhook (for Monnify webhook integration)
  verifyWebhookSignature(payload, signature) {
    try {
      const computedSignature = crypto
        .createHmac('sha512', this.secretKey)
        .update(JSON.stringify(payload))
        .digest('hex');
      
      return computedSignature === signature;
    } catch (error) {
      console.error('❌ Webhook verification error:', error.message);
      return false;
    }
  }

  // Process Monnify webhook (to be called from your webhook endpoint)
  processPaymentWebhook(payload) {
    try {
      console.log('🔄 Processing Monnify payment webhook');
      
      if (payload.eventType === 'SUCCESSFUL_TRANSACTION') {
        const transaction = payload.eventData;
        
        return {
          success: true,
          type: 'DEPOSIT',
          status: 'SUCCESS',
          amount: transaction.amount,
          currency: transaction.currency,
          transactionReference: transaction.transactionReference,
          paymentReference: transaction.paymentReference,
          paidOn: transaction.paidOn,
          accountNumber: transaction.accountNumber,
          accountName: transaction.accountName,
          customerEmail: transaction.customerEmail,
          customerName: transaction.customerName,
          settlementAmount: transaction.settlementAmount,
          metadata: transaction.metaData || {}
        };
      }
      
      return {
        success: false,
        type: payload.eventType,
        status: 'UNKNOWN_EVENT'
      };
    } catch (error) {
      console.error('❌ Webhook processing error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Generate deposit instructions for user
  generateDepositInstructions(accountDetails) {
    return {
      title: "💰 DEPOSIT VIA MONNIFY VIRTUAL ACCOUNT",
      instructions: [
        `🏦 **Bank Name:** ${accountDetails.bankName || 'WEMA BANK'}`,
        `🔢 **Account Number:** \`${accountDetails.accountNumber}\``,
        `📛 **Account Name:** ${accountDetails.accountName}`,
        `💳 **Account Type:** Savings`,
        ``,
        `📝 **How to Deposit:**`,
        `1. Open your bank app or visit any bank branch`,
        `2. Transfer to the account details above`,
        `3. Use your User ID as narration`,
        `4. Funds reflect in 1-5 minutes`,
        ``,
        `⚠️ **Important Notes:**`,
        `• Only transfer from Nigerian bank accounts`,
        `• Minimum deposit: ₦100`,
        `• Maximum deposit: ₦1,000,000 per transaction`,
        `• No deposit charges from our side`,
        `• Contact support if funds don't reflect within 10 minutes`
      ].join('\n'),
      quickActions: [
        {
          text: "📱 Copy Account Number",
          data: accountDetails.accountNumber
        },
        {
          text: "🏦 Copy Bank Name", 
          data: accountDetails.bankName || 'WEMA BANK'
        },
        {
          text: "📛 Copy Account Name",
          data: accountDetails.accountName
        }
      ]
    };
  }

  // Format currency
  formatCurrency(amount) {
    return `₦${parseFloat(amount).toLocaleString('en-NG')}`;
  }
}

module.exports = MonnifyDeposit;