const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const paymentController = require('../controllers/paymentController');

// Validation middleware
const validatePayment = [
    body('phone')
        .trim()
        .matches(/^254[0-9]{9}$/)
        .withMessage('Phone number must be in format 2547XXXXXXXX'),
    body('amount')
        .isInt({ min: 1, max: 150000 })
        .withMessage('Amount must be between 1 and 150,000 KES'),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }
        next();
    }
];

// Initiate STK Push
router.post('/stkpush', validatePayment, paymentController.initiateSTKPush);

// M-Pesa Callback URL
router.post('/callback', paymentController.handleCallback);

// Get transaction status
router.get('/status/:transactionId', paymentController.getTransactionStatus);

// Get all transactions (with filters)
router.get('/transactions', paymentController.getAllTransactions);

module.exports = router;
