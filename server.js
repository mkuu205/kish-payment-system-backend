const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory storage for transactions (use Redis/DB in production)
const transactions = new Map();
const pendingCallbacks = new Map();

// Generate unique transaction ID
function generateTransactionId() {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `KISH-${timestamp}-${random}`;
}

// Generate unique message ID for API request
function generateMessageId() {
    return crypto.randomBytes(16).toString('hex').toUpperCase();
}

// Logging utility
function log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`, data);
}

// Validate phone number
function validatePhone(phone) {
    // Remove any non-digit characters
    phone = phone.replace(/\D/g, '');
    
    // Ensure it's in 2547XXXXXXXX format
    if (!phone.startsWith('254')) {
        phone = '254' + phone;
    }
    
    // Check if it's a valid Safaricom number (starts with 2547 and has 12 digits)
    return /^2547[0-9]{8}$/.test(phone);
}

// Validate amount
function validateAmount(amount) {
    const num = parseFloat(amount);
    return !isNaN(num) && num >= 10 && num <= 150000;
}

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'Kish Payment System',
        timestamp: new Date().toISOString()
    });
});

// STK Push endpoint
app.post('/stkpush', async (req, res) => {
    try {
        const { phone, amount } = req.body;
        
        log('info', 'Received STK push request', { phone, amount });
        
        // Validate inputs
        if (!phone || !amount) {
            return res.status(400).json({
                error: 'Phone and amount are required'
            });
        }
        
        // Format and validate phone
        let formattedPhone = phone.replace(/\D/g, '');
        if (!formattedPhone.startsWith('254')) {
            formattedPhone = '254' + formattedPhone;
        }
        
        if (!validatePhone(formattedPhone)) {
            return res.status(400).json({
                error: 'Invalid phone number. Must be a valid Safaricom number (e.g., 2547XXXXXXXX)'
            });
        }
        
        // Validate amount
        if (!validateAmount(amount)) {
            return res.status(400).json({
                error: 'Invalid amount. Must be between KES 10 and KES 150,000'
            });
        }
        
        // Generate transaction ID
        const transactionId = generateTransactionId();
        const messageId = generateMessageId();
        
        // Prepare STK push request
        const stkRequest = {
            phoneNumber: formattedPhone,
            amount: amount.toString(),
            invoiceNumber: transactionId,
            sharedShortCode: true,
            orgShortCode: process.env.SHORTCODE,
            orgPassKey: process.env.PASSKEY,
            callbackUrl: `${process.env.CALLBACK_URL}/callback`,
            transactionDescription: 'Kish Payment'
        };
        
        log('info', 'Sending STK push to M-Pesa', { 
            transactionId, 
            phone: formattedPhone,
            amount 
        });
        
        // Send request to M-Pesa API
        const response = await axios.post(
            'https://uat.buni.kcbgroup.com/mm/api/request/1.0.0/stkpush',
            stkRequest,
            {
                headers: {
                    'routeCode': '207',
                    'operation': 'STKPush',
                    'messageId': messageId,
                    'apikey': process.env.API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        log('info', 'STK push response received', response.data);
        
        // Store transaction
        const transaction = {
            transactionId,
            phone: formattedPhone,
            amount: parseFloat(amount),
            status: 'pending',
            timestamp: new Date().toISOString(),
            mpesaResponse: response.data
        };
        
        transactions.set(transactionId, transaction);
        
        // Store for callback matching
        pendingCallbacks.set(messageId, transactionId);
        
        // Return success with transaction ID for polling
        res.json({
            success: true,
            message: 'STK push sent successfully',
            transactionId,
            messageId
        });
        
    } catch (error) {
        log('error', 'STK push failed', { 
            error: error.message,
            response: error.response?.data 
        });
        
        res.status(500).json({
            error: 'Failed to initiate STK push',
            details: error.response?.data || error.message
        });
    }
});

// Callback endpoint for M-Pesa
app.post('/callback', (req, res) => {
    try {
        const callbackData = req.body;
        
        log('info', 'Received M-Pesa callback', callbackData);
        
        // Parse callback data (structure depends on M-Pesa API)
        // This is a simplified example - adjust based on actual API response
        const {
            messageId,
            transactionId,
            status,
            mpesaReceiptNumber,
            amount,
            phoneNumber,
            transactionDate
        } = callbackData;
        
        // Find the original transaction
        let originalTransactionId;
        
        if (messageId && pendingCallbacks.has(messageId)) {
            originalTransactionId = pendingCallbacks.get(messageId);
            pendingCallbacks.delete(messageId);
        } else if (transactionId && transactions.has(transactionId)) {
            originalTransactionId = transactionId;
        } else {
            log('warn', 'Callback received for unknown transaction', callbackData);
            return res.status(200).json({ received: true }); // Always acknowledge
        }
        
        // Update transaction
        const transaction = transactions.get(originalTransactionId);
        
        if (transaction) {
            transaction.status = status === 'success' ? 'completed' : 'failed';
            transaction.mpesaReceipt = mpesaReceiptNumber;
            transaction.callbackData = callbackData;
            transaction.updatedAt = new Date().toISOString();
            
            transactions.set(originalTransactionId, transaction);
            
            log('info', 'Transaction updated via callback', {
                transactionId: originalTransactionId,
                status: transaction.status
            });
        }
        
        // Always acknowledge receipt
        res.status(200).json({ 
            received: true,
            message: 'Callback processed successfully'
        });
        
    } catch (error) {
        log('error', 'Error processing callback', { error: error.message });
        res.status(200).json({ received: true }); // Always acknowledge
    }
});

// Get transaction status
app.get('/status/:transactionId', (req, res) => {
    try {
        const { transactionId } = req.params;
        
        log('info', 'Status check', { transactionId });
        
        const transaction = transactions.get(transactionId);
        
        if (!transaction) {
            return res.status(404).json({
                error: 'Transaction not found'
            });
        }
        
        res.json({
            status: transaction.status,
            transaction
        });
        
    } catch (error) {
        log('error', 'Error checking status', { error: error.message });
        res.status(500).json({
            error: 'Failed to check transaction status'
        });
    }
});

// Get all transactions (for debugging)
app.get('/transactions', (req, res) => {
    const transactionList = Array.from(transactions.values());
    res.json({
        count: transactionList.length,
        transactions: transactionList
    });
});

// Clear old transactions (cleanup)
app.post('/cleanup', (req, res) => {
    const now = new Date();
    let removed = 0;
    
    for (const [id, transaction] of transactions) {
        const transactionDate = new Date(transaction.timestamp);
        const hoursDiff = (now - transactionDate) / (1000 * 60 * 60);
        
        // Remove transactions older than 24 hours
        if (hoursDiff > 24) {
            transactions.delete(id);
            removed++;
        }
    }
    
    log('info', 'Cleanup completed', { removed });
    
    res.json({
        message: 'Cleanup completed',
        removed
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    log('error', 'Unhandled error', { error: err.message });
    res.status(500).json({
        error: 'Internal server error'
    });
});

// Start server
app.listen(PORT, () => {
    log('info', `Kish Payment System running on port ${PORT}`);
    log('info', `Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
