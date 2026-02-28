const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const config = require('../config');

class AuthService {
    constructor() {
        this.adminConfigPath = config.adminConfigPath;
        this.secretKey = config.secretKey;
        this.algorithm = config.algorithm;
        this.tokenExpireMinutes = config.accessTokenExpireMinutes;
    }

    /**
     * Wait for user confirmation that they've saved the admin credentials
     * Note: When run via start-dev.sh, the script handles the pause, so we just continue
     */
    async waitForUserConfirmation() {
        // Just print a blank line and continue immediately
        // The start-dev.sh script will handle the user confirmation pause
        console.log('');
        return Promise.resolve();
    }

    /**
     * Hash a password using bcrypt
     */
    async hashPassword(password) {
        const saltRounds = 12;
        return await bcrypt.hash(password, saltRounds);
    }

    /**
     * Verify a password against its hash
     */
    async verifyPassword(plainPassword, hashedPassword) {
        return await bcrypt.compare(plainPassword, hashedPassword);
    }

    /**
     * Create a JWT access token
     */
    createAccessToken(payload) {
        // Token expires in 30 minutes
        return jwt.sign(payload, this.secretKey, {
            algorithm: this.algorithm,
            expiresIn: '30m'
        });
    }

    /**
     * Verify and decode a JWT token
     */
    verifyToken(token) {
        try {
            return jwt.verify(token, this.secretKey, { algorithms: [this.algorithm] });
        } catch (error) {
            return null;
        }
    }

    /**
     * Load admin user from YAML file
     */
    async loadAdminUser() {
        try {
            if (!await fs.pathExists(this.adminConfigPath)) {
                return null;
            }

            const content = await fs.readFile(this.adminConfigPath, 'utf8');
            const adminConfig = yaml.load(content);
            return adminConfig.admin || null;
        } catch (error) {
            console.error('Failed to load admin user:', error.message);
            return null;
        }
    }

    /**
     * Save admin user to YAML file
     */
    async saveAdminUser(adminUser) {
        try {
            await fs.ensureDir(path.dirname(this.adminConfigPath));

            const adminConfig = {
                admin: {
                    username: adminUser.username,
                    password_hash: adminUser.password_hash,
                    email: adminUser.email,
                    is_active: adminUser.is_active,
                    is_admin: adminUser.is_admin,
                    created_at: adminUser.created_at,
                    last_login: adminUser.last_login
                }
            };

            await fs.writeFile(this.adminConfigPath, yaml.dump(adminConfig, {
                indent: 2,
                lineWidth: 120
            }));

            return true;
        } catch (error) {
            console.error('Failed to save admin user:', error.message);
            return false;
        }
    }

    /**
     * Create the first admin user if none exists
     */
    async createFirstUser() {
        try {
            // Check if admin user already exists
            const existingAdmin = await this.loadAdminUser();
            if (existingAdmin) {
                console.log('Admin user already exists');
                return;
            }

            // Generate secure random password
            const crypto = require('crypto');
            const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
            const defaultPassword = Array.from({ length: 20 }, () =>
                alphabet[crypto.randomInt(0, alphabet.length)]
            ).join('');

            const hashedPassword = await this.hashPassword(defaultPassword);

            const adminUser = {
                username: 'admin',
                password_hash: hashedPassword,
                email: 'admin@borgmatic.local',
                is_active: true,
                is_admin: true,
                created_at: new Date().toISOString(),
                last_login: null
            };

            const saved = await this.saveAdminUser(adminUser);
            if (saved) {
                console.log('\n' + '='.repeat(60));
                console.log('🔐 SECURELY GENERATED ADMIN PASSWORD');
                console.log('='.repeat(60));
                console.log(`Username: admin`);
                console.log(`Password: ${defaultPassword}`);
                console.log('='.repeat(60));
                console.log('⚠️  STORE THIS SECURELY - WILL NOT BE SHOWN AGAIN!');
                console.log('='.repeat(60));
                console.log('');

                // Interactive prompt to ensure user saves the password
                await this.waitForUserConfirmation();

                console.log('Admin user created successfully!');
            }
        } catch (error) {
            console.error('Failed to create first user:', error.message);
        }
    }

    /**
     * Authenticate a user with username and password
     */
    async authenticateUser(username, password) {
        try {
            const adminUser = await this.loadAdminUser();
            if (!adminUser) {
                return null;
            }

            if (adminUser.username !== username) {
                return null;
            }

            if (!adminUser.is_active) {
                return null;
            }

            const isValidPassword = await this.verifyPassword(password, adminUser.password_hash);
            if (!isValidPassword) {
                return null;
            }

            return adminUser;
        } catch (error) {
            console.error('Authentication error:', error.message);
            return null;
        }
    }

    /**
     * Update user's last login time
     */
    async updateLastLogin(username) {
        try {
            const adminUser = await this.loadAdminUser();
            if (adminUser && adminUser.username === username) {
                adminUser.last_login = new Date().toISOString();
                await this.saveAdminUser(adminUser);
            }
        } catch (error) {
            console.error('Failed to update last login:', error.message);
        }
    }

    /**
     * Get user profile
     */
    async getUserProfile(username) {
        try {
            const adminUser = await this.loadAdminUser();
            if (!adminUser || adminUser.username !== username) {
                return null;
            }

            // Return user profile without password hash
            return {
                id: 1, // Single admin user
                username: adminUser.username,
                email: adminUser.email,
                is_active: adminUser.is_active,
                is_admin: adminUser.is_admin,
                created_at: adminUser.created_at,
                last_login: adminUser.last_login
            };
        } catch (error) {
            console.error('Failed to get user profile:', error.message);
            return null;
        }
    }
}

module.exports = new AuthService();
