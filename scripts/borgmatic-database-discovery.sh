#!/bin/bash

###############################################################################
# borgmatic-database-discovery.sh - Discover all databases for Borgmatic
###############################################################################
# Part of Infinity Tools - Smart In Venture
# Discovers MariaDB, PostgreSQL, SQLite, MongoDB, and MSSQL databases automatically
# Reads credentials directly from Docker container environment variables
###############################################################################

set -o pipefail

###############################################################################
# Pre-flight Checks
###############################################################################

if ! docker ps &>/dev/null; then
    echo "Error: Cannot access Docker. Please run as root or add your user to the docker group." >&2
    echo "  To fix: sudo usermod -aG docker \$USER && newgrp docker" >&2
    exit 1
fi

###############################################################################
# Configuration
###############################################################################

# BORG_DB_NETWORK can be a space-separated list of networks
BORG_DB_NETWORK="${BORG_DB_NETWORK:-}"
INCLUDE_STOPPED="${INCLUDE_STOPPED:-false}"
# When true, ignore the network filter entirely and scan every container the
# Docker daemon can see. Useful in vanilla deployments where users install apps
# (Wordpress, Nextcloud, ...) with default Compose networks and never join a
# dedicated `borgmatic-db` network. Surfaced in the UI as "Include Host System".
INCLUDE_HOST="${INCLUDE_HOST:-false}"
SPEEDBITS_DIR="/opt/speedbits"

# Normalize: if INCLUDE_HOST is set, drop the network filter so every container
# image-match is accepted regardless of which networks it joined.
if [ "$INCLUDE_HOST" = "true" ]; then
    BORG_DB_NETWORK=""
fi

###############################################################################
# Helper Functions
###############################################################################

# Escape string for JSON (handles quotes, backslashes, and control characters)
json_escape() {
    local input="$1"
    # Escape backslashes first, then double quotes
    # Note: We don't escape forward slashes (JSON allows them unescaped)
    # Control characters like tabs/newlines are rare in container names but handled
    printf '%s' "$input" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r\t'
}

# Get environment variable from container
get_container_env() {
    local container=$1
    local var_name=$2
    docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep "^${var_name}=" | cut -d'=' -f2-
}

# Check if container is on any of the specified networks
container_on_network() {
    local container=$1
    local networks=$2
    
    # If no network filter, accept all containers
    [ -z "$networks" ] && return 0
    
    local container_networks=$(docker inspect "$container" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null)
    
    for net in $networks; do
        if echo "$container_networks" | grep -qw "$net"; then
            return 0
        fi
    done
    
    return 1
}

# Get container image name
get_container_image() {
    local container=$1
    docker inspect "$container" --format '{{.Config.Image}}' 2>/dev/null
}

###############################################################################
# Database Discovery Functions
###############################################################################

# Discover MariaDB/MySQL containers
discover_mariadb_mysql() {
    local ps_cmd="docker ps --format '{{.Names}}'"
    [ "$INCLUDE_STOPPED" = "true" ] && ps_cmd="docker ps -a --format '{{.Names}}'"
    
    while IFS= read -r container; do
        [ -z "$container" ] && continue
        
        local image=$(get_container_image "$container")
        [[ "$image" =~ mariadb|mysql ]] || continue
        
        # Check network filter
        container_on_network "$container" "$BORG_DB_NETWORK" || continue
        
        # Read credentials from container environment
        local db_name=$(get_container_env "$container" "MYSQL_DATABASE")
        local db_user=$(get_container_env "$container" "MYSQL_USER")
        local db_password=$(get_container_env "$container" "MYSQL_PASSWORD")
        
        # Fallback to root if no regular user
        if [ -z "$db_user" ] || [ -z "$db_password" ]; then
            db_user="root"
            db_password=$(get_container_env "$container" "MYSQL_ROOT_PASSWORD")
        fi
        
        # Default database name if not set
        [ -z "$db_name" ] && db_name="mysql"
        
        # Determine database type from image
        local db_type="mysql"
        [[ "$image" =~ mariadb ]] && db_type="mariadb"
        
        # Output: container|type|database|user|password|host
        echo "${container}|${db_type}|${db_name}|${db_user}|${db_password}|${container}"
        
    done < <(eval $ps_cmd)
}

