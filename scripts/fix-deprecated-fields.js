#!/usr/bin/env node
/**
 * Fix deprecated log_file fields in backup YAML files
 * Removes log_file and log_file_verbosity from top level as they're not supported in newer borgmatic
 */

const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');

const configDir = process.env.CONFIG_DIR || path.join(__dirname, '..', '..', '..', 'borgmatic-ui-data', 'config');
const borgmaticDir = path.join(configDir, 'borgmatic.d');

async function fixDeprecatedFields() {
    try {
        console.log('🔍 Scanning for deprecated fields...');
        console.log(`📁 Directory: ${borgmaticDir}\n`);

        if (!await fs.pathExists(borgmaticDir)) {
            console.log('❌ borgmatic.d directory not found');
            return;
        }

        const files = await fs.readdir(borgmaticDir);
        const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

        if (yamlFiles.length === 0) {
            console.log('📝 No YAML files found');
            return;
        }

        let fixedCount = 0;

        for (const file of yamlFiles) {
            const filePath = path.join(borgmaticDir, file);
            console.log(`\n📄 Processing: ${file}`);

            try {
                // Read and parse YAML
                const content = await fs.readFile(filePath, 'utf8');
                const config = yaml.load(content);

                let modified = false;

                // Check for deprecated fields
                if (config.log_file) {
                    console.log(`   ⚠️  Found deprecated: log_file`);
                    delete config.log_file;
                    modified = true;
                }

                if (config.log_file_verbosity) {
                    console.log(`   ⚠️  Found deprecated: log_file_verbosity`);
                    delete config.log_file_verbosity;
                    modified = true;
                }

                if (config.log_file_format) {
                    console.log(`   ⚠️  Found deprecated: log_file_format`);
                    delete config.log_file_format;
                    modified = true;
                }

                if (modified) {
                    // Create backup
                    const backupPath = `${filePath}.backup-${Date.now()}`;
                    await fs.copy(filePath, backupPath);
                    console.log(`   💾 Backup created: ${path.basename(backupPath)}`);

                    // Write updated config
                    const updatedContent = yaml.dump(config, {
                        indent: 2,
                        lineWidth: -1,
                        noRefs: true
                    });
                    await fs.writeFile(filePath, updatedContent, 'utf8');
                    console.log(`   ✅ Fixed and saved`);
                    fixedCount++;
                } else {
                    console.log(`   ✓ No deprecated fields found`);
                }

            } catch (error) {
                console.error(`   ❌ Error processing file: ${error.message}`);
            }
        }

        console.log(`\n${'='.repeat(50)}`);
        console.log(`✨ Summary: Fixed ${fixedCount} of ${yamlFiles.length} files`);
        console.log(`${'='.repeat(50)}\n`);

        if (fixedCount > 0) {
            console.log('💡 Tip: Backups were created before modifications');
            console.log('   You can restore from backups if needed\n');
        }

    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    fixDeprecatedFields().then(() => {
        console.log('✅ Done!');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { fixDeprecatedFields };
