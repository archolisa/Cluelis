const fs = require('fs');
const path = require('path');

/**
 * Interview modes registry — defines all available interview types.
 * Each mode maps to prompt files and metadata for the UI.
 */
const INTERVIEW_MODES = {
  'data-annotation': {
    name: 'AI/Data Annotation',
    description: 'Data labeling, annotation, RLHF, human feedback',
    promptFiles: ['base-interview', 'data-annotation'],
    icon: '🏷️',
    requiresProgrammingLanguage: false
  },
  'ai-evaluation': {
    name: 'AI Evaluation',
    description: 'LLM evaluation, preference ranking, response quality',
    promptFiles: ['base-interview', 'ai-evaluation'],
    icon: '🔍',
    requiresProgrammingLanguage: false
  },
  'generalist': {
    name: 'Generalist',
    description: 'Broad reasoning, remote work, problem solving',
    promptFiles: ['base-interview', 'generalist'],
    icon: '🌐',
    requiresProgrammingLanguage: false
  },
  'web-research': {
    name: 'Web Research',
    description: 'Search evaluation, content quality, web research',
    promptFiles: ['base-interview', 'web-research'],
    icon: '🔎',
    requiresProgrammingLanguage: false
  },
  'technical': {
    name: 'Technical/Software',
    description: 'Programming, DSA, system design',
    promptFiles: ['base-interview', 'technical'],
    icon: '💻',
    requiresProgrammingLanguage: true
  },
  'dsa': {
    name: 'DSA (Legacy)',
    description: 'Data structures & algorithms — competitive programming',
    promptFiles: ['dsa'],
    icon: '🧮',
    requiresProgrammingLanguage: true
  },
  'custom': {
    name: 'Custom Interview',
    description: 'User-defined interview mode with custom instructions',
    promptFiles: ['base-interview'],
    icon: '✏️',
    requiresProgrammingLanguage: false
  }
};

/**
 * Response length presets — control how verbose answers are.
 */
const RESPONSE_LENGTHS = {
  'quick': {
    name: 'Quick',
    description: '2–4 sentences',
    instruction: 'Keep your response to 2-4 sentences. Direct answer only, no elaboration.'
  },
  'normal': {
    name: 'Normal',
    description: '30–60 seconds spoken',
    instruction: 'Provide a response suitable for 30-60 seconds of speaking. Include a direct answer and brief supporting reasoning.'
  },
  'detailed': {
    name: 'Detailed',
    description: '60–120 seconds spoken',
    instruction: 'Provide a detailed response suitable for 60-120 seconds of speaking. Include a direct answer, reasoning, and concrete examples.'
  }
};

class PromptLoader {
  constructor() {
    this.prompts = new Map();
    this.promptsLoaded = false;
    this.skillPromptSent = new Set();
    // Skills that need programming language injection
    this.skillsRequiringProgrammingLanguage = ['dsa', 'technical'];
  }

  /**
   * Load all skill prompts from the prompts directory
   */
  loadPrompts() {
    if (this.promptsLoaded) {
      return;
    }

    const promptsDir = path.join(__dirname, 'prompts');
    
    try {
      const files = fs.readdirSync(promptsDir);
      
      for (const file of files) {
        if (file.endsWith('.md')) {
          const skillName = path.basename(file, '.md');
          const filePath = path.join(promptsDir, file);
          const promptContent = fs.readFileSync(filePath, 'utf8');
          
          this.prompts.set(skillName, promptContent);
        }
      }
      
      this.promptsLoaded = true;
      
    } catch (error) {
      console.error('Error loading skill prompts:', error);
      throw new Error(`Failed to load skill prompts: ${error.message}`);
    }
  }

  /**
   * Get the list of available interview modes with metadata
   * @returns {Object} Map of mode id => mode metadata
   */
  getInterviewModes() {
    return { ...INTERVIEW_MODES };
  }

  /**
   * Get response length presets
   * @returns {Object} Map of length id => preset metadata
   */
  getResponseLengths() {
    return { ...RESPONSE_LENGTHS };
  }

