// models/Transaction.js
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['airtime', 'data', 'deposit', 'credit', 'transfer', 'bank_transfer', 'withdrawal', 'fee'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  network: String,
  plan: String,
  phone: String,
  recipientAccount: String,
  recipientName: String,
  recipientBank: String,
  fee: {
    type: Number,
    default: 0
  },
  totalAmount: Number,
  status: {
    type: String,
    enum: ['pending', 'success', 'failed', 'processing'],
    default: 'pending'
  },
  reference: {
    type: String,
    unique: true,
    index: true
  },
  apiReference: String,
  apiResponse: mongoose.Schema.Types.Mixed,
  reason: String,
  source: String,
  paymentMethod: String,
  payerName: String,
  payerEmail: String,
  description: String,
  admin: String,
  metadata: mongoose.Schema.Types.Mixed,
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Compound indexes for common queries
transactionSchema.index({ userId: 1, timestamp: -1 });
transactionSchema.index({ status: 1, timestamp: -1 });
transactionSchema.index({ type: 1, timestamp: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);