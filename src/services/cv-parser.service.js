const fs = require('fs');
const path = require('path');
const logger = require('../core/logger').createServiceLogger('CV_PARSER');

class CVParserService {
  constructor() {
    this.supportedFormats = ['.pdf', '.docx', '.txt', '.doc'];
  }

  /**
   * Parse a CV file and extract text content
   * @param {string} filePath - Absolute path to the CV file
   * @returns {Promise<{text: string, format: string, metadata: Object}>}
   */
  async parseFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    if (!this.supportedFormats.includes(ext)) {
      throw new Error(`Unsupported file format: ${ext}. Supported: ${this.supportedFormats.join(', ')}`);
    }

    logger.info('Parsing CV file', { filePath, format: ext });

    switch (ext) {
      case '.pdf':
        return this.parsePDF(filePath);
      case '.docx':
      case '.doc':
        return this.parseDOCX(filePath);
      case '.txt':
        return this.parseTXT(filePath);
      default:
        throw new Error(`Unsupported format: ${ext}`);
    }
  }

  /**
   * Parse a CV from a buffer (for drag-and-drop uploads)
   * @param {Buffer} buffer - File content buffer
   * @param {string} filename - Original filename
   * @returns {Promise<{text: string, format: string, metadata: Object}>}
   */
  async parseBuffer(buffer, filename) {
    const ext = path.extname(filename).toLowerCase();
    
    if (!this.supportedFormats.includes(ext)) {
      throw new Error(`Unsupported file format: ${ext}. Supported: ${this.supportedFormats.join(', ')}`);
    }

    logger.info('Parsing CV buffer', { filename, format: ext, size: buffer.length });

    switch (ext) {
      case '.pdf':
        return this.parsePDFBuffer(buffer);
      case '.docx':
      case '.doc':
        return this.parseDOCXBuffer(buffer);
      case '.txt':
        return { text: buffer.toString('utf8'), format: 'txt', metadata: { filename } };
      default:
        throw new Error(`Unsupported format: ${ext}`);
    }
  }

  /**
   * Parse PDF file
   */
  async parsePDF(filePath) {
    const buffer = fs.readFileSync(filePath);
    return this.parsePDFBuffer(buffer);
  }

  /**
   * Parse PDF from buffer
   */
  async parsePDFBuffer(buffer) {
    try {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      
      const text = data.text ? data.text.trim() : '';
      
      if (!text || text.length < 20) {
        throw new Error('This CV appears to be image-based or contains very little extractable text. Please upload a text-based PDF or DOCX.');
      }

      logger.info('PDF parsed successfully', { 
        textLength: text.length,
        pages: data.numpages 
      });

      return {
        text,
        format: 'pdf',
        metadata: {
          pages: data.numpages,
          textLength: text.length
        }
      };
    } catch (error) {
      if (error.message.includes('image-based')) {
        throw error;
      }
      logger.error('PDF parsing failed', { error: error.message });
      throw new Error(`Failed to parse PDF: ${error.message}`);
    }
  }

  /**
   * Parse DOCX file
   */
  async parseDOCX(filePath) {
    const buffer = fs.readFileSync(filePath);
    return this.parseDOCXBuffer(buffer);
  }

  /**
   * Parse DOCX from buffer
   */
  async parseDOCXBuffer(buffer) {
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      
      const text = result.value ? result.value.trim() : '';
      
      if (!text || text.length < 10) {
        throw new Error('Could not extract text from this document. Please try a different format.');
      }

      logger.info('DOCX parsed successfully', { textLength: text.length });

      return {
        text,
        format: 'docx',
        metadata: {
          textLength: text.length,
          messages: result.messages || []
        }
      };
    } catch (error) {
      logger.error('DOCX parsing failed', { error: error.message });
      throw new Error(`Failed to parse DOCX: ${error.message}`);
    }
  }

  /**
   * Parse TXT file
   */
  async parseTXT(filePath) {
    try {
      const text = fs.readFileSync(filePath, 'utf8').trim();
      
      if (!text || text.length < 10) {
        throw new Error('The text file appears to be empty or too short.');
      }

      logger.info('TXT parsed successfully', { textLength: text.length });

      return {
        text,
        format: 'txt',
        metadata: {
          textLength: text.length
        }
      };
    } catch (error) {
      if (error.message.includes('empty')) throw error;
      logger.error('TXT parsing failed', { error: error.message });
      throw new Error(`Failed to read text file: ${error.message}`);
    }
  }

  /**
   * Use AI to structure raw CV text into parsed fields.
   * This makes a Gemini API call to extract structured data.
   * @param {string} rawText - The extracted CV text
   * @param {Object} llmService - The LLM service instance
   * @returns {Promise<Object>} Structured CV data
   */
  async structureCV(rawText, llmService) {
    if (!llmService || !llmService.isInitialized) {
      // Fallback: return raw text as summary
      logger.warn('LLM not available, returning raw CV text as unstructured');
      return {
        name: 'Unknown',
        summary: rawText.substring(0, 500),
        rawText: rawText,
        structured: false
      };
    }

    const structurePrompt = `Extract and structure the following CV/resume into these exact JSON fields. Return ONLY valid JSON, no markdown fences, no explanation.

Fields:
- name: Full name of the candidate
- summary: 2-3 sentence professional summary
- education: Education history (degrees, institutions, years)
- experience: Work experience (roles, companies, durations, key responsibilities)
- ai_experience: Any AI, data annotation, machine learning, or data science experience specifically
- technical_skills: Programming languages, tools, frameworks, technologies
- research: Research experience or publications
- languages: Spoken/written languages
- certifications: Professional certifications
- projects: Notable projects
- achievements: Awards, honors, notable achievements

If a field has no relevant information, use "Not specified".

CV TEXT:
${rawText.substring(0, 8000)}`;

    try {
      const request = {
        contents: [{ role: 'user', parts: [{ text: structurePrompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
          thinkingConfig: { thinkingBudget: 0 }
        }
      };

      const responseText = await llmService.executeRequest(request);
      
      // Clean the response — remove markdown fences if present
      let cleaned = responseText.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      
      const structured = JSON.parse(cleaned);
      structured.rawText = rawText;
      structured.structured = true;

      logger.info('CV structured successfully', { 
        name: structured.name,
        fieldsFound: Object.keys(structured).filter(k => structured[k] && structured[k] !== 'Not specified').length
      });

      return structured;
    } catch (error) {
      logger.warn('Failed to structure CV with AI, using raw text', { error: error.message });
      return {
        name: 'Unknown',
        summary: rawText.substring(0, 500),
        rawText: rawText,
        structured: false
      };
    }
  }

  /**
   * Get supported file formats
   * @returns {string[]}
   */
  getSupportedFormats() {
    return [...this.supportedFormats];
  }
}

module.exports = new CVParserService();
