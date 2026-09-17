const logger = require('../core/logger').createServiceLogger('MOCK_INTERVIEW');

class MockInterviewService {
  constructor() {
    this.isActive = false;
    this.config = null;
    this.currentQuestion = 0;
    this.totalQuestions = 0;
    this.answers = [];
    this.startTime = null;
  }

  /**
   * Start a mock interview session
   * @param {Object} config
   * @param {string} config.role - Interview role (e.g., 'AI Data Annotator')
   * @param {string} config.difficulty - 'beginner' | 'intermediate' | 'advanced'
   * @param {number} config.questionCount - Number of questions
   * @param {string} config.interviewMode - Interview mode key
   * @param {boolean} config.useCV - Whether to include CV context
   * @returns {Object} Mock interview state
   */
  start(config) {
    this.isActive = true;
    this.config = {
      role: config.role || 'General',
      difficulty: config.difficulty || 'intermediate',
      questionCount: config.questionCount || 10,
      interviewMode: config.interviewMode || 'generalist',
      useCV: config.useCV !== false
    };
    this.currentQuestion = 1;
    this.totalQuestions = this.config.questionCount;
    this.answers = [];
    this.startTime = Date.now();

    logger.info('Mock interview started', this.config);

    return this.getState();
  }

  /**
   * Record a candidate's answer and advance to next question
   * @param {string} question - The question that was asked
   * @param {string} answer - The candidate's response
   * @returns {Object} Updated state
   */
  recordAnswer(question, answer) {
    if (!this.isActive) {
      throw new Error('No mock interview in progress');
    }

    this.answers.push({
      questionNumber: this.currentQuestion,
      question,
      answer,
      timestamp: new Date().toISOString()
    });

    this.currentQuestion++;

    logger.debug('Answer recorded', {
      questionNumber: this.answers.length,
      total: this.totalQuestions,
      isComplete: this.isComplete()
    });

    return this.getState();
  }

  /**
   * Check if the interview is complete
   * @returns {boolean}
   */
  isComplete() {
    return this.currentQuestion > this.totalQuestions;
  }

  /**
   * End the mock interview
   * @returns {Object} Final state with summary
   */
  end() {
    const state = this.getState();
    
    this.isActive = false;
    this.config = null;
    this.currentQuestion = 0;
    this.totalQuestions = 0;
    this.answers = [];
    this.startTime = null;

    logger.info('Mock interview ended', {
      questionsAnswered: state.questionsAnswered,
      duration: state.durationMs
    });

    state.isActive = false;
    return state;
  }

  /**
   * Get the current mock interview configuration for prompt building
   * @returns {Object|null}
   */
  getMockConfig() {
    if (!this.isActive) return null;
    
    return {
      role: this.config.role,
      difficulty: this.config.difficulty,
      questionCount: this.totalQuestions,
      currentQuestion: this.currentQuestion,
      useCV: this.config.useCV,
      questionsAsked: this.answers.map(a => a.question),
      isComplete: this.isComplete()
    };
  }

  /**
   * Get complete interview state
   * @returns {Object}
   */
  getState() {
    return {
      isActive: this.isActive,
      config: this.config,
      currentQuestion: this.currentQuestion,
      totalQuestions: this.totalQuestions,
      questionsAnswered: this.answers.length,
      answers: this.answers,
      isComplete: this.isComplete(),
      durationMs: this.startTime ? Date.now() - this.startTime : 0,
      progress: this.totalQuestions > 0 
        ? Math.round((this.answers.length / this.totalQuestions) * 100) 
        : 0
    };
  }
}

module.exports = new MockInterviewService();
