// cash/transfer.js - Bank Transfer to Nigerian Banks
const axios = require('axios');
const crypto = require('crypto');

class BankTransfer {
  constructor() {
    this.apiKey = process.env.BANK_TRANSFER_API_KEY;
    this.secretKey = process.env.BANK_TRANSFER_SECRET_KEY;
    this.baseUrl = process.env.BANK_TRANSFER_BASE_URL || 'https://api.paystack.co';
    this.transferFeePercentage = parseFloat(process.env.BANK_TRANSFER_FEE_PERCENTAGE) || 1.5;
    this.minimumTransfer = parseFloat(process.env.MINIMUM_TRANSFER_AMOUNT) || 100;
    this.maximumTransfer = parseFloat(process.env.MAXIMUM_TRANSFER_AMOUNT) || 1000000;
  }

  // Initialize transfer (using Paystack as example)
  async initializeTransfer(amount, recipientBankCode, recipientAccountNumber, recipientName, narration, userId) {
    try {
      console.log(`💰 Initializing bank transfer for user: ${userId}`);
      
      // First, verify recipient account
      const verification = await this.verifyAccount(recipientBankCode, recipientAccountNumber);
      
      if (!verification.success) {
        return {
          success: false,
          error: 'Account verification failed: ' + verification.error
        };
      }

      // Check if name matches (basic check)
      const providedName = recipientName.toLowerCase().trim();
      const verifiedName = verification.accountName.toLowerCase().trim();
      
      if (!providedName.includes(verifiedName.substring(0, 5)) && 
          !verifiedName.includes(providedName.substring(0, 5))) {
        console.warn(`⚠️ Name mismatch: Provided: ${providedName}, Verified: ${verifiedName}`);
        // You can choose to proceed with warning or reject
        // For security, we'll reject
        return {
          success: false,
          error: 'Account name does not match. Please check account details.'
        };
      }

      // Calculate total amount with fee
      const fee = this.calculateTransferFee(amount);
      const totalAmount = amount + fee;

      // Create transfer recipient
      const recipientResponse = await axios.post(
        `${this.baseUrl}/transferrecipient`,
        {
          type: "nuban",
          name: recipientName,
          account_number: recipientAccountNumber,
          bank_code: recipientBankCode,
          currency: "NGN"
        },
        {
          headers: {
            'Authorization': `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!recipientResponse.data.status) {
        throw new Error('Failed to create transfer recipient');
      }

      const recipientCode = recipientResponse.data.data.recipient_code;

      // Initiate transfer
      const transferResponse = await axios.post(
        `${this.baseUrl}/transfer`,
        {
          source: "balance",
          amount: amount * 100, // Convert to kobo
          recipient: recipientCode,
          reason: narration || `Transfer from Liteway VTU - User: ${userId}`
        },
        {
          headers: {
            'Authorization': `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (transferResponse.data.status) {
        const transfer = transferResponse.data.data;
        
        console.log('✅ Transfer initialized successfully:', {
          userId,
          amount,
          recipient: recipientAccountNumber,
          reference: transfer.reference,
          status: transfer.status
        });

        return {
          success: true,
          transferId: transfer.id,
          reference: transfer.reference,
          amount: amount,
          fee: fee,
          totalAmount: totalAmount,
          recipient: {
            name: recipientName,
            accountNumber: recipientAccountNumber,
            bankCode: recipientBankCode
          },
          narration: narration,
          status: transfer.status,
          createdAt: transfer.createdAt,
          requiresOtp: transfer.requires_otp || false,
          transferNote: transfer.complete_message || 'Transfer queued for processing'
        };
      }

      throw new Error('Transfer initiation failed');
    } catch (error) {
      console.error('❌ Transfer initialization error:', {
        userId,
        error: error.response?.data || error.message
      });
      
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Transfer failed'
      };
    }
  }

  // Verify bank account
  async verifyAccount(bankCode, accountNumber) {
    try {
      console.log(`🔍 Verifying bank account: ${accountNumber}`);
      
      const response = await axios.get(
        `${this.baseUrl}/bank/resolve`,
        {
          params: {
            account_number: accountNumber,
            bank_code: bankCode
          },
          headers: {
            'Authorization': `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.status && response.data.data) {
        return {
          success: true,
          accountName: response.data.data.account_name,
          accountNumber: response.data.data.account_number,
          bankCode: bankCode
        };
      }

      throw new Error('Account verification failed');
    } catch (error) {
      console.error('❌ Account verification error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || 'Invalid account details'
      };
    }
  }

  // Get list of Nigerian banks
  async getBanks() {
    try {
      console.log('🏦 Getting list of Nigerian banks');
      
      const response = await axios.get(
        `${this.baseUrl}/bank`,
        {
          params: {
            country: 'nigeria',
            use_cursor: false,
            perPage: 100
          },
          headers: {
            'Authorization': `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.status && response.data.data) {
        // Sort banks by name and filter active ones
        const banks = response.data.data
          .filter(bank => bank.active)
          .sort((a, b) => a.name.localeCompare(b.name));
        
        console.log(`✅ Retrieved ${banks.length} banks`);
        return {
          success: true,
          banks: banks
        };
      }

      throw new Error('Failed to fetch banks');
    } catch (error) {
      console.error('❌ Get banks error:', error.response?.data || error.message);
      
      // Return default popular banks if API fails
      const defaultBanks = [
        { name: "Access Bank", code: "044", active: true },
        { name: "First Bank of Nigeria", code: "011", active: true },
        { name: "Guaranty Trust Bank", code: "058", active: true },
        { name: "United Bank for Africa", code: "033", active: true },
        { name: "Zenith Bank", code: "057", active: true },
        { name: "Fidelity Bank", code: "070", active: true },
        { name: "Union Bank of Nigeria", code: "032", active: true },
        { name: "Stanbic IBTC Bank", code: "221", active: true },
        { name: "Sterling Bank", code: "232", active: true },
        { name: "Wema Bank", code: "035", active: true },
        { name: "Polaris Bank", code: "076", active: true },
        { name: "Jaiz Bank", code: "301", active: true }
      ];
      
      return {
        success: true,
        banks: defaultBanks,
        note: 'Using default bank list'
      };
    }
  }

  // Check transfer status
  async checkTransferStatus(reference) {
    try {
      console.log(`🔍 Checking transfer status: ${reference}`);
      
      const response = await axios.get(
        `${this.baseUrl}/transfer/${reference}`,
        {
          headers: {
            'Authorization': `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.status && response.data.data) {
        const transfer = response.data.data;
        
        return {
          success: true,
          status: transfer.status,
          amount: transfer.amount / 100, // Convert from kobo
          recipient: transfer.recipient,
          reference: transfer.reference,
          reason: transfer.reason,
          createdAt: transfer.createdAt,
          updatedAt: transfer.updatedAt
        };
      }

      throw new Error('Transfer not found');
    } catch (error) {
      console.error('❌ Check transfer status error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || 'Transfer not found'
      };
    }
  }

  // Calculate transfer fee
  calculateTransferFee(amount) {
    const fee = (amount * this.transferFeePercentage) / 100;
    return Math.max(fee, 10); // Minimum fee of ₦10
  }

  // Validate transfer amount
  validateTransferAmount(amount) {
    if (isNaN(amount) || amount <= 0) {
      return { valid: false, error: 'Amount must be greater than 0' };
    }
    
    if (amount < this.minimumTransfer) {
      return { 
        valid: false, 
        error: `Minimum transfer amount is ${this.formatCurrency(this.minimumTransfer)}` 
      };
    }
    
    if (amount > this.maximumTransfer) {
      return { 
        valid: false, 
        error: `Maximum transfer amount is ${this.formatCurrency(this.maximumTransfer)}` 
      };
    }
    
    const fee = this.calculateTransferFee(amount);
    const total = amount + fee;
    
    return {
      valid: true,
      amount: amount,
      fee: fee,
      total: total,
      message: `Transfer fee: ${this.formatCurrency(fee)} (${this.transferFeePercentage}%)`
    };
  }

  // Generate transfer receipt
  generateTransferReceipt(transferDetails, userDetails) {
    const receipt = {
      title: "🏦 BANK TRANSFER RECEIPT",
      details: [
        `📅 **Date:** ${new Date().toLocaleString('en-NG')}`,
        `🔢 **Reference:** ${transferDetails.reference}`,
        `👤 **From:** ${userDetails.name} (${userDetails.userId})`,
        `💰 **Amount:** ${this.formatCurrency(transferDetails.amount)}`,
        `💸 **Fee:** ${this.formatCurrency(transferDetails.fee)}`,
        `💵 **Total Deducted:** ${this.formatCurrency(transferDetails.totalAmount)}`,
        `📛 **To:** ${transferDetails.recipient.name}`,
        `🔢 **Account:** ${transferDetails.recipient.accountNumber}`,
        `📝 **Narration:** ${transferDetails.narration || 'N/A'}`,
        `📊 **Status:** ${transferDetails.status.toUpperCase()}`,
        `⏰ **Initiated:** ${new Date(transferDetails.createdAt).toLocaleString('en-NG')}`
      ].join('\n'),
      footer: `💡 Funds typically arrive within 5-30 minutes. Contact support if delayed beyond 2 hours.`
    };
    
    return receipt;
  }

  // Format currency
  formatCurrency(amount) {
    return `₦${parseFloat(amount).toLocaleString('en-NG')}`;
  }

  // Escape Markdown
  escapeMarkdown(text) {
    if (typeof text !== 'string') return text;
    const specialChars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
    let escapedText = text;
    specialChars.forEach(char => {
      const regex = new RegExp(`\\${char}`, 'g');
      escapedText = escapedText.replace(regex, `\\${char}`);
    });
    return escapedText;
  }
}

module.exports = BankTransfer;