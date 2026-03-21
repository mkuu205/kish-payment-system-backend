const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const Transaction = require('../models/Transaction');

// Generate unique transaction ID
const generateTransactionId = () => {
    return `KISH-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
};

// Generate message ID
const generateMessageId = () => {
    return `MSG-${Date.now()}-${uuidv4().substr(0, 8)}`;
};

// POST /api/payment/stkpush
exports.initiateSTKPush = async (req, res) => {
    try {
        const { phone, amount } = req.body;
        
        console.log(`📱 Initiating payment for ${phone} - KES ${amount}`);
        
        // Generate transaction ID
        const transactionId = generateTransactionId();
        const invoiceNumber = `INV-${Date.now()}`;
        const messageId = generateMessageId();
        
        // Save transaction
        const transaction = new Transaction({
            phone,
            amount,
            transactionId,
            status: 'PENDING'
        });
        await transaction.save();
        
        console.log(`✅ Transaction saved: ${transactionId}`);
        
        // Prepare STK Push data
        const stkData = {
            phoneNumber: phone,
            amount: amount.toString(),
            invoiceNumber: invoiceNumber,
            sharedShortCode: true,
            orgShortCode: process.env.SHORTCODE,
            orgPassKey: process.env.PASSKEY,
            callbackUrl: process.env.CALLBACK_URL,
            transactionDescription: "Kish Payment"
        };
        
        console.log('📤 Sending to M-Pesa...');
        
        // Send to M-Pesa API
        const response = await axios.post(
            'https://uat.buni.kcbgroup.com/mm/api/request/1.0.0/stkpush',
            stkData,
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
        
        // Update transaction with M-Pesa IDs
        if (response.data) {
            if (response.data.MerchantRequestID) {
                transaction.merchantRequestId = response.data.MerchantRequestID;
            }
            if (response.data.CheckoutRequestID) {
                transaction.checkoutRequestId = response.data.CheckoutRequestID;
            }
            await transaction.save();
        }
        
        res.json({
            success: true,
            message: 'STK Push sent successfully',
            transactionId: transaction.transactionId
        });
        
    } catch (error) {
        console.error('❌ STK Push Error:', error.response?.data || error.message);
        
        res.status(500).json({
            success: false,
            message: error.response?.data?.errorMessage || 'Failed to initiate payment'
        });
    }
};

// POST /api/payment/callback
exports.handleCallback = async (req, res) => {
    try {
        console.log('📞 Callback received:', JSON.stringify(req.body, null, 2));
        
        const callbackData = req.body;
        const stkCallback = callbackData?.Body?.stkCallback;
        
        if (!stkCallback) {
            console.log('Invalid callback structure');
            return res.status(200).json({ success: false });
        }
        
        const checkoutRequestID = stkCallback.CheckoutRequestID;
        const resultCode = stkCallback.ResultCode;
        const resultDesc = stkCallback.ResultDesc;
        
        // Find transaction
        const transaction = await Transaction.findOne({ checkoutRequestId: checkoutRequestID });
        
        if (!transaction) {
            console.log('Transaction not found:', checkoutRequestID);
            return res.status(200).json({ success: false });
        }
        
        // Update status
        if (resultCode === 0) {
            transaction.status = 'SUCCESS';
            
            // Get M-Pesa receipt number
            const metadata = stkCallback.CallbackMetadata;
            if (metadata && metadata.Item) {
                const receiptItem = metadata.Item.find(item => item.Name === 'MpesaReceiptNumber');
                if (receiptItem) {
                    transaction.mpesaReceiptNumber = receiptItem.Value;
                }
            }
            console.log(`✅ Payment successful: ${transaction.transactionId}`);
        } else {
            transaction.status = 'FAILED';
            transaction.resultDesc = resultDesc;
            console.log(`❌ Payment failed: ${transaction.transactionId} - ${resultDesc}`);
        }
        
        transaction.resultCode = resultCode;
        await transaction.save();
        
        res.status(200).json({ success: true });
        
    } catch (error) {
        console.error('Callback error:', error);
        res.status(200).json({ success: false });
    }
};

// GET /api/payment/status/:transactionId
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
        
        res.json({
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
        console.error('Status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get status'
        });
    }
};

// GET /api/payment/transactions
exports.getAllTransactions = async (req, res) => {
    try {
        const transactions = await Transaction.find()
            .sort({ createdAt: -1 })
            .limit(50);
        
        res.json({
            success: true,
            data: transactions
        });
        
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get transactions'
        });
    }
};
