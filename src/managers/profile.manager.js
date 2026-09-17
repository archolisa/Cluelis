const fs = require('fs');
const path = require('path');
const logger = require('../core/logger').createServiceLogger('PROFILE');
const config = require('../core/config');

class ProfileManager {
  constructor() {
    this.profilesDir = path.join(config.get('app.dataDir'), 'profiles');
    this.activeProfileId = null;
    this.profiles = new Map();
    
    this._ensureProfilesDir();
    this._loadProfiles();
  }

  /**
   * Ensure the profiles directory exists
   */
  _ensureProfilesDir() {
    try {
      if (!fs.existsSync(this.profilesDir)) {
        fs.mkdirSync(this.profilesDir, { recursive: true });
        logger.info('Created profiles directory', { path: this.profilesDir });
      }
    } catch (error) {
      logger.error('Failed to create profiles directory', { error: error.message });
    }
  }

  /**
   * Load all profiles from disk
   */
  _loadProfiles() {
    try {
      const files = fs.readdirSync(this.profilesDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.profilesDir, file);
          try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            this.profiles.set(data.id, data);
            
            // Restore active profile
            if (data.isActive) {
              this.activeProfileId = data.id;
            }
          } catch (e) {
            logger.warn('Failed to load profile file', { file, error: e.message });
          }
        }
      }

      // Load active profile ID from state file
      const stateFile = path.join(this.profilesDir, '.active-profile');
      if (fs.existsSync(stateFile)) {
        const activeId = fs.readFileSync(stateFile, 'utf8').trim();
        if (this.profiles.has(activeId)) {
          this.activeProfileId = activeId;
        }
      }

      logger.info('Profiles loaded', { 
        count: this.profiles.size,
        activeId: this.activeProfileId
      });
    } catch (error) {
      logger.error('Failed to load profiles', { error: error.message });
    }
  }

  /**
   * Save a profile to disk
   */
  _saveProfile(profile) {
    const filePath = path.join(this.profilesDir, `${profile.id}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf8');
      logger.debug('Profile saved', { id: profile.id, name: profile.name });
    } catch (error) {
      logger.error('Failed to save profile', { id: profile.id, error: error.message });
      throw error;
    }
  }

  /**
   * Save active profile state
   */
  _saveActiveState() {
    const stateFile = path.join(this.profilesDir, '.active-profile');
    try {
      fs.writeFileSync(stateFile, this.activeProfileId || '', 'utf8');
    } catch (error) {
      logger.warn('Failed to save active profile state', { error: error.message });
    }
  }

  /**
   * Create a new candidate profile
   * @param {Object} options
   * @param {string} options.name - Profile display name (e.g., "AI Evaluator CV")
   * @param {string} options.cvText - Raw CV text
   * @param {Object} options.cvStructured - Structured CV data from AI parsing
   * @param {string} options.preferredRole - Preferred interview mode
   * @param {Object} options.settings - Interview settings for this profile
   * @returns {Object} The created profile
   */
  createProfile({ name, cvText, cvStructured = {}, preferredRole = 'generalist', settings = {} }) {
    const id = `profile-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    
    const profile = {
      id,
      name: name || 'New Profile',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cvText: cvText || '',
      cvStructured: cvStructured || {},
      preferredRole,
      settings: {
        interviewMode: settings.interviewMode || preferredRole,
        responseLength: settings.responseLength || 'normal',
        speakingStyle: settings.speakingStyle || 'natural',
        customInstructions: settings.customInstructions || '',
        ...settings
      }
    };

    this.profiles.set(id, profile);
    this._saveProfile(profile);

    // Auto-activate if this is the first profile
    if (this.profiles.size === 1 || !this.activeProfileId) {
      this.activeProfileId = id;
      this._saveActiveState();
    }

    logger.info('Profile created', { id, name: profile.name });
    return this._sanitizeProfile(profile);
  }

  /**
   * Update an existing profile
   * @param {string} id - Profile ID
   * @param {Object} updates - Fields to update
   * @returns {Object} Updated profile
   */
  updateProfile(id, updates) {
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new Error(`Profile not found: ${id}`);
    }

    // Apply updates (shallow merge, deep merge for settings)
    if (updates.name !== undefined) profile.name = updates.name;
    if (updates.cvText !== undefined) profile.cvText = updates.cvText;
    if (updates.cvStructured !== undefined) profile.cvStructured = updates.cvStructured;
    if (updates.preferredRole !== undefined) profile.preferredRole = updates.preferredRole;
    if (updates.settings !== undefined) {
      profile.settings = { ...profile.settings, ...updates.settings };
    }
    
    profile.updatedAt = new Date().toISOString();

    this.profiles.set(id, profile);
    this._saveProfile(profile);

    logger.info('Profile updated', { id, name: profile.name });
    return this._sanitizeProfile(profile);
  }

  /**
   * Delete a profile
   * @param {string} id - Profile ID
   */
  deleteProfile(id) {
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new Error(`Profile not found: ${id}`);
    }

    this.profiles.delete(id);
    
    // Delete file from disk
    const filePath = path.join(this.profilesDir, `${id}.json`);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      logger.warn('Failed to delete profile file', { id, error: error.message });
    }

    // If this was the active profile, switch to another or clear
    if (this.activeProfileId === id) {
      const remaining = Array.from(this.profiles.keys());
      this.activeProfileId = remaining.length > 0 ? remaining[0] : null;
      this._saveActiveState();
    }

    logger.info('Profile deleted', { id, name: profile.name });
    return { success: true };
  }

  /**
   * Switch the active profile
   * @param {string} id - Profile ID to activate
   * @returns {Object} The activated profile
   */
  switchProfile(id) {
    if (!this.profiles.has(id)) {
      throw new Error(`Profile not found: ${id}`);
    }

    this.activeProfileId = id;
    this._saveActiveState();

    const profile = this.profiles.get(id);
    logger.info('Active profile switched', { id, name: profile.name });
    return this._sanitizeProfile(profile);
  }

  /**
   * Get the active profile
   * @returns {Object|null} Active profile or null
   */
  getActiveProfile() {
    if (!this.activeProfileId) return null;
    const profile = this.profiles.get(this.activeProfileId);
    return profile ? this._sanitizeProfile(profile) : null;
  }

  /**
   * Get the CV context for the active profile (for prompt injection)
   * @returns {Object|null} Structured CV data or null
   */
  getActiveCVContext() {
    if (!this.activeProfileId) return null;
    const profile = this.profiles.get(this.activeProfileId);
    if (!profile) return null;

    // Prefer structured data; fall back to raw text as summary
    if (profile.cvStructured && profile.cvStructured.structured) {
      return profile.cvStructured;
    }

    if (profile.cvText) {
      return {
        name: profile.cvStructured?.name || profile.name,
        summary: profile.cvText.substring(0, 2000),
        rawText: profile.cvText,
        structured: false
      };
    }

    return null;
  }

  /**
   * Get all profiles (list view)
   * @returns {Array<Object>} Array of sanitized profiles
   */
  getAllProfiles() {
    return Array.from(this.profiles.values()).map(p => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      preferredRole: p.preferredRole,
      isActive: p.id === this.activeProfileId,
      hasCv: !!(p.cvText && p.cvText.length > 0),
      cvName: p.cvStructured?.name || p.name,
      settings: p.settings
    }));
  }

  /**
   * Get a specific profile
   * @param {string} id - Profile ID
   * @returns {Object|null}
   */
  getProfile(id) {
    const profile = this.profiles.get(id);
    return profile ? this._sanitizeProfile(profile) : null;
  }

  /**
   * Clear CV data from a profile (keeps the profile itself)
   * @param {string} id - Profile ID
   */
  clearProfileCV(id) {
    const profile = this.profiles.get(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);

    profile.cvText = '';
    profile.cvStructured = {};
    profile.updatedAt = new Date().toISOString();

    this.profiles.set(id, profile);
    this._saveProfile(profile);

    logger.info('Profile CV cleared', { id, name: profile.name });
    return this._sanitizeProfile(profile);
  }

  /**
   * Sanitize profile for IPC transport (limit large fields)
   * @private
   */
  _sanitizeProfile(profile) {
    return {
      id: profile.id,
      name: profile.name,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      preferredRole: profile.preferredRole,
      isActive: profile.id === this.activeProfileId,
      hasCv: !!(profile.cvText && profile.cvText.length > 0),
      cvTextPreview: profile.cvText ? profile.cvText.substring(0, 300) + '...' : '',
      cvStructured: profile.cvStructured || {},
      settings: profile.settings || {}
    };
  }
}

module.exports = new ProfileManager();