  /**
   * Build a composed system prompt for a given interview mode.
   * Combines: base prompt + role prompt + CV context + custom instructions + response length
   * 
   * @param {string} interviewMode - The interview mode id
   * @param {Object} options - Additional options
   * @param {string|null} options.programmingLanguage - Language for technical modes
   * @param {Object|null} options.cvContext - Parsed CV data for context injection
   * @param {string|null} options.customInstructions - User's custom instructions
   * @param {string} options.responseLength - 'quick' | 'normal' | 'detailed'
   * @param {boolean} options.speakingMode - Whether to use speaking answer format
   * @param {boolean} options.isMockInterview - Whether this is a mock interview session
   * @param {Object|null} options.mockConfig - Mock interview configuration
   * @returns {string} Composed system prompt
   */
  buildSystemPrompt(interviewMode, options = {}) {
    if (!this.promptsLoaded) {
      this.loadPrompts();
    }

    const mode = INTERVIEW_MODES[interviewMode] || INTERVIEW_MODES['generalist'];
    const parts = [];

    // 1. Load and compose prompt files for this mode
    for (const promptFile of mode.promptFiles) {
      const content = this.prompts.get(promptFile);
      if (content) {
        parts.push(content);
      }
    }

    // 2. Add mock interview prompt if applicable
    if (options.isMockInterview) {
      const mockPrompt = this.prompts.get('mock-interview');
      if (mockPrompt) {
        parts.push(mockPrompt);
      }
      if (options.mockConfig) {
        parts.push(this._buildMockInterviewConfig(options.mockConfig));
      }
    }

    // 3. Add programming language context if needed
    if (options.programmingLanguage && mode.requiresProgrammingLanguage) {
      parts.push(this._buildLanguageContext(options.programmingLanguage, interviewMode));
    }

    // 4. Inject CV context
    if (options.cvContext && Object.keys(options.cvContext).length > 0) {
      parts.push(this._buildCVContext(options.cvContext));
    }

    // 5. Add custom instructions
    if (options.customInstructions && options.customInstructions.trim()) {
      parts.push(`\n## CUSTOM INSTRUCTIONS FROM CANDIDATE\n${options.customInstructions.trim()}\n`);
    }

    // 6. Add response length instruction
    const lengthPreset = RESPONSE_LENGTHS[options.responseLength] || RESPONSE_LENGTHS['normal'];
    parts.push(`\n## RESPONSE LENGTH: ${lengthPreset.name.toUpperCase()}\n${lengthPreset.instruction}\n`);

    // 7. Add speaking mode instruction
    if (options.speakingMode !== false) {
      parts.push(`\n## SPEAKING ANSWER FORMAT
Format your response as something the candidate could actually say aloud.
Use continuous spoken paragraphs, not bullet points.
Use natural transitions and conversational flow.
The candidate should be able to read your response directly as their answer.\n`);
    }

    return parts.join('\n\n---\n\n');
  }

  /**
   * Build CV context section from parsed CV data
   * @private
   */
  _buildCVContext(cvData) {
    if (!this.promptsLoaded) this.loadPrompts();
    
    let template = this.prompts.get('cv-context') || '';
    
    const fields = {
      '{{name}}': cvData.name || 'Not specified',
      '{{summary}}': cvData.summary || 'Not specified',
      '{{education}}': cvData.education || 'Not specified',
      '{{experience}}': cvData.experience || 'Not specified',
      '{{ai_experience}}': cvData.ai_experience || 'Not specified',
      '{{technical_skills}}': cvData.technical_skills || cvData.skills || 'Not specified',
      '{{research}}': cvData.research || 'Not specified',
      '{{languages}}': cvData.languages || 'Not specified',
      '{{certifications}}': cvData.certifications || 'Not specified',
      '{{projects}}': cvData.projects || 'Not specified',
      '{{achievements}}': cvData.achievements || 'Not specified'
    };

    for (const [placeholder, value] of Object.entries(fields)) {
      template = template.replace(placeholder, value);
    }

    return template;
  }

