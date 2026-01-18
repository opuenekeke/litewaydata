// models/Session.js
const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  action: {
    type: String,
    required: true
  },
  step: {
    type: Number,
    default: 1
  },
  network: String,
  validityType: String,
  planId: String,
  selectedPlan: mongoose.Schema.Types.Mixed,
  amount: Number,
  phone: String,
  bankCode: String,
  bankName: String,
  accountNumber: String,
  accountName: String,
  fee: Number,
  totalAmount: Number,
  data: mongoose.Schema.Types.Mixed,
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
    index: { expires: 0 } // TTL index
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Session', sessionSchema);