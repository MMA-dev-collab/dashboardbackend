/**
 * Receipt Verifier Service
 * 
 * Uses local OCR (Tesseract.js) to extract text from receipt images/PDFs,
 * then sends the extracted text to the LLM service for structured data extraction.
 * This avoids the need for vision-capable models.
 */

const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');
const llmService = require('../llm/llm-service');

// ─── PDF to Image Conversion ───

/**
 * Convert the first page of a PDF to a JPEG image.
 * Returns the path to the temporary JPEG file.
 */
async function convertPdfToImage(pdfPath) {
  const { fromPath } = require('pdf2pic');

  const outputDir = path.dirname(pdfPath);
  const tempName = `temp_receipt_${Date.now()}`;

  const converter = fromPath(pdfPath, {
    density: 200,
    saveFilename: tempName,
    savePath: outputDir,
    format: 'jpeg',
    width: 1200,
    height: 1600,
  });

  const result = await converter(1); // Convert page 1
  return result.path;
}

// ─── OCR via Tesseract.js ───

/**
 * Extract text from an image file using Tesseract.js.
 * @param {string} imagePath - Path to the image file
 * @returns {string} Extracted text
 */
async function extractTextFromImage(imagePath) {
  const { data: { text } } = await Tesseract.recognize(imagePath, 'eng', {
    logger: () => {}, // Suppress progress logs
  });
  return text.trim();
}

// ─── LLM Verification ───

const SYSTEM_PROMPT = `You are a financial receipt verification assistant. You will receive raw text extracted from a financial receipt, invoice, or transfer confirmation via OCR.

Your task is to extract the following information and return ONLY a valid JSON object — no markdown, no explanation, no extra text:

{
  "extracted_amount": <number — the transaction amount as a decimal number, e.g. 1500.00>,
  "transaction_id": <string — the transaction/reference ID if visible, or null if not found>,
  "transaction_type": <string — e.g. "bank_transfer", "wire_transfer", "cash_deposit", "online_payment", "unknown">,
  "confidence": <number — your confidence in the extraction from 0.0 to 1.0>
}

Rules:
- extracted_amount MUST be a number, not a string. Remove currency symbols.
- If you cannot find a clear transaction amount, set extracted_amount to 0 and confidence to 0.1.
- If the text does not appear to be from a financial receipt at all, set confidence to 0.0.
- transaction_id should be the most prominent reference/confirmation number visible.
- Return ONLY the JSON object. No markdown code fences. No explanation.`;

/**
 * Verify a receipt file against an expected withdrawal amount.
 * 
 * @param {string} filePath - Absolute path to the uploaded file
 * @param {string} mimeType - MIME type of the file
 * @param {number} expectedAmount - The withdrawal amount to verify against
 * @returns {Object} Verification result
 */
async function verifyReceipt(filePath, mimeType, expectedAmount) {
  let imagePath = filePath;
  let tempImagePath = null;

  try {
    // Step 1: Handle PDF — convert first page to JPEG
    if (mimeType === 'application/pdf') {
      tempImagePath = await convertPdfToImage(filePath);
      imagePath = tempImagePath;
    }

    // Step 2: Run OCR on the image
    const ocrText = await extractTextFromImage(imagePath);

    // Step 3: Early reject if OCR returns nothing
    if (!ocrText || ocrText.length < 10) {
      return {
        extracted_amount: 0,
        transaction_id: null,
        transaction_type: 'unknown',
        amount_matches: false,
        confidence: 0,
        rejection_reason: 'Could not read any text from the receipt. Please upload a clearer image or a higher resolution scan.',
      };
    }

    // Step 4: Send extracted text to LLM for structured parsing
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Here is the OCR-extracted text from a receipt. The expected transfer amount is $${Number(expectedAmount).toFixed(2)}. Please extract the transaction details.\n\n--- RECEIPT TEXT ---\n${ocrText}\n--- END ---`,
      },
    ];

    const result = await llmService.chat(messages, [], null);
    const rawText = result.text || '';

    // Step 5: Parse JSON from LLM response
    const parsed = parseJsonFromText(rawText);

    if (!parsed) {
      return {
        extracted_amount: 0,
        transaction_id: null,
        transaction_type: 'unknown',
        amount_matches: false,
        confidence: 0,
        rejection_reason: 'Could not parse receipt verification response from AI. Please try again or upload a clearer receipt.',
      };
    }

    // Step 6: Compute amount match with ±2% tolerance
    const extractedAmount = Number(parsed.extracted_amount) || 0;
    const expected = Number(expectedAmount);
    const tolerance = expected * 0.02; // 2%
    const amountMatches = Math.abs(extractedAmount - expected) <= tolerance;
    const confidence = Number(parsed.confidence) || 0;

    let rejectionReason = null;
    if (confidence < 0.6) {
      rejectionReason = `Low confidence in receipt verification (${(confidence * 100).toFixed(0)}%). The uploaded file may not be a valid financial receipt. Please upload a clear receipt or invoice.`;
    } else if (!amountMatches) {
      rejectionReason = `Amount mismatch: Receipt shows $${extractedAmount.toFixed(2)} but the withdrawal request is for $${expected.toFixed(2)}. Please upload the correct receipt.`;
    }

    return {
      extracted_amount: extractedAmount,
      transaction_id: parsed.transaction_id || null,
      transaction_type: parsed.transaction_type || 'unknown',
      amount_matches: amountMatches,
      confidence,
      rejection_reason: rejectionReason,
    };
  } finally {
    // Clean up temp converted image
    if (tempImagePath && fs.existsSync(tempImagePath)) {
      try { fs.unlinkSync(tempImagePath); } catch (_) {}
    }
  }
}

// ─── JSON Parser Helper ───

/**
 * Attempt to extract a JSON object from LLM text output.
 * Handles cases where the model wraps JSON in markdown code fences.
 */
function parseJsonFromText(text) {
  // Try direct parse first
  try {
    return JSON.parse(text.trim());
  } catch (_) {}

  // Try extracting from markdown code fence
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch (_) {}
  }

  // Try finding a JSON object in the text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0].trim());
    } catch (_) {}
  }

  return null;
}

module.exports = { verifyReceipt };