  /**
   * Build programming language context
   * @private
   */
  _buildLanguageContext(programmingLanguage, interviewMode) {
    const languageMap = { cpp: 'C++', c: 'C', python: 'Python', java: 'Java', javascript: 'JavaScript', js: 'JavaScript' };
    const fenceTagMap = { cpp: 'cpp', c: 'c', python: 'python', java: 'java', javascript: 'javascript', js: 'javascript' };
    const norm = (programmingLanguage || '').toLowerCase();
    const languageTitle = languageMap[norm] || (programmingLanguage.charAt(0).toUpperCase() + programmingLanguage.slice(1));
    const fenceTag = fenceTagMap[norm] || norm || 'text';
    const languageUpper = (languageMap[norm] || languageTitle).toUpperCase();
    
    if (interviewMode === 'dsa') {
      return `\n## IMPLEMENTATION LANGUAGE: ${languageUpper}
STRICT REQUIREMENTS:
- Respond ONLY in ${languageTitle}. Do not include any snippets or alternatives in other languages.
- All code blocks must use triple backticks with the exact language tag: \`\`\`${fenceTag}\`\`\`.
- Aim for the best possible time and space complexity; prefer optimal algorithms and data structures.
- Provide: brief approach, then final ${languageTitle} implementation, followed by time/space complexity.
- If the user's input is a problem statement (and does not include code), produce a complete, runnable ${languageTitle} solution without asking for clarification.
- Avoid unnecessary verbosity; focus on correctness, clarity, and efficiency.`;
    }

    return `\n## PROGRAMMING LANGUAGE: ${languageUpper}
All code and examples must be in ${languageTitle}. Use code fences with tag: \`\`\`${fenceTag}\`\`\`.`;
  }

  /**
   * Build mock interview configuration section
   * @private
   */
  _buildMockInterviewConfig(config) {
    let prompt = `\n## MOCK INTERVIEW IN PROGRESS
- Role: ${config.role || 'General'}
- Difficulty: ${config.difficulty || 'Intermediate'}
- Target Total Questions: ${config.questionCount || 10}
- Current Question Number: ${config.currentQuestion || 1}
- CV context: ${config.useCV ? 'Enabled (reference the candidate profile above)' : 'Disabled'}\n`;

    if (config.isComplete) {
      prompt += `\nThe interview is now complete. Do not ask any more questions. Give the candidate comprehensive feedback on their performance, strengths, and areas for improvement based on the conversation so far.`;
    } else if (config.currentQuestion === 1) {
      prompt += `\nThis is the very first interaction. Begin the interview by briefly introducing yourself as the interviewer and immediately asking the FIRST interview question.`;
    } else {
      prompt += `\nYou are in the middle of the interview. The candidate just answered your previous question.`;
      
      if (config.questionsAsked && config.questionsAsked.length > 0) {
        prompt += `\n\nPreviously asked questions (DO NOT REPEAT THESE):\n`;
        config.questionsAsked.forEach((q, idx) => {
          prompt += `${idx + 1}. ${q}\n`;
        });
      }
      
      prompt += `\nAcknowledge their last answer and ask the NEXT question naturally. Remember, your goal is to assess them for the ${config.role || 'General'} role.`;
    }
    
    return prompt;
  }

  /**
   * Get the system prompt for a specific skill with optional programming language injection.
   * Backward-compatible with the old API.
   * @param {string} skillName - The name of the skill
   * @param {string|null} programmingLanguage - Optional programming language to inject
   * @returns {string|null} The system prompt content or null if not found
   */
  getSkillPrompt(skillName, programmingLanguage = null) {
    if (!this.promptsLoaded) {
      this.loadPrompts();
    }

    const normalizedSkillName = this.normalizeSkillName(skillName);
    
    // Check if this is an interview mode — if so, use the composable system
    if (INTERVIEW_MODES[normalizedSkillName]) {
      return this.buildSystemPrompt(normalizedSkillName, {
        programmingLanguage,
        responseLength: 'normal',
        speakingMode: true
      });
    }

    // Legacy fallback: load the raw prompt file
    let promptContent = this.prompts.get(normalizedSkillName);
    
    if (!promptContent) {
      return null;
    }

    // Inject programming language if provided and skill requires it
    if (programmingLanguage && this.skillsRequiringProgrammingLanguage.includes(normalizedSkillName)) {
      promptContent += this._buildLanguageContext(programmingLanguage, normalizedSkillName);
    }

    return promptContent;
  }

