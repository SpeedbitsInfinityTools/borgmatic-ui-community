const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const config = require('../config');

/**
 * Retention Profile Manager
 * Manages retention profiles for backup configurations
 */
class RetentionManager {
    constructor() {
        this.profilesPath = path.join(config.configDir, 'retention-profiles.yaml');
    }

    /**
     * Get all retention profiles (built-in + custom)
     */
    async getProfiles() {
        try {
            await fs.ensureFile(this.profilesPath);
            const content = await fs.readFile(this.profilesPath, 'utf8');
            
            if (!content.trim()) {
                // Initialize with default profiles
                await this.initializeDefaultProfiles();
                return await this.getProfiles();
            }

            const data = yaml.load(content) || {};
            const profiles = data.profiles || [];
            const customProfiles = data.custom_profiles || [];

            // Migration: rename legacy built-in profile label "Relaxed" -> "Long-Term"
            // while keeping the stable profile id (profile-relaxed).
            let migrated = false;
            for (const profile of profiles) {
                if (profile?.id === 'profile-relaxed' && profile?.name === 'Relaxed') {
                    profile.name = 'Long-Term';
                    if (!profile.description || profile.description === 'Best for media files and archives') {
                        profile.description = 'Best for archives with extended retention (includes yearly backups)';
                    }
                    if (!profile.icon || profile.icon === '🌴') {
                        profile.icon = '📦';
                    }
                    migrated = true;
                }
            }
            if (migrated) {
                await fs.writeFile(this.profilesPath, yaml.dump(data, { indent: 2 }));
            }

            return {
                builtIn: profiles,
                custom: customProfiles,
                all: [...profiles, ...customProfiles]
            };
        } catch (error) {
            console.error('Failed to get retention profiles:', error);
            throw error;
        }
    }

    /**
     * Initialize default retention profiles
     */
    async initializeDefaultProfiles() {
        const defaultProfiles = {
            profiles: [
                {
                    id: 'profile-standard',
                    name: 'Standard',
                    description: 'Best for daily backups with moderate history',
                    icon: '📊',
                    keep_daily: 7,
                    keep_weekly: 4,
                    keep_monthly: 6
                },
                {
                    id: 'profile-aggressive',
                    name: 'Aggressive',
                    description: 'Best for databases and frequently changing data',
                    icon: '⚡',
                    keep_hourly: 48,
                    keep_daily: 14,
                    keep_weekly: 8
                },
                {
                    id: 'profile-relaxed',
                    name: 'Long-Term',
                    description: 'Best for archives with extended retention (includes yearly backups)',
                    icon: '📦',
                    keep_daily: 7,
                    keep_weekly: 8,
                    keep_monthly: 12,
                    keep_yearly: 5
                }
            ],
            custom_profiles: []
        };

        await fs.writeFile(
            this.profilesPath,
            yaml.dump(defaultProfiles, { indent: 2 })
        );

        console.log('✓ Initialized default retention profiles');
    }

    /**
     * Get a specific profile by ID
     */
    async getProfile(profileId) {
        const { all } = await this.getProfiles();
        return all.find(p => p.id === profileId);
    }

    /**
     * Create a custom retention profile
     */
    async createCustomProfile(profileData) {
        try {
            const content = await fs.readFile(this.profilesPath, 'utf8');
            const data = yaml.load(content) || {};
            
            if (!data.custom_profiles) {
                data.custom_profiles = [];
            }

            // Generate unique ID
            const profileId = `profile-custom-${Date.now()}`;
            
            const newProfile = {
                id: profileId,
                name: profileData.name,
                description: profileData.description || '',
                icon: profileData.icon || '⚙️',
                ...this.buildRetentionSettings(profileData)
            };

            data.custom_profiles.push(newProfile);

            await fs.writeFile(
                this.profilesPath,
                yaml.dump(data, { indent: 2 })
            );

            console.log(`✓ Created custom retention profile: ${profileData.name}`);
            return newProfile;
        } catch (error) {
            console.error('Failed to create custom profile:', error);
            throw error;
        }
    }

    /**
     * Update a custom profile
     */
    async updateCustomProfile(profileId, updates) {
        try {
            const content = await fs.readFile(this.profilesPath, 'utf8');
            const data = yaml.load(content) || {};

            const profileIndex = data.custom_profiles?.findIndex(p => p.id === profileId);
            
            if (profileIndex === -1) {
                throw new Error('Custom profile not found');
            }

            data.custom_profiles[profileIndex] = {
                ...data.custom_profiles[profileIndex],
                ...updates,
                id: profileId // Ensure ID doesn't change
            };

            await fs.writeFile(
                this.profilesPath,
                yaml.dump(data, { indent: 2 })
            );

            console.log(`✓ Updated custom retention profile: ${profileId}`);
            return data.custom_profiles[profileIndex];
        } catch (error) {
            console.error('Failed to update custom profile:', error);
            throw error;
        }
    }

    /**
     * Delete a custom profile
     */
    async deleteCustomProfile(profileId) {
        try {
            const content = await fs.readFile(this.profilesPath, 'utf8');
            const data = yaml.load(content) || {};

            const initialLength = data.custom_profiles?.length || 0;
            data.custom_profiles = data.custom_profiles?.filter(p => p.id !== profileId) || [];

            if (data.custom_profiles.length === initialLength) {
                throw new Error('Custom profile not found');
            }

            await fs.writeFile(
                this.profilesPath,
                yaml.dump(data, { indent: 2 })
            );

            console.log(`✓ Deleted custom retention profile: ${profileId}`);
            return true;
        } catch (error) {
            console.error('Failed to delete custom profile:', error);
            throw error;
        }
    }

    /**
     * Build retention settings object from profile data
     */
    buildRetentionSettings(profileData) {
        const settings = {};
        
        if (profileData.keep_within) settings.keep_within = profileData.keep_within;
        if (profileData.keep_secondly) settings.keep_secondly = profileData.keep_secondly;
        if (profileData.keep_minutely) settings.keep_minutely = profileData.keep_minutely;
        if (profileData.keep_hourly) settings.keep_hourly = profileData.keep_hourly;
        if (profileData.keep_daily) settings.keep_daily = profileData.keep_daily;
        if (profileData.keep_weekly) settings.keep_weekly = profileData.keep_weekly;
        if (profileData.keep_monthly) settings.keep_monthly = profileData.keep_monthly;
        if (profileData.keep_yearly) settings.keep_yearly = profileData.keep_yearly;

        return settings;
    }

    /**
     * Convert profile to borgmatic retention section
     */
    profileToRetention(profile) {
        const retention = {};
        
        if (profile.keep_within) retention.keep_within = profile.keep_within;
        if (profile.keep_secondly) retention.keep_secondly = profile.keep_secondly;
        if (profile.keep_minutely) retention.keep_minutely = profile.keep_minutely;
        if (profile.keep_hourly) retention.keep_hourly = profile.keep_hourly;
        if (profile.keep_daily) retention.keep_daily = profile.keep_daily;
        if (profile.keep_weekly) retention.keep_weekly = profile.keep_weekly;
        if (profile.keep_monthly) retention.keep_monthly = profile.keep_monthly;
        if (profile.keep_yearly) retention.keep_yearly = profile.keep_yearly;

        return retention;
    }
}

module.exports = new RetentionManager();
