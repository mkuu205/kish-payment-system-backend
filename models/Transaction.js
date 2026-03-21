const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    phone: {
        type: String,
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    transactionId: {
        type: String,
        required: true,
        unique: true
    },
    merchantRequestId: String,
    checkoutRequestId: String,
    status: {
        type: String,
        enum: ['PENDING', 'SUCCESS', 'FAILED'],
        default: 'PENDING'
    },
    mpesaReceiptNumber: String,
    resultDesc: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Transaction', transactionSchema);