  /**
   * Check if stored memory is empty (first time interaction)
   */
  isFirstTimeInteraction(storedMemory) {
    return !storedMemory || storedMemory.length === 0;
  }

  /**
   * Check if skill prompt should be sent as model memory
   */
  shouldSendAsModelMemory(skillName, storedMemory) {
    const normalizedSkillName = this.normalizeSkillName(skillName);
    
    if (this.isFirstTimeInteraction(storedMemory)) {
      return true;
    }

    const hasSkillInMemory = storedMemory.some(event => 
      event.skillUsed === normalizedSkillName && event.promptSentAsMemory === true
    );

    if (!hasSkillInMemory) {
      return true;
    }

    return false;
  }

  /**
   * Prepare Gemini API request with model memory or regular message
   */
  prepareGeminiRequest(skillName, userMessage, storedMemory, programmingLanguage = null) {
    const normalizedSkillName = this.normalizeSkillName(skillName);
    const skillPrompt = this.getSkillPrompt(normalizedSkillName, programmingLanguage);
    
    const requestConfig = {
      model: 'gemini-pro',
      contents: [],
      systemInstruction: null,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      }
    };

    if (this.shouldSendAsModelMemory(skillName, storedMemory)) {
      if (skillPrompt) {
        requestConfig.systemInstruction = {
          parts: [{ text: skillPrompt }]
        };
        
        requestConfig.contents.push({
          role: 'user',
          parts: [{ text: userMessage }]
        });
        
        this.skillPromptSent.add(normalizedSkillName);
        
        return {
          ...requestConfig,
          isUsingModelMemory: true,
          skillUsed: normalizedSkillName,
          programmingLanguage
        };
      } else {
        console.warn(`No system prompt found for skill: ${normalizedSkillName}`);
      }
    }

    requestConfig.contents.push({
      role: 'user',
      parts: [{ text: userMessage }]
    });
    
