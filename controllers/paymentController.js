const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const Transaction = require('../models/Transaction');

/**
 * Generate unique transaction ID
 * Format: KISH-{timestamp}-{random}
 */
const generateTransactionId = () => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 6).toUpperCase();
    return `KISH-${timestamp}-${random}`;
};

/**
 * Generate unique message ID for M-Pesa request
 */
const generateMessageId = () => {
    return `MSG-${Date.now()}-${uuidv4().substr(0, 8)}`;
};

/**
 * POST /api/payment/stkpush
 * Initiate STK Push payment
 */
exports.initiateSTKPush = async (req, res) => {
    try {
        const { phone, amount } = req.body;
        
        console.log(`📱 Initiating STK Push for ${phone} amount ${amount}`);
        
        // Generate unique transaction ID
        const transactionId = generateTransactionId();
        const invoiceNumber = `INV-${Date.now()}`;
        const messageId = generateMessageId();
        
        // Create pending transaction in database
        const transaction = new Transaction({
            phone,
            amount,
            transactionId,
            status: 'PENDING'
        });
        
        await transaction.save();
        console.log(`✅ Transaction saved: ${transactionId}`);
        
        // Prepare STK Push request payload
        const stkPushData = {
            phoneNumber: phone,
            amount: amount.toString(),
            invoiceNumber: invoiceNumber,
            sharedShortCode: true,
            orgShortCode: process.env.SHORTCODE,
            orgPassKey: process.env.PASSKEY,
            callbackUrl: process.env.CALLBACK_URL,
            transactionDescription: "Kish Payment"
        };
        
        console.log('📤 Sending STK Push to M-Pesa...');
        
        // Send STK Push to M-Pesa API (KCB Buni API)
        const response = await axios.post(
            'https://uat.buni.kcbgroup.com/mm/api/request/1.0.0/stkpush',
            stkPushData,
            {
                headers: {
                    'routeCode': '207',
                    'operation': 'STKPush',
                    'messageId': messageId,
                    'apikey': process.env.API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );
        
        console.log('📥 M-Pesa Response:', response.data);
        
        // Update transaction with M-Pesa request IDs
        if (response.data) {
            if (response.data.MerchantRequestID) {
                transaction.merchantRequestId = response.data.MerchantRequestID;
            }
            if (response.data.CheckoutRequestID) {
                transaction.checkoutRequestId = response.data.CheckoutRequestID;
            }
            await transaction.save();
        }
        
        // Return success response
        res.status(200).json({
            success: true,
            message: 'STK Push sent successfully',
            transactionId: transaction.transactionId,
            checkoutRequestId: response.data?.CheckoutRequestID,
            merchantRequestId: response.data?.MerchantRequestID
        });
        
    } catch (error) {
        console.error('❌ STK Push Error:', error.response?.data || error.message);
        
        res.status(500).json({
            success: false,
            message: 'Failed to initiate payment',
            error: error.response?.data?.errorMessage || error.message
        });
    }
};

/**
 * POST /api/payment/callback
 * Handle M-Pesa callback response
 */
exports.handleCallback = async (req, res) => {
    try {
        console.log('📞 Received M-Pesa Callback:', JSON.stringify(req.body, null, 2));
        
        const callbackData = req.body;
        
        // Extract callback data
        const stkCallback = callbackData?.Body?.stkCallback;
        if (!stkCallback) {
            console.error('Invalid callback structure');
            return res.status(200).json({ success: false, message: 'Invalid callback' });
        }
        
        const checkoutRequestID = stkCallback.CheckoutRequestID;
        const merchantRequestID = stkCallback.MerchantRequestID;
        const resultCode = stkCallback.ResultCode;
        const resultDesc = stkCallback.ResultDesc;
        const callbackMetadata = stkCallback.CallbackMetadata;
        
        console.log(`Processing callback for CheckoutID: ${checkoutRequestID}, ResultCode: ${resultCode}`);
        
        // Find transaction by checkout request ID
        let transaction = await Transaction.findOne({
            $or: [
                { checkoutRequestId: checkoutRequestID },
                { merchantRequestId: merchantRequestID }
            ]
        });
        
        if (!transaction) {
            console.error('Transaction not found for callback:', { checkoutRequestID, merchantRequestID });
            return res.status(200).json({ 
                success: false, 
                message: 'Transaction not found' 
            });
        }
        
        // Update transaction based on result code
        if (resultCode === 0) {
            // Success
            transaction.status = 'SUCCESS';
            transaction.resultCode = resultCode;
            transaction.resultDesc = resultDesc;
            
            // Extract M-Pesa receipt number
            if (callbackMetadata && callbackMetadata.Item) {
                const receiptItem = callbackMetadata.Item.find(item => item.Name === 'MpesaReceiptNumber');
                if (receiptItem) {
                    transaction.mpesaReceiptNumber = receiptItem.Value;
                }
                
                // Verify amount matches
                const amountItem = callbackMetadata.Item.find(item => item.Name === 'Amount');
                if (amountItem && amountItem.Value !== transaction.amount) {
                    console.warn(`⚠️ Amount mismatch: Expected ${transaction.amount}, Got ${amountItem.Value}`);
                }
            }
            
            console.log(`✅ Payment successful: ${transaction.transactionId}`);
        } else {
            // Failed
            transaction.status = 'FAILED';
            transaction.resultCode = resultCode;
            transaction.resultDesc = resultDesc;
            console.log(`❌ Payment failed: ${transaction.transactionId} - ${resultDesc}`);
        }
        
        await transaction.save();
        console.log(`💾 Transaction updated: ${transaction.transactionId} -> ${transaction.status}`);
        
        // Always return 200 to M-Pesa to prevent retries
        res.status(200).json({
            success: true,
            message: 'Callback processed successfully'
        });
        
    } catch (error) {
        console.error('❌ Callback processing error:', error);
        
        // Still return 200 to M-Pesa
        res.status(200).json({
            success: false,
            message: 'Error processing callback'
        });
    }
};

/**
 * GET /api/payment/status/:transactionId
 * Get payment status
 */
exports.getTransactionStatus = async (req, res) => {
    try {
        const { transactionId } = req.params;
        
        const transaction = await Transaction.findOne({ transactionId });
        
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }
        
        res.status(200).json({
            success: true,
            status: transaction.status,
            transaction: {
                transactionId: transaction.transactionId,
                phone: transaction.phone,
                amount: transaction.amount,
                status: transaction.status,
                createdAt: transaction.createdAt,
                mpesaReceiptNumber: transaction.mpesaReceiptNumber,
                resultDesc: transaction.resultDesc
            }
        });
        
    } catch (error) {
        console.error('Get status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch transaction status'
        });
    }
};

/**
 * GET /api/payment/transactions
 * Get all transactions (public - limited to last 50)
 */
exports.getAllTransactions = async (req, res) => {
    try {
        const { page = 1, limit = 20, status } = req.query;
        
        const filter = {};
        if (status) filter.status = status;
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const [transactions, total] = await Promise.all([
            Transaction.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Transaction.countDocuments(filter)
        ]);
        
        res.status(200).json({
            success: true,
            data: transactions,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
        
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch transactions'
        });
    }
};