# Discover PostgreSQL containers
discover_postgresql() {
    local ps_cmd="docker ps --format '{{.Names}}'"
    [ "$INCLUDE_STOPPED" = "true" ] && ps_cmd="docker ps -a --format '{{.Names}}'"
    
    while IFS= read -r container; do
        [ -z "$container" ] && continue
        
        local image=$(get_container_image "$container")
        [[ "$image" =~ postgres ]] || continue
        
        # Check network filter
        container_on_network "$container" "$BORG_DB_NETWORK" || continue
        
        # Read credentials from container environment
        local db_name=$(get_container_env "$container" "POSTGRES_DB")
        local db_user=$(get_container_env "$container" "POSTGRES_USER")
        local db_password=$(get_container_env "$container" "POSTGRES_PASSWORD")
        
        # Defaults
        [ -z "$db_user" ] && db_user="postgres"
        [ -z "$db_name" ] && db_name="postgres"
        
        # Output: container|type|database|user|password|host
        echo "${container}|postgresql|${db_name}|${db_user}|${db_password}|${container}"
        
    done < <(eval $ps_cmd)
}

# Discover MongoDB containers
discover_mongodb() {
    local ps_cmd="docker ps --format '{{.Names}}'"
    [ "$INCLUDE_STOPPED" = "true" ] && ps_cmd="docker ps -a --format '{{.Names}}'"
    
    while IFS= read -r container; do
        [ -z "$container" ] && continue
        
        local image=$(get_container_image "$container")
        [[ "$image" =~ mongo ]] || continue
        
        # Check network filter
        container_on_network "$container" "$BORG_DB_NETWORK" || continue
        
        # Read credentials from container environment
        local db_name=$(get_container_env "$container" "MONGO_INITDB_DATABASE")
        local db_user=$(get_container_env "$container" "MONGO_INITDB_ROOT_USERNAME")
        local db_password=$(get_container_env "$container" "MONGO_INITDB_ROOT_PASSWORD")
        
        # Defaults
        [ -z "$db_name" ] && db_name="admin"
        
        # Output: container|type|database|user|password|host
        echo "${container}|mongodb|${db_name}|${db_user}|${db_password}|${container}"
        
    done < <(eval $ps_cmd)
}

# Discover MSSQL (Microsoft SQL Server) containers
discover_mssql() {
    local ps_cmd="docker ps --format '{{.Names}}'"
    [ "$INCLUDE_STOPPED" = "true" ] && ps_cmd="docker ps -a --format '{{.Names}}'"
    
    while IFS= read -r container; do
        [ -z "$container" ] && continue
        
        local image=$(get_container_image "$container")
        # Match mssql server images (mcr.microsoft.com/mssql/server, azure-sql-edge, etc.)
        [[ "$image" =~ mssql|sql-server|azure-sql ]] || continue
        
        # Check network filter
        container_on_network "$container" "$BORG_DB_NETWORK" || continue
        
        # Read credentials from container environment
        # MSSQL uses SA_PASSWORD or MSSQL_SA_PASSWORD for the 'sa' (system admin) account
        local db_password=$(get_container_env "$container" "SA_PASSWORD")
        [ -z "$db_password" ] && db_password=$(get_container_env "$container" "MSSQL_SA_PASSWORD")
        
        # MSSQL doesn't have a single "database" env var - the default is 'master'
        # We'll use 'all' to indicate we should backup all user databases
        local db_name="all"
        local db_user="sa"
        
        # Output: container|type|database|user|password|host
        echo "${container}|mssql|${db_name}|${db_user}|${db_password}|${container}"
        
    done < <(eval $ps_cmd)
}

# Discover SQLite databases (file-based, no credentials needed)
discover_sqlite() {
    [ ! -d "$SPEEDBITS_DIR" ] && return
    
    # Find SQLite files in known locations
    local sqlite_patterns=(
        "*/data/*.sqlite3"
        "*/data/*.db"
        "*/database/*.sqlite3"
        "*/database/*.db"
    )
    
    for pattern in "${sqlite_patterns[@]}"; do
        find "$SPEEDBITS_DIR" -path "$SPEEDBITS_DIR/$pattern" 2>/dev/null | while read -r db_file; do
            [ ! -f "$db_file" ] && continue
            
            # Extract app name from path
            local app_name=$(echo "$db_file" | sed "s|$SPEEDBITS_DIR/||" | cut -d'/' -f1)
            local db_name=$(basename "$db_file" | sed -e 's/\.sqlite3$//' -e 's/\.db$//')
            
            # Output: app_name|type|db_name|path (no credentials for SQLite)
            echo "${app_name}|sqlite|${db_name}|||${db_file}"
        done
    done | sort -u
}

