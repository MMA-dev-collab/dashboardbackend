/**
 * Receipt Verifier Service — n8n Webhook
 * 
 * Sends the receipt image as base64 to the n8n AI agent webhook,
 * which handles OCR/vision analysis and returns structured verification data.
 */

const fs = require('fs');
const path = require('path');
const env = require('../../config/env');
const { getSignedUrl } = require('../../config/cloudinary');

// Default instructions for the n8n AI agent
const DEFAULT_INSTRUCTIONS = 'Extract ONLY what is literally visible. sender_username = text before @instapay in From section (lowercase). receiver_username = text before @instapay in To section (lowercase). amount = the large number shown. Return ONLY JSON: {"sender_username": "", "receiver_username": "", "amount": 0}';

/**
 * Download a file from a URL and convert it to a base64 data-URL string.
 * @param {string} url - The Cloudinary URL
 * @param {string} mimeType - The MIME type
 */
async function fileToBase64DataUrl(url, mimeType) {
  const signedUrl = getSignedUrl(url);
  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64 = buffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Verify a receipt file against an expected withdrawal amount
 * by calling the n8n webhook.
 * 
 * @param {string} fileUrl        - Cloudinary URL to the uploaded file
 * @param {string} mimeType       - MIME type of the file (image/png, image/jpeg, etc.)
 * @param {number} expectedAmount - The withdrawal amount to verify against
 * @param {string} senderName     - Name of the person who sent the transfer (the approving admin)
 * @param {string} receiverName   - Name of the person receiving the payout (the requester)
 * @returns {Object} Verification result
 */
async function verifyReceipt(fileUrl, mimeType, expectedAmount, senderName, receiverName) {
  try {
    // Step 1: Convert image to base64 data URL
    const imageBase64 = await fileToBase64DataUrl(fileUrl, mimeType);

    // Step 2: Build payload matching the n8n webhook schema
    const payload = {
      image: imageBase64,
      image_type: 'base64',
      instructions: DEFAULT_INSTRUCTIONS,
      response_format: 'json',
      sender_name: senderName || '',
      receiver_name: receiverName || '',
      expected_amount: Number(expectedAmount) || 0,
    };

    // Step 3: Call the n8n webhook
    const webhookUrl = env.N8N_WEBHOOK_URL;
    console.log('[Receipt Verifier] Calling n8n webhook:', webhookUrl);
    console.log('[Receipt Verifier] Payload (without image):', {
      ...payload,
      image: payload.image.substring(0, 60) + '... (' + Math.round(payload.image.length / 1024) + 'KB)',
    });

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    console.log('[Receipt Verifier] n8n response status:', response.status, response.statusText);

    // Read raw text first — n8n may return HTML error pages
    const rawText = await response.text();
    console.log('[Receipt Verifier] n8n raw response:', rawText.substring(0, 500));

    let resData;
    try {
      resData = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('[Receipt Verifier] Failed to parse n8n response as JSON:', parseErr.message);
      return {
        extracted_amount: 0,
        transaction_id: null,
        transaction_type: 'unknown',
        amount_matches: false,
        confidence: 0,
        rejection_reason: `Receipt verification service returned an invalid response. The n8n workflow may be inactive or unreachable. (HTTP ${response.status})`,
      };
    }

    console.log('[Receipt Verifier] Parsed n8n response:', JSON.stringify(resData, null, 2));

    // Check for n8n-level errors
    if (!response.ok || resData.__error) {
      return {
        extracted_amount: 0,
        transaction_id: null,
        transaction_type: 'unknown',
        amount_matches: false,
        confidence: 0,
        rejection_reason: resData.error || resData.message || `Receipt analysis failed (status ${response.status}). Please try again or upload a clearer receipt.`,
      };
    }

    // Step 4: Map n8n response to our verification format
    // n8n returns nested: { extracted: { sender_username, receiver_username, amount }, checks: { ... } }
    const extracted = resData.extracted || {};
    const checks = resData.checks || {};

    const extractedAmount = Number(extracted.amount) || 0;
    const expected = Number(expectedAmount);
    const amountMatches = checks.amount_match !== undefined ? checks.amount_match : (Math.abs(extractedAmount - expected) <= expected * 0.02);

    // AI sometimes returns strings like "not found" or "none" when it fails to extract a name. 
    // We must treat these as failures rather than comparing them to the expected names.
    const isNotFound = (str) => {
      if (!str || str.trim() === '') return true;
      const lower = str.toLowerCase().trim();
      return lower === 'not found' || lower === 'none' || lower === 'n/a' || lower === 'unknown';
    };

    if (isNotFound(extracted.sender_username)) {
      checks.sender_match = false;
    }
    if (isNotFound(extracted.receiver_username)) {
      checks.receiver_match = false;
    }
    if (amountMatches === false) {
      checks.amount_match = false;
    }

    // Derive actual success from the corrected checks
    const allChecksPassed = checks.sender_match !== false
      && checks.receiver_match !== false
      && checks.amount_match !== false;

    // Override verification_status based on actual checks
    const effectiveStatus = allChecksPassed ? 'success' : 'failed';
    console.log('[Receipt Verifier] Effective status:', effectiveStatus, '| n8n status:', resData.verification_status, '| checks:', JSON.stringify(checks));

    // Confidence: derive from how many checks passed
    let confidence = Number(resData.confidence) || 0;
    if (!confidence) {
      const passedCount = [checks.sender_match, checks.receiver_match, checks.amount_match].filter(v => v === true).length;
      confidence = passedCount === 3 ? 0.95 : passedCount === 2 ? 0.7 : passedCount === 1 ? 0.4 : 0.1;
    }

    // Build rejection reason only if something actually failed
    let rejectionReason = null;

    if (!allChecksPassed) {
      const mismatches = [];
      if (checks.sender_match === false) {
        mismatches.push(`Sender mismatch: receipt shows "${extracted.sender_username || 'not found'}" but expected "${resData.expected?.sender_name || senderName}"`);
      }
      if (checks.receiver_match === false) {
        mismatches.push(`Receiver mismatch: receipt shows "${extracted.receiver_username || 'not found'}" but expected "${resData.expected?.receiver_name || receiverName}"`);
      }
      if (checks.amount_match === false) {
        mismatches.push(`Amount mismatch: receipt shows ${extractedAmount} but withdrawal is for ${expected}`);
      }

      if (mismatches.length > 0) {
        rejectionReason = `Receipt verification failed:\n• ${mismatches.join('\n• ')}`;
      } else {
        rejectionReason = resData.reason || resData.message || 'Receipt verification failed. The AI agent could not confirm the transfer details.';
      }
    }

    return {
      extracted_amount: extractedAmount,
      transaction_id: extracted.transaction_id || null,
      transaction_type: extracted.transaction_type || 'unknown',
      amount_matches: amountMatches,
      confidence,
      rejection_reason: rejectionReason,
      sender_username: extracted.sender_username || null,
      receiver_username: extracted.receiver_username || null,
      verification_status: effectiveStatus,
      // Add detailed objects for the premium UI
      extracted: extracted,
      expected: resData.expected || { sender_name: senderName, receiver_name: receiverName, amount: expected },
      checks: checks,
    };
  } catch (err) {
    console.error('n8n Receipt Verification Error:', err.message);
    return {
      extracted_amount: 0,
      transaction_id: null,
      transaction_type: 'unknown',
      amount_matches: false,
      confidence: 0,
      rejection_reason: `Failed to connect to the receipt verification service. Please ensure the n8n workflow is active and try again. Error: ${err.message}`,
    };
  }
}

module.exports = { verifyReceipt };
