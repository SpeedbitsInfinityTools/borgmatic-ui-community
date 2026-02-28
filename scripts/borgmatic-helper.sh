#!/bin/bash

###############################################################################
# borgmatic-helper.sh - Helper functions for Borgmatic integration
###############################################################################
# Part of Infinity Tools - Smart In Venture
# Functions for automatic database discovery and registration with Borgmatic
###############################################################################

# NOTE: Do NOT use 'set -e' here as this script is sourced by other scripts

# Get the directory where this script is located
HELPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

###############################################################################
# Database Discovery Functions
###############################################################################

# Discover all databases on the borgmatic-db network
discover_databases() {
    local databases=()
    
    # Ensure borgmatic-db network exists
    if ! docker network inspect borgmatic-db &>/dev/null; then
        docker network create borgmatic-db 2>/dev/null || true
    fi
    
    # Find all running database containers
    local all_db_containers=$(docker ps --format '{{.Names}}' | grep -E '^(wp-db|nextcloud-db)' || true)
    
    while IFS= read -r container; do
        [ -z "$container" ] && continue
        
        # Get container image to determine database type
        local image=$(docker inspect "$container" -f '{{.Config.Image}}' 2>/dev/null || echo "")
        
        if [[ $image == *"mariadb"* ]] || [[ $image == *"mysql"* ]]; then
            databases+=("$container:mariadb:3306")
        elif [[ $image == *"postgres"* ]]; then
            databases+=("$container:postgres:5432")
        fi
    done <<< "$all_db_containers"
    
    printf '%s\n' "${databases[@]}"
}

