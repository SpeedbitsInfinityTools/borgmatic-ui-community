#!/usr/bin/env node

/**
 * Reset Admin Password Utility
 * Usage: node src/utils/reset-admin.js [new-password]
 */

const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const config = require('../config');

class AdminPasswordReset {
    constructor() {
        this.adminConfigPath = config.adminConfigPath;
    }

    /**
     * Wait for user confirmation that they've saved the password
     */
    async waitForUserConfirmation() {
        // ANSI color codes
        const RED = '\x1b[31m';
        const BOLD = '\x1b[1m';
        const RESET = '\x1b[0m';
        
        // Check if we're in an interactive terminal
        const isInteractive = process.stdin.isTTY;
        
        if (!isInteractive) {
            // Non-interactive mode
            console.log(`${RED}${BOLD}⚠️  NON-INTERACTIVE MODE: Please save the password above!${RESET}`);
            console.log(`${RED}${BOLD}⚠️  Continuing in 10 seconds...${RESET}`);
            await new Promise(resolve => setTimeout(resolve, 10000));
            return;
        }
        
        // Interactive mode - wait for user confirmation
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        return new Promise((resolve) => {
            console.log(`${RED}${BOLD}╔═══════════════════════════════════════════════════════════╗${RESET}`);
            console.log(`${RED}${BOLD}║  ⚠️  Have you saved your admin credentials?           ║${RESET}`);
            console.log(`${RED}${BOLD}║                                                           ║${RESET}`);
            console.log(`${RED}${BOLD}║  Type 'Y' and press Enter to continue...              ║${RESET}`);
            console.log(`${RED}${BOLD}╚═══════════════════════════════════════════════════════════╝${RESET}`);
            console.log('');
            
            rl.question('', (answer) => {
                rl.close();
                if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
                    console.log('✅ Credentials confirmed. Continuing...\n');
                    resolve();
                } else {
                    console.log('❌ Please save your credentials first!');
                    // Ask again
                    this.waitForUserConfirmation().then(resolve);
                }
            });
        });
    }

    /**
     * Generate a secure random password
     */
    generateSecurePassword() {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
        return Array.from({ length: 20 }, () => 
            alphabet[crypto.randomInt(0, alphabet.length)]
        ).join('');
    }

    /**
     * Reset admin password
     */
    async resetPassword(newPassword = null) {
        try {
            // Generate password if not provided
            const password = newPassword || this.generateSecurePassword();
            
            // Hash the password
            const hashedPassword = await bcrypt.hash(password, 12);
            
            // Load existing admin config or create new one
            let adminConfig = {};
            if (await fs.pathExists(this.adminConfigPath)) {
                const content = await fs.readFile(this.adminConfigPath, 'utf8');
                adminConfig = yaml.load(content) || {};
            }
            
            // Update admin user
            adminConfig.admin = {
                username: 'admin',
                password_hash: hashedPassword,
                email: 'admin@borgmatic.local',
                is_active: true,
                is_admin: true,
                created_at: adminConfig.admin?.created_at || new Date().toISOString(),
                updated_at: new Date().toISOString(),
                last_login: adminConfig.admin?.last_login || null
            };
            
            // Ensure directory exists
            await fs.ensureDir(path.dirname(this.adminConfigPath));
            
            // Save to YAML file
            await fs.writeFile(this.adminConfigPath, yaml.dump(adminConfig, {
                indent: 2,
                lineWidth: 120
            }));
            
            console.log('\n' + '='.repeat(60));
            console.log('🔐 ADMIN PASSWORD RESET');
            console.log('='.repeat(60));
            console.log(`Username: admin`);
            console.log(`Password: ${password}`);
            console.log('='.repeat(60));
            console.log('⚠️  STORE THIS SECURELY - WILL NOT BE SHOWN AGAIN!');
            console.log('='.repeat(60));
            console.log('');
            
            // Wait for user confirmation
            await this.waitForUserConfirmation();
            
            console.log('✅ Admin password reset successfully!');
            
            return password;
        } catch (error) {
            console.error('❌ Failed to reset admin password:', error.message);
            process.exit(1);
        }
    }
}

// Command line interface
async function main() {
    const args = process.argv.slice(2);
    const newPassword = args[0] || null;
    
    console.log('🔧 Borgmatic UI - Admin Password Reset');
    console.log('=====================================');
    
    if (newPassword) {
        console.log('Using provided password...');
    } else {
        console.log('Generating secure random password...');
    }
    
    const resetter = new AdminPasswordReset();
    await resetter.resetPassword(newPassword);
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = AdminPasswordReset;
