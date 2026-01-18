// models/VirtualAccount.js
const mongoose = require('mongoose');

const virtualAccountSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  accountReference: {
    type: String,
    required: true,
    unique: true
  },
  accountNumber: {
    type: String,
    required: true,
    unique: true
  },
  accountName: {
    type: String,
    required: true
  },
  bankName: String,
  bankCode: String,
  customerEmail: String,
  customerName: String,
  bvn: String,
  active: {
    type: Boolean,
    default: true
  },
  balance: {
    type: Number,
    default: 0
  },
  lastTransaction: Date,
  transactions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

virtualAccountSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('VirtualAccount', virtualAccountSchema);