# Discover all installed applications in /opt/speedbits
discover_applications() {
    local apps=()
    
    if [ -d /opt/speedbits ]; then
        for dir in /opt/speedbits/*/; do
            [ -d "$dir" ] || continue
            local app_name=$(basename "$dir")
            local size=$(du -sh "$dir" 2>/dev/null | cut -f1 || echo "unknown")
            apps+=("$app_name:$size")
        done
    fi
    
    printf '%s\n' "${apps[@]}"
}

###############################################################################
# Database Registration Functions
###############################################################################

# Register a database with Borgmatic
register_database_with_borgmatic() {
    local container_name=$1
    local db_type=$2
    local db_user=$3
    local db_password=$4
    
    local config="/opt/speedbits/borgmatic/config.yaml"
    
    # Quote password if it contains special YAML characters
    # This handles passwords with: : { } [ ] , & * # ? | - < > = ! % @ \
    if [[ "$db_password" =~ [:\{\}\[\],\&\*\#\?\|\-\<\>=!\%@\\] ]]; then
        db_password="\"${db_password//\"/\\\"}\""  # Escape quotes and wrap in quotes
    fi
    
    # Check if Borgmatic is installed
    if [ ! -f "$config" ]; then
        echo "❌ Borgmatic config not found at $config"
        return 1
    fi
    
    # Check if already registered
    if grep -q "hostname: $container_name" "$config" 2>/dev/null; then
        echo "ℹ️  Database already registered"
        return 0
    fi
    
    # Ensure database is on borgmatic-db network
    if ! docker network inspect borgmatic-db &>/dev/null; then
        docker network create borgmatic-db
    fi
    
    # Connect container to borgmatic-db network if not already connected
    local networks=$(docker inspect "$container_name" -f '{{range $net, $v := .NetworkSettings.Networks}}{{$net}} {{end}}' 2>/dev/null || echo "")
    if [[ ! $networks =~ "borgmatic-db" ]]; then
        echo "🔗 Connecting $container_name to borgmatic-db network..."
        docker network connect borgmatic-db "$container_name" 2>/dev/null || true
    fi
    
    # Add database to config
    case $db_type in
        mariadb|mysql)
            # Find the mysql_databases section
            if grep -q "mysql_databases:" "$config"; then
                # Append to existing section
                sed -i "/mysql_databases:/a\\    - name: ${container_name}\n      hostname: ${container_name}\n      port: 3306\n      username: ${db_user}\n      password: ${db_password}" "$config"
            else
                # Create new section before postgresql_databases or at end
                if grep -q "postgresql_databases:" "$config"; then
                    sed -i "/postgresql_databases:/i\\mysql_databases:\n    - name: ${container_name}\n      hostname: ${container_name}\n      port: 3306\n      username: ${db_user}\n      password: ${db_password}\n" "$config"
                else
                    cat >> "$config" <<EOF

mysql_databases:
    - name: ${container_name}
      hostname: ${container_name}
      port: 3306
      username: ${db_user}
      password: ${db_password}
EOF
                fi
            fi
            ;;
        postgres)
            # Find the postgresql_databases section
            if grep -q "postgresql_databases:" "$config"; then
                # Append to existing section
                sed -i "/postgresql_databases:/a\\    - name: ${container_name}\n      hostname: ${container_name}\n      port: 5432\n      username: ${db_user}\n      password: ${db_password}" "$config"
            else
                # Create new section
                cat >> "$config" <<EOF

postgresql_databases:
    - name: ${container_name}
      hostname: ${container_name}
      port: 5432
      username: ${db_user}
      password: ${db_password}
EOF
            fi
            ;;
        *)
            echo "❌ Unknown database type: $db_type"
            return 1
            ;;
    esac
    
    # Secure permissions on config file (contains database passwords)
    chmod 600 "$config" 2>/dev/null || true
    chown root:root "$config" 2>/dev/null || true
    
    # Restart Borgmatic to pick up new config
    docker restart borgmatic 2>/dev/null || true
    
    return 0
}

# Unregister a database from Borgmatic
unregister_database_from_borgmatic() {
    local container_name=$1
    local config="/opt/speedbits/borgmatic/config.yaml"
    
    # Check if Borgmatic is installed
    if [ ! -f "$config" ]; then
        return 0
    fi
    
    # Remove database entry (remove the block that contains this hostname)
    # This is tricky with sed, so we'll use a more robust approach
    if grep -q "hostname: $container_name" "$config"; then
        echo "🗑️  Removing $container_name from Borgmatic configuration..."
        
        # Create a temporary file
        local temp_file=$(mktemp)
        
        # Read the file and skip the database block
        local skip=0
        while IFS= read -r line; do
            if [[ $line =~ "hostname: $container_name" ]]; then
                skip=1
                # Go back and remove the "- name:" line
                sed -i '$ d' "$temp_file"
            elif [ $skip -eq 1 ] && [[ $line =~ ^[[:space:]]*- ]]; then
                # New database entry starts, stop skipping
                skip=0
                echo "$line" >> "$temp_file"
            elif [ $skip -eq 1 ] && [[ $line =~ ^[a-z] ]]; then
                # New section starts, stop skipping
                skip=0
                echo "$line" >> "$temp_file"
            elif [ $skip -eq 0 ]; then
                echo "$line" >> "$temp_file"
            fi
        done < "$config"
        
        # Replace original with cleaned version
        mv "$temp_file" "$config"
        
        # Restart Borgmatic
        docker restart borgmatic 2>/dev/null || true
    fi
}

# Auto-register database with user prompt
auto_register_database() {
    local container_name=$1
    local db_type=$2
    local db_user=$3
    local db_password=$4
    local instance_label=$5  # e.g., "WordPress (blog2)"
    
    # Check if Borgmatic is installed
    if ! docker ps --format '{{.Names}}' | grep -q '^borgmatic$'; then
    echo ""
        echo "💡 TIP: Install Borgmatic to enable automatic database backups"
        echo "   Database: $container_name (will be on borgmatic-db network)"
        return 0
    fi
    
    # Check if already registered
    if grep -q "hostname: $container_name" /opt/speedbits/borgmatic/config.yaml 2>/dev/null; then
    echo ""
        echo "✅ Database already registered with Borgmatic"
        return 0
    fi
    
    # Prompt user
    echo ""
    echo "📦 Borgmatic detected!"
    
    if command -v gum &>/dev/null; then
        if gum confirm "Register $instance_label database for automatic backup?"; then
            register_database_with_borgmatic "$container_name" "$db_type" "$db_user" "$db_password"
            echo "✅ Database registered with Borgmatic"
        else
            echo "⚠️  You can register manually later via 'Configure Borgmatic' menu"
        fi
    else
        # Fallback to read if gum not available
        echo -n "Register $instance_label database for automatic backup? (Y/n): "
        read -r response
        if [[ ! $response =~ ^[Nn] ]]; then
            register_database_with_borgmatic "$container_name" "$db_type" "$db_user" "$db_password"
            echo "✅ Database registered with Borgmatic"
        else
            echo "⚠️  You can register manually later via 'Configure Borgmatic' menu"
        fi
    fi
}

###############################################################################
# Network Management Functions
###############################################################################

# Ensure container is on borgmatic-db network
ensure_on_borgmatic_network() {
    local container_name=$1
    
    # Create network if it doesn't exist
    if ! docker network inspect borgmatic-db &>/dev/null; then
        docker network create borgmatic-db 2>/dev/null || true
    fi
    
    # Check if container is already on the network
    local networks=$(docker inspect "$container_name" -f '{{range $net, $v := .NetworkSettings.Networks}}{{$net}} {{end}}' 2>/dev/null || echo "")
    
    if [[ ! $networks =~ "borgmatic-db" ]]; then
        docker network connect borgmatic-db "$container_name" 2>/dev/null || true
        return 0
    fi
    
    return 1  # Already connected
}

###############################################################################
# Export functions (fail-safe)
###############################################################################

export -f discover_databases 2>/dev/null || true
export -f discover_applications 2>/dev/null || true
export -f register_database_with_borgmatic 2>/dev/null || true
export -f unregister_database_from_borgmatic 2>/dev/null || true
export -f auto_register_database 2>/dev/null || true
export -f ensure_on_borgmatic_network 2>/dev/null || true