    return {
      ...requestConfig,
      isUsingModelMemory: false,
      skillUsed: normalizedSkillName,
      programmingLanguage
    };
  }

  /**
   * Get separate components for manual API construction
   */
  getRequestComponents(skillName, userMessage, storedMemory, programmingLanguage = null) {
    const normalizedSkillName = this.normalizeSkillName(skillName);
    const shouldUseModelMemory = this.shouldSendAsModelMemory(skillName, storedMemory);
    const skillPrompt = this.getSkillPrompt(normalizedSkillName, programmingLanguage);

    return {
      skillName: normalizedSkillName,
      userMessage,
      skillPrompt,
      shouldUseModelMemory,
      isFirstTime: this.isFirstTimeInteraction(storedMemory),
      modelMemory: shouldUseModelMemory && skillPrompt ? skillPrompt : null,
      messageContent: userMessage,
      programmingLanguage,
      requiresProgrammingLanguage: this.skillsRequiringProgrammingLanguage.includes(normalizedSkillName)
    };
  }

  /**
   * Update stored memory after successful API call
   */
  updateStoredMemory(storedMemory, skillName, wasModelMemoryUsed, userMessage, aiResponse, programmingLanguage = null) {
    const normalizedSkillName = this.normalizeSkillName(skillName);
    const updatedMemory = [...(storedMemory || [])];
    
    const memoryEntry = {
      timestamp: new Date().toISOString(),
      skillUsed: normalizedSkillName,
      promptSentAsMemory: wasModelMemoryUsed,
      userMessage,
      aiResponse: aiResponse ? aiResponse.substring(0, 200) + '...' : null,
      action: wasModelMemoryUsed ? 'MODEL_MEMORY_SENT' : 'REGULAR_MESSAGE',
      programmingLanguage: programmingLanguage || null
    };
    
    updatedMemory.push(memoryEntry);
        
    return updatedMemory;
  }

  /**
   * Process user request — complete flow
   */
  async processUserRequest(skillName, userMessage, storedMemory, programmingLanguage = null) {
    try {
      const components = this.getRequestComponents(skillName, userMessage, storedMemory, programmingLanguage);
      const geminiRequest = this.prepareGeminiRequest(skillName, userMessage, storedMemory, programmingLanguage);
      
      return {
        requestReady: true,
        geminiRequest,
        components,
        needsMemoryUpdate: true,
        programmingLanguage
      };
      
    } catch (error) {
      console.error('Error processing user request:', error);
      return {
        requestReady: false,
        error: error.message,
        programmingLanguage
      };
    }
  }

  /**
   * Check if a skill requires programming language context
   */
  requiresProgrammingLanguage(skillName) {
    const normalizedSkillName = this.normalizeSkillName(skillName);
    // Check interview modes first
    const mode = INTERVIEW_MODES[normalizedSkillName];
    if (mode) return mode.requiresProgrammingLanguage;
    return this.skillsRequiringProgrammingLanguage.includes(normalizedSkillName);
  }

  /**
   * Get list of skills that require programming language context
   */
  getSkillsRequiringProgrammingLanguage() {
    return [...this.skillsRequiringProgrammingLanguage];
  }

  /**
   * Normalize skill names to match file names
   */
  normalizeSkillName(skillName) {
    if (!skillName) return 'generalist';
    
    const normalized = skillName.toLowerCase().trim();
    
    const skillMap = {
      // New interview modes
      'data-annotation': 'data-annotation',
      'data_annotation': 'data-annotation',
      'annotation': 'data-annotation',
      'labeling': 'data-annotation',
      'rlhf': 'data-annotation',
      'ai-evaluation': 'ai-evaluation',
      'ai_evaluation': 'ai-evaluation',
      'ai-training': 'ai-evaluation',
      'ai_training': 'ai-evaluation',
      'llm-evaluation': 'ai-evaluation',
      'evaluator': 'ai-evaluation',
      'generalist': 'generalist',
      'general': 'generalist',
      'micro1': 'generalist',
      'web-research': 'web-research',
      'web_research': 'web-research',
      'search': 'web-research',
      'search-evaluation': 'web-research',
      'technical': 'technical',
      'software': 'technical',
      'custom': 'custom',
      
      // Legacy mappings preserved
      'dsa': 'dsa',
      'data-structures': 'dsa',
      'algorithms': 'dsa',
      'data-structures-algorithms': 'dsa',
      'behavioral': 'generalist',
      'behavioral-interview': 'generalist',
      'behavior': 'generalist',
      'programming': 'technical',
      'coding': 'technical',
      'software-development': 'technical',
      'development': 'technical',
      'data-science': 'technical',
      'datascience': 'technical',
      'machine-learning': 'technical',
      'ml': 'technical',
      'system-design': 'technical',
      'systems-design': 'technical',
      'architecture': 'technical',
      'distributed-systems': 'technical'
    };

    return skillMap[normalized] || normalized;
  }

  /**
   * Get list of available skills (interview modes)
   */
  getAvailableSkills() {
    if (!this.promptsLoaded) {
      this.loadPrompts();
    }
    return Object.keys(INTERVIEW_MODES);
  }

  /**
   * Reset the prompt sent tracking and clear stored memory
   */
  resetSession() {
    this.skillPromptSent.clear();
  }

  /**
   * Get current session statistics
   */
  getSessionStats() {
    if (!this.promptsLoaded) {
      this.loadPrompts();
    }

    const stats = {
      totalPrompts: this.prompts.size,
      skillsUsedInSession: this.skillPromptSent.size,
      availableSkills: this.getAvailableSkills(),
      interviewModes: Object.keys(INTERVIEW_MODES),
      skillsUsed: Array.from(this.skillPromptSent),
      skillsRequiringProgrammingLanguage: this.skillsRequiringProgrammingLanguage
    };

    return stats;
  }
}

// Export singleton instance
const promptLoader = new PromptLoader();

module.exports = {
  PromptLoader,
  promptLoader,
  INTERVIEW_MODES,
  RESPONSE_LENGTHS
};