###############################################################################
# JSON Output for UI
###############################################################################

output_json() {
    echo "["
    local first=true
    local id_counter=1
    
    # Combine all discoveries into a temp file to avoid repeated calls
    local tmp_file=$(mktemp)
    discover_mariadb_mysql >> "$tmp_file"
    discover_postgresql >> "$tmp_file"
    discover_mongodb >> "$tmp_file"
    discover_mssql >> "$tmp_file"
    
    while IFS='|' read -r container db_type db_name db_user db_password db_host; do
        [ -z "$container" ] && continue
        [ "$first" = false ] && echo ","
        first=false
        
        # Properly escape all strings for JSON
        local esc_container=$(json_escape "$container")
        local esc_type=$(json_escape "$db_type")
        local esc_name=$(json_escape "$db_name")
        local esc_user=$(json_escape "$db_user")
        local esc_password=$(json_escape "$db_password")
        local esc_host=$(json_escape "$db_host")
        local esc_label=$(json_escape "$container ($db_type)")
        
        cat <<EOF
  {
    "id": "db-${id_counter}",
    "container": "$esc_container",
    "type": "$esc_type",
    "database": "$esc_name",
    "username": "$esc_user",
    "password": "$esc_password",
    "hostname": "$esc_host",
    "port": $([ "$db_type" = "postgresql" ] && echo "5432" || [ "$db_type" = "mongodb" ] && echo "27017" || [ "$db_type" = "mssql" ] && echo "1433" || echo "3306"),
    "label": "$esc_label"
  }
EOF
        ((id_counter++))
    done < "$tmp_file"
    
    # SQLite
    while IFS='|' read -r app_name db_type db_name _ _ db_path; do
        [ -z "$app_name" ] && continue
        [ "$first" = false ] && echo ","
        first=false
        
        local esc_app=$(json_escape "$app_name")
        local esc_name=$(json_escape "$db_name")
        local esc_path=$(json_escape "$db_path")
        local esc_label=$(json_escape "$app_name ($db_name)")
        
        cat <<EOF
  {
    "id": "db-${id_counter}",
    "container": "$esc_app",
    "type": "sqlite",
    "database": "$esc_name",
    "username": "",
    "password": "",
    "hostname": "",
    "port": null,
    "path": "$esc_path",
    "label": "$esc_label"
  }
EOF
        ((id_counter++))
    done < <(discover_sqlite)
    
    echo ""
    echo "]"
    rm -f "$tmp_file"
}

###############################################################################
# Summary Output
###############################################################################

