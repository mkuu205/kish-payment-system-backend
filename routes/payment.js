const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// All routes are mounted at /api/payment
router.post('/stkpush', paymentController.initiateSTKPush);
router.post('/callback', paymentController.handleCallback);
router.get('/status/:transactionId', paymentController.getTransactionStatus);
router.get('/transactions', paymentController.getAllTransactions);

module.exports = router;
