const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const Transaction = require('../models/Transaction');

// Generate unique transaction ID
const generateTransactionId = () => {
    return `KISH-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
};

// Generate unique message ID
const generateMessageId = () => {
    return `MSG-${Date.now()}-${uuidv4()}`;
};

// Initiate STK Push
exports.initiateSTKPush = async (req, res) => {
    try {
        const { phone, amount } = req.body;
        
        // Generate transaction ID
        const transactionId = generateTransactionId();
        const invoiceNumber = `INV-${Date.now()}`;
        const messageId = generateMessageId();
        
        // Save transaction as pending
        const transaction = new Transaction({
            phone,
            amount,
            transactionId,
            status: 'PENDING'
        });
        
        await transaction.save();
        
        // Prepare STK Push request
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
        
        console.log('Sending STK Push request:', stkPushData);
        
        // Send STK Push to M-Pesa API
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
                timeout: 30000 // 30 seconds timeout
            }
        );
        
        console.log('STK Push response:', response.data);
        
        // Update transaction with merchant and checkout request IDs
        if (response.data && response.data.MerchantRequestID) {
            transaction.merchantRequestId = response.data.MerchantRequestID;
            transaction.checkoutRequestId = response.data.CheckoutRequestID;
            await transaction.save();
        }
        
        res.status(200).json({
            success: true,
            message: 'STK Push sent successfully',
            transactionId: transaction.transactionId,
            checkoutRequestId: response.data?.CheckoutRequestID,
            merchantRequestId: response.data?.MerchantRequestID
        });
        
    } catch (error) {
        console.error('STK Push error:', error.response?.data || error.message);
        
        // Update transaction status to failed if we have it
        if (transaction) {
            transaction.status = 'FAILED';
            transaction.resultDesc = error.response?.data?.errorMessage || error.message;
            await transaction.save();
        }
        
        res.status(500).json({
            success: false,
            message: 'Failed to initiate STK Push',
            error: error.response?.data || error.message
        });
    }
};

// Handle M-Pesa Callback
exports.handleCallback = async (req, res) => {
    try {
        console.log('Received callback:', JSON.stringify(req.body, null, 2));
        
        const callbackData = req.body;
        
        // Extract necessary data from callback
        const checkoutRequestID = callbackData?.Body?.stkCallback?.CheckoutRequestID;
        const merchantRequestID = callbackData?.Body?.stkCallback?.MerchantRequestID;
        const resultCode = callbackData?.Body?.stkCallback?.ResultCode;
        const resultDesc = callbackData?.Body?.stkCallback?.ResultDesc;
        const callbackMetadata = callbackData?.Body?.stkCallback?.CallbackMetadata;
        
        // Find transaction by checkout request ID or merchant request ID
        let transaction = await Transaction.findOne({
            $or: [
                { checkoutRequestId: checkoutRequestID },
                { merchantRequestId: merchantRequestID }
            ]
        });
        
        if (!transaction) {
            console.error('Transaction not found for callback:', { checkoutRequestID, merchantRequestID });
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }
        
        // Update transaction based on result code
        if (resultCode === 0) {
            // Success
            let mpesaReceiptNumber = null;
            let amount = null;
            
            if (callbackMetadata && callbackMetadata.Item) {
                callbackMetadata.Item.forEach(item => {
                    if (item.Name === 'MpesaReceiptNumber') {
                        mpesaReceiptNumber = item.Value;
                    }
                    if (item.Name === 'Amount') {
                        amount = item.Value;
                    }
                });
            }
            
            transaction.status = 'SUCCESS';
            transaction.mpesaReceiptNumber = mpesaReceiptNumber;
            transaction.resultCode = resultCode;
            transaction.resultDesc = resultDesc;
            
            // Verify amount matches
            if (amount && amount !== transaction.amount) {
                console.warn(`Amount mismatch: Expected ${transaction.amount}, Got ${amount}`);
            }
        } else {
            // Failed
            transaction.status = 'FAILED';
            transaction.resultCode = resultCode;
            transaction.resultDesc = resultDesc;
        }
        
        await transaction.save();
        
        console.log(`Transaction ${transaction.transactionId} updated to ${transaction.status}`);
        
        // Respond to M-Pesa with success
        res.status(200).json({
            success: true,
            message: 'Callback processed successfully'
        });
        
    } catch (error) {
        console.error('Callback processing error:', error);
        
        // Still return 200 to M-Pesa to prevent retries
        res.status(200).json({
            success: false,
            message: 'Error processing callback'
        });
    }
};

// Get transaction status
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
                mpesaReceiptNumber: transaction.mpesaReceiptNumber
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

// Get all transactions (with pagination)
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