output_summary() {
    echo "📊 Database Discovery Summary"
    echo ""
    
    local mariadb_count=0
    local postgresql_count=0
    local mongodb_count=0
    local mssql_count=0
    local sqlite_count=0
    
    echo "🐬 MariaDB/MySQL:"
    while IFS='|' read -r container db_type db_name db_user db_password db_host; do
        [ -z "$container" ] && continue
        ((mariadb_count++))
        local cred_status="✅ credentials found"
        [ -z "$db_password" ] && cred_status="⚠️  no password"
        echo "   • $container → $db_name ($cred_status)"
    done < <(discover_mariadb_mysql)
    [ "$mariadb_count" -eq 0 ] && echo "   (none found)"
    
    echo ""
    echo "🐘 PostgreSQL:"
    while IFS='|' read -r container db_type db_name db_user db_password db_host; do
        [ -z "$container" ] && continue
        ((postgresql_count++))
        local cred_status="✅ credentials found"
        [ -z "$db_password" ] && cred_status="⚠️  no password"
        echo "   • $container → $db_name ($cred_status)"
    done < <(discover_postgresql)
    [ "$postgresql_count" -eq 0 ] && echo "   (none found)"
    
    echo ""
    echo "🍃 MongoDB:"
    while IFS='|' read -r container db_type db_name db_user db_password db_host; do
        [ -z "$container" ] && continue
        ((mongodb_count++))
        local cred_status="✅ credentials found"
        [ -z "$db_password" ] && cred_status="⚠️  no password"
        echo "   • $container → $db_name ($cred_status)"
    done < <(discover_mongodb)
    [ "$mongodb_count" -eq 0 ] && echo "   (none found)"
    
    echo ""
    echo "🗄️  MS SQL Server:"
    while IFS='|' read -r container db_type db_name db_user db_password db_host; do
        [ -z "$container" ] && continue
        ((mssql_count++))
        local cred_status="✅ credentials found"
        [ -z "$db_password" ] && cred_status="⚠️  no password"
        echo "   • $container → $db_name ($cred_status)"
    done < <(discover_mssql)
    [ "$mssql_count" -eq 0 ] && echo "   (none found)"
    
    echo ""
    echo "📁 SQLite:"
    while IFS='|' read -r app_name db_type db_name _ _ db_path; do
        [ -z "$app_name" ] && continue
        ((sqlite_count++))
        echo "   • $app_name → $db_path"
    done < <(discover_sqlite)
    [ "$sqlite_count" -eq 0 ] && echo "   (none found)"
    
    echo ""
    local total=$((mariadb_count + postgresql_count + mongodb_count + mssql_count + sqlite_count))
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Total: $total database(s) discovered"
}

###############################################################################
# Count Output
###############################################################################

output_count() {
    local count=0
    count=$((count + $(discover_mariadb_mysql | grep -c "|" 2>/dev/null || echo 0)))
    count=$((count + $(discover_postgresql | grep -c "|" 2>/dev/null || echo 0)))
    count=$((count + $(discover_mongodb | grep -c "|" 2>/dev/null || echo 0)))
    count=$((count + $(discover_mssql | grep -c "|" 2>/dev/null || echo 0)))
    count=$((count + $(discover_sqlite | grep -c "|" 2>/dev/null || echo 0)))
    echo "$count"
}

###############################################################################
# Main Execution
###############################################################################

# Lightweight diagnostic mode: print one JSON object with what the scan saw so
# the UI can render a helpful empty-state ("scanned X networks, saw Y containers,
# no DB images among them") instead of a generic "no databases found".
output_diagnostic() {
    local total_containers=0
    local total_db_images=0
    if [ "$INCLUDE_STOPPED" = "true" ]; then
        total_containers=$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -c . || echo 0)
    else
        total_containers=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -c . || echo 0)
    fi
    # Containers whose image looks like a supported DB engine (regardless of
    # network membership — this is the metric that matters for "did the user
    # have any DB at all?").
    local ps_flag=""
    [ "$INCLUDE_STOPPED" = "true" ] && ps_flag="-a"
    while IFS= read -r container; do
        [ -z "$container" ] && continue
        local image
        image=$(get_container_image "$container")
        if [[ "$image" =~ mariadb|mysql|postgres|mongo|mssql|sql-server|azure-sql ]]; then
            total_db_images=$((total_db_images + 1))
        fi
    done < <(docker ps $ps_flag --format '{{.Names}}' 2>/dev/null)

    # Escape network list for JSON
    local networks_json
    networks_json=$(printf '%s' "$BORG_DB_NETWORK" | tr ' ' '\n' | grep -v '^$' \
        | awk 'BEGIN{first=1} {gsub(/\\/,"\\\\"); gsub(/"/,"\\\""); if(!first)printf(","); printf("\"%s\"", $0); first=0}')
    cat <<EOF
{"containers_seen":${total_containers},"db_containers_seen":${total_db_images},"scanned_networks":[${networks_json}],"network_filter_active":$([ -n "$BORG_DB_NETWORK" ] && echo true || echo false),"include_host":$([ "$INCLUDE_HOST" = "true" ] && echo true || echo false)}
EOF
}

MODE="${1:-summary}"

case "$MODE" in
    json)
        output_json
        ;;
    count)
        output_count
        ;;
    diagnostic)
        output_diagnostic
        ;;
    summary|*)
        output_summary
        ;;
esac
