/**
 * Extraction Profile Management
 * 
 * Provides profile-based configuration for memory extraction,
 * allowing named profiles that bundle strategy, provider, model parameters,
 * memory types, and thresholds.
 */

import {
  ExtractionProfile,
  ExtractionStrategy,
  LLMProvider,
  ModelParams,
} from './types.js';

/**
 * Profile registry for managing extraction profiles
 */
export class ProfileRegistry {
  private profiles: Map<string, ExtractionProfile>;

  constructor() {
    this.profiles = new Map<string, ExtractionProfile>();
  }

  /**
   * Register a new extraction profile
   * 
   * @param name - The name of the profile
   * @param profile - The profile configuration
   * @throws Error if the profile name is invalid or already exists
   */
  register(name: string, profile: ExtractionProfile): void {
    // Validate profile name
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('Profile name must be a non-empty string');
    }

    const normalizedName = name.trim().toLowerCase();

    // Check if profile already exists
    if (this.profiles.has(normalizedName)) {
      throw new Error(
        `Profile '${name}' already exists. Use a different name or unregister the existing profile first.`
      );
    }

    // Validate profile configuration
    this.validateProfile(name, profile);

    // Store profile
    this.profiles.set(normalizedName, profile);
  }

  /**
   * Get a profile by name
   * 
   * @param name - The name of the profile
   * @returns The profile configuration, or undefined if not found
   */
  get(name: string): ExtractionProfile | undefined {
    const normalizedName = name.trim().toLowerCase();
    return this.profiles.get(normalizedName);
  }

  /**
   * Check if a profile exists
   * 
   * @param name - The name of the profile
   * @returns True if the profile exists, false otherwise
   */
  has(name: string): boolean {
    const normalizedName = name.trim().toLowerCase();
    return this.profiles.has(normalizedName);
  }

  /**
   * Unregister a profile
   * 
   * @param name - The name of the profile to remove
   * @returns True if the profile was removed, false if it didn't exist
   */
  unregister(name: string): boolean {
    const normalizedName = name.trim().toLowerCase();
    return this.profiles.delete(normalizedName);
  }

  /**
   * Get all registered profile names
   * 
   * @returns Array of profile names
   */
  listProfiles(): string[] {
    return Array.from(this.profiles.keys());
  }

  /**
   * Clear all profiles
   */
  clear(): void {
    this.profiles.clear();
  }

  /**
   * Validate a profile configuration
   * 
   * @param name - The profile name (for error messages)
   * @param profile - The profile to validate
   * @throws Error if the profile is invalid
   */
  private validateProfile(name: string, profile: ExtractionProfile): void {
    if (!profile || typeof profile !== 'object') {
      throw new Error(`Profile '${name}' must be an object`);
    }

    // Validate strategy
    if (!profile.strategy) {
      throw new Error(`Profile '${name}' must have a strategy`);
    }

    if (typeof profile.strategy.extract !== 'function') {
      throw new Error(`Profile '${name}' strategy must have an extract method`);
    }

    if (typeof profile.strategy.extractIncremental !== 'function') {
      throw new Error(`Profile '${name}' strategy must have an extractIncremental method`);
    }

    if (!profile.strategy.name || typeof profile.strategy.name !== 'string') {
      throw new Error(`Profile '${name}' strategy must have a name`);
    }

    // Validate provider
    if (!profile.provider) {
      throw new Error(`Profile '${name}' must have a provider`);
    }

    if (typeof profile.provider.complete !== 'function') {
      throw new Error(`Profile '${name}' provider must have a complete method`);
    }

    if (typeof profile.provider.completeStructured !== 'function') {
      throw new Error(`Profile '${name}' provider must have a completeStructured method`);
    }

    if (!profile.provider.name || typeof profile.provider.name !== 'string') {
      throw new Error(`Profile '${name}' provider must have a name`);
    }

    // Validate modelParams
    if (!profile.modelParams) {
      throw new Error(`Profile '${name}' must have modelParams`);
    }

    this.validateModelParams(name, profile.modelParams);

    // Validate memoryTypes
    if (!profile.memoryTypes || !Array.isArray(profile.memoryTypes)) {
      throw new Error(`Profile '${name}' must have a memoryTypes array`);
    }

    if (profile.memoryTypes.length === 0) {
      throw new Error(`Profile '${name}' must have at least one memory type`);
    }

    for (const type of profile.memoryTypes) {
      if (!type || typeof type !== 'string' || type.trim().length === 0) {
        throw new Error(`Profile '${name}' has invalid memory type: ${type}`);
      }
    }

    // Validate minConfidence
    if (typeof profile.minConfidence !== 'number') {
      throw new Error(`Profile '${name}' minConfidence must be a number`);
    }

    if (profile.minConfidence < 0 || profile.minConfidence > 1) {
      throw new Error(
        `Profile '${name}' minConfidence must be between 0 and 1, got ${profile.minConfidence}`
      );
    }
  }

  /**
   * Validate model parameters
   * 
   * @param profileName - The profile name (for error messages)
   * @param params - The model parameters to validate
   * @throws Error if the parameters are invalid
   */
  private validateModelParams(profileName: string, params: ModelParams): void {
    if (!params.model || typeof params.model !== 'string' || params.model.trim().length === 0) {
      throw new Error(`Profile '${profileName}' modelParams.model must be a non-empty string`);
    }

    if (typeof params.temperature !== 'number') {
      throw new Error(`Profile '${profileName}' modelParams.temperature must be a number`);
    }

    if (params.temperature < 0 || params.temperature > 2) {
      throw new Error(
        `Profile '${profileName}' modelParams.temperature must be between 0 and 2, got ${params.temperature}`
      );
    }

    if (typeof params.maxTokens !== 'number' || params.maxTokens <= 0) {
      throw new Error(
        `Profile '${profileName}' modelParams.maxTokens must be a positive number, got ${params.maxTokens}`
      );
    }
  }
}
